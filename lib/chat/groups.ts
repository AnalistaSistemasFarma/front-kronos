/**
 * GRUPOS del chat de "Asistentes IA": conversaciones donde conviven varias
 * personas y varios agentes.
 *
 * Pedido de Nicolás (2026-09-08): "quiero empezar a hacer grupos para poder
 * hablar personas y que los agentes se comuniquen entre si en esos grupos".
 *
 * -------------------------------------------------------------------------
 * LAS DOS REGLAS QUE SOSTIENEN TODO ESTO
 * -------------------------------------------------------------------------
 * 1. **Un agente solo atiende si lo mencionan.** Es la misma regla de los
 *    grupos de Telegram (`requireMention`). Sin ella, ocho agentes opinan de
 *    todo: el grupo se vuelve ilegible y el consumo se multiplica por ocho.
 *
 * 2. **Tope de turnos seguidos entre agentes.** Si un agente contesta lo que
 *    ve, y lo que ve incluye lo que escribió otro agente, dos agentes se
 *    saludan hasta el fin de los tiempos gastando el consumo de los dos. Al
 *    llegar al tope la cadena se corta y queda un mensaje de sistema
 *    diciéndolo, que es muy distinto a que el mensaje desaparezca en silencio.
 *
 * Las dos son decisiones de Nicolás del 2026-09-08 ("dale con las
 * recomendadas"), no defaults que se puedan cambiar por comodidad.
 *
 * Las funciones puras de este archivo (menciones y conteo de turnos) están
 * aparte de la base a propósito: son las que llevan pruebas
 * (lib/chat/__tests__/groups.test.ts).
 */
import { prisma } from '../prisma';
import { CHAT_MODULE_URL } from './access';

/** Clases de conversación. `kind` en la base. */
export const CONVERSATION_KINDS = ['direct', 'group'] as const;
export type ConversationKind = (typeof CONVERSATION_KINDS)[number];

/** Papeles de un integrante dentro de un grupo. */
export const PARTICIPANT_ROLES = ['owner', 'member'] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

/** Tope del nombre del grupo (columna `title`, NVarChar(300)). */
export const MAX_GROUP_NAME_CHARS = 120;

/**
 * Tope de personas por grupo. No es una restricción técnica: es que un grupo
 * de trabajo con más de treinta integrantes deja de ser un grupo de trabajo.
 */
export const MAX_GROUP_USERS = 30;

/**
 * Tope de agentes por grupo. Cada agente mencionado es una sesión de Claude
 * trabajando, así que este número es directamente dinero: un mensaje que
 * mencione a ocho agentes dispara ocho sesiones.
 */
export const MAX_GROUP_AGENTS = 8;

/**
 * Cuántos turnos seguidos pueden encadenar los agentes SIN que escriba una
 * persona. Al tercero, la cadena se corta.
 *
 * Dos y no uno porque uno mataría el caso legítimo que Nicolás quiere: un
 * agente le pasa un dato a otro y ese otro responde. Dos y no cinco porque
 * cada eslabón de más es una sesión de Claude completa gastada sin que nadie
 * la haya pedido.
 */
export const MAX_TURNOS_AGENTE_SEGUIDOS = 2;

/** Texto del mensaje de sistema con el que se corta la cadena. */
export const AVISO_CADENA_CORTADA =
  'Se detuvo la conversación automática entre asistentes: llevaban ' +
  `${MAX_TURNOS_AGENTE_SEGUIDOS} turnos seguidos sin que participara una persona. ` +
  'Escriba en el grupo para continuar.';

/* ==================================================================== */
/* FUNCIONES PURAS — menciones                                          */
/* ==================================================================== */

/**
 * Extrae los "candidatos a mención" de un cuerpo Markdown: todo lo que venga
 * detrás de una arroba.
 *
 * Se devuelve en minúsculas y sin la arroba. NO se resuelve aquí contra los
 * agentes del grupo (eso es `resolverAgentesMencionados`): separar las dos
 * cosas permite probar el reconocimiento del texto sin base de datos.
 *
 * Detalles que importan y que se descubren solo con texto real:
 *  - Los `@handle` de la flota llevan guion bajo (`@plan_gss_bot`), así que el
 *    guion bajo ES parte del nombre. También el punto y el guion.
 *  - Una arroba pegada a una letra por la izquierda NO es mención: en un
 *    correo (`nicolas.rivera@gsslatam.com`) la arroba va detrás de texto. Sin
 *    esta condición, cada correo escrito en el grupo mencionaría al inexistente
 *    agente "gsslatam.com".
 *  - Dentro de un bloque de código no se menciona a nadie: pegar un fragmento
 *    con arrobas no debe despertar a media flota.
 */
export function extraerMenciones(body: string): string[] {
  if (typeof body !== 'string' || body.length === 0) return [];

  // Fuera los bloques cercados y el código en línea, para que un fragmento
  // pegado no dispare menciones.
  const sinCodigo = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ');

  const encontrados: string[] = [];
  // (^|[^\w@.]) = la arroba tiene que venir tras un inicio o un separador,
  // nunca pegada a texto (eso sería un correo).
  const re = /(^|[^\w@.])@([A-Za-z0-9][A-Za-z0-9_.\-]{0,59})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sinCodigo)) !== null) {
    // Se recorta un punto o guion final: en "avísale a @plan." el punto es
    // puntuación de la frase, no parte del nombre.
    const nombre = m[2].replace(/[.\-_]+$/, '').toLowerCase();
    if (nombre.length > 0 && !encontrados.includes(nombre)) encontrados.push(nombre);
  }
  return encontrados;
}

/** Forma mínima de un agente para resolver menciones. */
export interface AgenteMencionable {
  idAgent: number;
  code: string;
  displayName: string;
  handle: string | null;
}

/**
 * Cruza los candidatos del texto con los agentes que están en el grupo.
 *
 * Se acepta el `@handle` de Telegram, el `code` y el nombre visible: la gente
 * escribe `@plan`, `@Plan` o `@plan_gss_bot` según de dónde venga, y las tres
 * formas apuntan al mismo agente. Un candidato que no corresponda a ningún
 * agente DEL GRUPO se ignora en silencio — mencionar a alguien que no está no
 * es un error del que escribe.
 */
export function resolverAgentesMencionados(
  body: string,
  agentesDelGrupo: AgenteMencionable[]
): AgenteMencionable[] {
  const candidatos = extraerMenciones(body);
  if (candidatos.length === 0) return [];

  const porNombre = new Map<string, AgenteMencionable>();
  for (const a of agentesDelGrupo) {
    porNombre.set(a.code.toLowerCase(), a);
    porNombre.set(a.displayName.toLowerCase().replace(/\s+/g, ''), a);
    if (a.handle) porNombre.set(a.handle.replace(/^@/, '').toLowerCase(), a);
  }

  const resultado: AgenteMencionable[] = [];
  for (const c of candidatos) {
    const encontrado = porNombre.get(c);
    if (encontrado && !resultado.some((r) => r.idAgent === encontrado.idAgent)) {
      resultado.push(encontrado);
    }
  }
  return resultado;
}

/* ==================================================================== */
/* FUNCIONES PURAS — tope contra el bucle                               */
/* ==================================================================== */

/** Lo mínimo que hace falta de un mensaje para contar turnos. */
export interface MensajeParaConteo {
  role: string;
  id_agent_author?: number | null;
}

/**
 * Cuenta cuántos mensajes de AGENTE hay al final del hilo sin que se haya
 * cruzado uno de una persona.
 *
 * Recibe los mensajes en orden ASCENDENTE (el último al final) y camina hacia
 * atrás. Los mensajes de sistema se saltan: son avisos de la propia
 * plataforma, así que no cuentan como turno de nadie **ni reinician la
 * cuenta** — si reiniciaran, el aviso de "corté la cadena" habilitaría dos
 * turnos más y el tope no serviría para nada.
 */
export function contarTurnosDeAgenteAlFinal(mensajes: MensajeParaConteo[]): number {
  let turnos = 0;
  for (let i = mensajes.length - 1; i >= 0; i--) {
    const rol = mensajes[i].role;
    if (rol === 'agent') {
      turnos += 1;
      continue;
    }
    if (rol === 'system') continue;
    // Cualquier cosa escrita por una persona reinicia la cuenta.
    break;
  }
  return turnos;
}

/**
 * ¿Se le puede entregar este mensaje a otro agente?
 *
 * `turnosPrevios` es lo que devuelve `contarTurnosDeAgenteAlFinal` ANTES de
 * escribir el mensaje nuevo. Un mensaje escrito por una PERSONA siempre pasa:
 * el tope existe para las cadenas entre agentes, no para frenar a la gente.
 */
export function puedeEntregarseAAgentes(
  autorEsAgente: boolean,
  turnosPrevios: number,
  tope: number = MAX_TURNOS_AGENTE_SEGUIDOS
): boolean {
  if (!autorEsAgente) return true;
  // El mensaje que se está escribiendo sería el turno `turnosPrevios + 1`. Se
  // permite mientras no pase del tope: con tope 2, el tercero se corta.
  return turnosPrevios < tope;
}

/* ==================================================================== */
/* ACCESO A LA BASE                                                     */
/* ==================================================================== */

/** Un grupo tal como lo necesita la autorización. */
export interface GrupoResuelto {
  id: number;
  title: string | null;
  idCompany: number | null;
  /** Papel del usuario que preguntó, dentro del grupo. */
  role: ParticipantRole;
  agentes: AgenteMencionable[];
}

/**
 * Autorización de un usuario sobre un GRUPO (anti-IDOR).
 *
 * Espejo de `assertConversationOwnership` para los hilos directos, pero la
 * pertenencia NO se lee de `chat_conversation.id_user` (que en un grupo es
 * solo "quien lo creó"): se lee de `chat_participant`.
 *
 * Se exigen LAS DOS condiciones, igual que en el camino directo:
 *   (a) el usuario es participante del grupo, y
 *   (b) el usuario TODAVÍA tiene el subproceso del módulo en la empresa del
 *       grupo. Si le revocan el acceso al módulo en esa empresa, deja de ver
 *       el grupo aunque siga figurando como integrante — no hay que acordarse
 *       de sacarlo a mano.
 *
 * Devuelve null si el grupo no existe, no es un grupo, el usuario no está, o
 * perdió el permiso.
 */
export async function assertGroupAccess(
  userEmail: string,
  userId: string,
  conversationId: number
): Promise<GrupoResuelto | null> {
  if (!Number.isInteger(conversationId) || conversationId <= 0) return null;

  const grupo = await prisma.chatConversation.findFirst({
    where: { id: conversationId, kind: 'group' },
    select: {
      id: true,
      title: true,
      id_company: true,
      participants: {
        select: {
          id_user: true,
          id_agent: true,
          role: true,
          agent: { select: { id_agent: true, code: true, display_name: true, handle: true } },
        },
      },
    },
  });
  if (!grupo) return null;

  const mio = grupo.participants.find((p) => p.id_user === userId);
  if (!mio) return null;

  // (b) el permiso del módulo en la empresa del grupo sigue vigente.
  if (grupo.id_company !== null) {
    const tienePermiso = await prisma.subprocessUserCompany.findFirst({
      where: {
        subprocess: { subprocess_url: CHAT_MODULE_URL },
        companyUser: { id_company: grupo.id_company, user: { email: userEmail } },
      },
      select: { id_subprocess_user_company: true },
    });
    if (!tienePermiso) return null;
  }

  return {
    id: grupo.id,
    title: grupo.title,
    idCompany: grupo.id_company,
    role: mio.role === 'owner' ? 'owner' : 'member',
    agentes: grupo.participants
      .filter((p) => p.agent !== null)
      .map((p) => ({
        idAgent: p.agent!.id_agent,
        code: p.agent!.code,
        displayName: p.agent!.display_name,
        handle: p.agent!.handle,
      })),
  };
}

/**
 * Autorización del lado del AGENTE sobre un grupo (espejo de
 * `assertAgentConversation`): el agente debe ser participante.
 *
 * El id_agent sale SIEMPRE de la llave Bearer, nunca del payload.
 */
export async function assertAgentGroup(
  idAgent: number,
  conversationId: unknown
): Promise<{ id: number; title: string | null; agentes: AgenteMencionable[] } | null> {
  if (
    typeof conversationId !== 'number' ||
    !Number.isInteger(conversationId) ||
    conversationId <= 0
  ) {
    return null;
  }

  const grupo = await prisma.chatConversation.findFirst({
    where: {
      id: conversationId,
      kind: 'group',
      // ANCLA DE SEGURIDAD: el agente tiene que estar en el grupo.
      participants: { some: { id_agent: idAgent } },
    },
    select: {
      id: true,
      title: true,
      participants: {
        where: { id_agent: { not: null } },
        select: { agent: { select: { id_agent: true, code: true, display_name: true, handle: true } } },
      },
    },
  });
  if (!grupo) return null;

  return {
    id: grupo.id,
    title: grupo.title,
    agentes: grupo.participants
      .filter((p) => p.agent !== null)
      .map((p) => ({
        idAgent: p.agent!.id_agent,
        code: p.agent!.code,
        displayName: p.agent!.display_name,
        handle: p.agent!.handle,
      })),
  };
}

/**
 * Prepara las filas de entrega de un mensaje de grupo: una por agente
 * mencionado, EXCLUYENDO al propio autor si el autor es un agente (nadie se
 * menciona a sí mismo para trabajar).
 *
 * Devuelve además si la cadena se cortó por el tope, para que el endpoint
 * pueda dejar el aviso de sistema.
 */
export function calcularEntregas(opciones: {
  body: string;
  agentesDelGrupo: AgenteMencionable[];
  idAgentAutor: number | null;
  turnosPrevios: number;
}): { idAgents: number[]; cadenaCortada: boolean } {
  const { body, agentesDelGrupo, idAgentAutor, turnosPrevios } = opciones;

  const mencionados = resolverAgentesMencionados(body, agentesDelGrupo).filter(
    (a) => a.idAgent !== idAgentAutor
  );

  if (mencionados.length === 0) return { idAgents: [], cadenaCortada: false };

  if (!puedeEntregarseAAgentes(idAgentAutor !== null, turnosPrevios)) {
    // Había menciones válidas pero el tope las frena: eso SÍ hay que avisarlo.
    return { idAgents: [], cadenaCortada: true };
  }

  return { idAgents: mencionados.map((a) => a.idAgent), cadenaCortada: false };
}
