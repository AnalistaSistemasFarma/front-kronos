/**
 * CONVERSACIONES (hilos) de un proyecto — reglas PURAS (sin base de datos).
 *
 * Pedido de Nicolás Rivera (2026-10-29, 17:45 COT):
 *   1. que VARIOS agentes puedan consultar un hilo del proyecto;
 *   2. renombrar los hilos;
 *   3. eliminarlos.
 *
 * -------------------------------------------------------------------------
 * MULTIAGENTE: MENCIONES DENTRO DEL HILO
 * -------------------------------------------------------------------------
 * Cada hilo sigue siendo de UN agente principal (chat_conversation.id_agent),
 * con su sesión y su puente. Además, quien escribe puede MENCIONAR con @ a otro
 * agente DESIGNADO en el proyecto al que él mismo le puede escribir (la misma
 * regla de escritura de siempre: rol, agente vigente y asignado en la empresa).
 * Ese agente recibe el mensaje por SU puente (fila en chat_message_delivery,
 * el mismo mecanismo de los grupos), lee el historial del hilo y responde en
 * el mismo hilo con su nombre y su avatar.
 *
 *   - Sin menciones → como siempre: solo el principal.
 *   - Menciona SOLO a otros → responden los mencionados; el principal NO (no
 *     se duplican respuestas ni consumo). Lo ve en el historial en su próximo turno.
 *   - Menciona al principal y a otros → responden todos los mencionados.
 *   - Los agentes NO se invocan entre ellos dentro de un proyecto (sin cadenas
 *     ni bucles de consumo): solo una persona despierta a otro agente.
 *
 * -------------------------------------------------------------------------
 * RENOMBRAR Y ELIMINAR
 * -------------------------------------------------------------------------
 * Pueden: quien CREÓ el hilo (si todavía escribe en el proyecto), el DUEÑO del
 * proyecto y un ADMINISTRADOR de SynerLink que sea miembro. Eliminar es LÓGICO:
 * el hilo deja de verse y los agentes dejan de atenderlo; los mensajes y los
 * adjuntos se conservan. Todo queda en chat_project_conversation_log.
 */
import { MAX_TITLE_CHARS } from '../chat/constants';
import { resolverAgentesMencionados, type AgenteMencionable } from '../chat/groups';
import { capabilitiesFor, type ProjectRole } from '../chat/projects-rules';

/** Título de un hilo: obligatorio al renombrar, una línea y con tope. */
export const MAX_TITULO_HILO_CHARS = Math.min(120, MAX_TITLE_CHARS);

export type ValidacionTitulo = { ok: true; value: string } | { ok: false; error: string };

export function normalizarTituloHilo(raw: unknown): ValidacionTitulo {
  if (typeof raw !== 'string') return { ok: false, error: 'Escriba el nuevo nombre de la conversación.' };
  const value = raw.replace(/\s+/g, ' ').trim();
  if (!value) return { ok: false, error: 'Escriba el nuevo nombre de la conversación.' };
  if (value.length > MAX_TITULO_HILO_CHARS) {
    return { ok: false, error: `El nombre no puede pasar de ${MAX_TITULO_HILO_CHARS} caracteres.` };
  }
  return { ok: true, value };
}

/** Quién pide y sobre qué hilo, para decidir si puede renombrarlo o eliminarlo. */
export interface ActorHilo {
  actorId: string;
  role: ProjectRole;
  /** Administrador de SynerLink (checkAdminPrivileges). Igual debe ser miembro: la puerta va antes. */
  esAdmin: boolean;
  /** created_by del hilo (NULL en hilos viejos sin dato). */
  creadoPor: string | null;
  proyectoArchivado: boolean;
}

export type PermisoHilo = { ok: true } | { ok: false; motivo: string };

/**
 * ¿Puede renombrar o eliminar ESTE hilo? (la misma regla para las dos acciones).
 *   - proyecto archivado: nadie (primero se restaura);
 *   - dueño del proyecto o administrador: sí;
 *   - quien lo creó: sí, mientras conserve la escritura (un lector ya no).
 */
export function puedeGestionarHilo(a: ActorHilo): PermisoHilo {
  if (a.proyectoArchivado) return { ok: false, motivo: 'El proyecto está archivado. Restáurelo para hacer cambios.' };
  if (a.role === 'owner' || a.esAdmin) return { ok: true };
  if (a.creadoPor !== null && a.creadoPor === a.actorId && capabilitiesFor(a.role).write) return { ok: true };
  return {
    ok: false,
    motivo: 'Solo quien creó la conversación, el dueño del proyecto o un administrador pueden renombrarla o eliminarla.',
  };
}

/** Agente del proyecto, con lo que hace falta para decidir si se le puede mencionar. */
export interface AgenteDelProyecto extends AgenteMencionable {
  /** La PERSONA le puede escribir (evaluarAgente de lib/chat/projects.ts). */
  puedoEscribir: boolean;
}

/**
 * Agentes que ESTA persona puede mencionar en un hilo: designados en el
 * proyecto, a los que ella misma le puede escribir, y que NO son el principal
 * del hilo (al principal no hace falta mencionarlo).
 */
export function agentesMencionables(agentes: AgenteDelProyecto[], idAgentPrincipal: number): AgenteMencionable[] {
  return agentes
    .filter((a) => a.puedoEscribir && a.idAgent !== idAgentPrincipal)
    .map(({ idAgent, code, displayName, handle }) => ({ idAgent, code, displayName, handle }));
}

/**
 * A quién despierta un mensaje de PERSONA en un hilo de proyecto.
 *
 * `invitados`: otros agentes mencionados (filas de chat_message_delivery).
 * `principalAtiende`: false solo si mencionó a otros y NO al principal.
 */
export function entregasHiloProyecto(opciones: {
  body: string;
  mencionables: AgenteMencionable[];
  principal: AgenteMencionable;
}): { invitados: number[]; principalAtiende: boolean } {
  const { body, mencionables, principal } = opciones;
  if (mencionables.length === 0 || !body.includes('@')) return { invitados: [], principalAtiende: true };
  const resueltos = resolverAgentesMencionados(body, [principal, ...mencionables.filter((m) => m.idAgent !== principal.idAgent)]);
  const invitados = resueltos.filter((a) => a.idAgent !== principal.idAgent).map((a) => a.idAgent);
  if (invitados.length === 0) return { invitados: [], principalAtiende: true };
  const principalMencionado = resueltos.some((a) => a.idAgent === principal.idAgent);
  return { invitados, principalAtiende: principalMencionado };
}

/* ───────────────────────── Historial para el agente ───────────────────────── */

/** Mensajes del hilo que viajan en el contexto del puente (los más recientes). */
export const MAX_HISTORIAL_MENSAJES = 40;
/** Tope de cada mensaje en el historial: el contexto no debe crecer sin control. */
export const MAX_HISTORIAL_CHARS_MENSAJE = 4_000;

export interface FilaHistorial {
  id: number;
  role: string;
  body: string;
  created_at: Date;
  userAuthor: { name: string | null; email: string } | null;
  agentAuthor: { id_agent: number; code: string; display_name: string } | null;
  attachments: { file_name: string }[];
}

export interface MensajeHistorial {
  id: number;
  role: 'user' | 'agent' | 'system';
  author: string;
  agentCode: string | null;
  createdAt: string;
  body: string;
  attachments: string[];
}

/** Recorta y da forma al historial (recibe las filas en orden ascendente). */
export function historialParaAgente(filas: FilaHistorial[]): MensajeHistorial[] {
  return filas.map((f) => {
    const role = f.role === 'agent' ? 'agent' : f.role === 'system' ? 'system' : 'user';
    const author =
      role === 'agent'
        ? f.agentAuthor?.display_name ?? 'Asistente'
        : role === 'system'
          ? 'SynerLink'
          : f.userAuthor?.name?.trim() || f.userAuthor?.email || 'Persona';
    const body =
      f.body.length > MAX_HISTORIAL_CHARS_MENSAJE ? `${f.body.slice(0, MAX_HISTORIAL_CHARS_MENSAJE)}… [recortado]` : f.body;
    return {
      id: f.id,
      role,
      author,
      agentCode: role === 'agent' ? f.agentAuthor?.code ?? null : null,
      createdAt: f.created_at.toISOString(),
      body,
      attachments: f.attachments.map((a) => a.file_name),
    };
  });
}
