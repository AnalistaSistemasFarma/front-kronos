/**
 * MENSAJES ENTRE PERSONAS — acceso a la base.
 *
 * Las reglas (quién puede escribirle a quién) viven en lib/chat/people-rules.ts
 * y llevan pruebas; aquí solo se cargan los datos que esas reglas necesitan y
 * se aplican. Ver la cabecera de ese archivo para el porqué de cada decisión.
 */
import { createHash } from 'node:crypto';
import { prisma } from '../prisma';
import { CHAT_MODULE_URL } from './access';
import {
  CHAT_PEOPLE_URL,
  MAX_PEOPLE_SEARCH_HITS,
  MIN_PEOPLE_SEARCH_CHARS,
  PEOPLE_SENTINEL_AGENT_CODE,
  SUPPLIER_ROLE_CHAT,
  buildDmKey,
  empresasParaIniciar,
  puedeIniciar,
  puedenEscribirse,
  type PersonaParaAcceso,
} from './people-rules';

export function dmKeyFor(idUserA: string, idUserB: string): string {
  return buildDmKey(idUserA, idUserB, (texto) => createHash('sha256').update(texto).digest('hex'));
}

/**
 * Carga, en DOS consultas para todos, lo que las reglas necesitan de cada
 * persona: si está activa, su rol y en qué empresas tiene el Chat y el piloto.
 * Un id que no exista no aparece en el mapa (y por tanto no puede conversar).
 */
export async function loadPersonasParaAcceso(
  ids: string[]
): Promise<Map<string, PersonaParaAcceso>> {
  const unicos = [...new Set(ids.filter(Boolean))];
  const mapa = new Map<string, PersonaParaAcceso>();
  if (unicos.length === 0) return mapa;

  const [usuarios, permisos] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: unicos } },
      select: { id: true, isActive: true, role: true },
    }),
    prisma.subprocessUserCompany.findMany({
      where: {
        companyUser: { id_user: { in: unicos } },
        subprocess: { subprocess_url: { in: [CHAT_MODULE_URL, CHAT_PEOPLE_URL] } },
      },
      select: {
        companyUser: { select: { id_user: true, id_company: true } },
        subprocess: { select: { subprocess_url: true } },
      },
    }),
  ]);

  const chat = new Map<string, Set<number>>();
  const piloto = new Map<string, Set<number>>();
  for (const p of permisos) {
    const destino = p.subprocess.subprocess_url === CHAT_MODULE_URL ? chat : piloto;
    const id = p.companyUser.id_user;
    let set = destino.get(id);
    if (!set) {
      set = new Set<number>();
      destino.set(id, set);
    }
    set.add(p.companyUser.id_company);
  }

  for (const u of usuarios) {
    mapa.set(u.id, {
      id: u.id,
      isActive: u.isActive,
      role: u.role,
      empresasChat: chat.get(u.id) ?? new Set<number>(),
      empresasPersonas: piloto.get(u.id) ?? new Set<number>(),
    });
  }
  return mapa;
}

/** ¿Tiene esta persona el piloto habilitado (puede INICIAR hilos)? */
export async function canStartPeopleChats(userId: string): Promise<boolean> {
  const perfil = (await loadPersonasParaAcceso([userId])).get(userId);
  return perfil ? empresasParaIniciar(perfil).length > 0 : false;
}

/**
 * Id del agente centinela (ver PEOPLE_SENTINEL_AGENT_CODE). Se guarda en
 * memoria del proceso: no cambia nunca y se pide en cada hilo nuevo. `null`
 * si falta sembrarlo (prisma/seeds/chat-personas.sql): el endpoint lo informa
 * en vez de inventar un agente.
 */
let centinelaCache: number | null = null;
export async function getPeopleSentinelAgentId(): Promise<number | null> {
  if (centinelaCache !== null) return centinelaCache;
  const agente = await prisma.agent.findUnique({
    where: { code: PEOPLE_SENTINEL_AGENT_CODE },
    select: { id_agent: true },
  });
  centinelaCache = agente?.id_agent ?? null;
  return centinelaCache;
}

/** Un hilo entre personas tal como lo necesita la autorización. */
export interface HiloDePersonas {
  id: number;
  /** La OTRA persona del hilo. */
  otherUserId: string;
  /** Mi fila de participante (marca de lectura, zumbidos). */
  myParticipantId: number;
}

/**
 * Autorización de una persona sobre un hilo `kind = 'people'` (anti-IDOR).
 *
 * Exige LAS DOS cosas: que sea uno de los dos participantes y que la regla D1
 * se siga cumpliendo HOY entre los dos (ver `puedenEscribirse`). Si a
 * cualquiera de los dos le quitan el módulo, lo desactivan o lo pasan a
 * proveedor, el hilo se cierra para los dos en la siguiente vuelta.
 *
 * Devuelve null si no existe, no es de esta clase, no es suyo o ya no cumple.
 */
export async function assertPeopleAccess(
  userId: string,
  conversationId: number
): Promise<HiloDePersonas | null> {
  if (!Number.isInteger(conversationId) || conversationId <= 0) return null;

  const hilo = await prisma.chatConversation.findFirst({
    where: { id: conversationId, kind: 'people' },
    select: {
      id: true,
      participants: { select: { id_participant: true, id_user: true } },
    },
  });
  if (!hilo) return null;

  const mio = hilo.participants.find((p) => p.id_user === userId);
  const otro = hilo.participants.find((p) => p.id_user !== null && p.id_user !== userId);
  if (!mio || !otro?.id_user) return null;

  const perfiles = await loadPersonasParaAcceso([userId, otro.id_user]);
  const yo = perfiles.get(userId);
  const el = perfiles.get(otro.id_user);
  if (!yo || !el || !puedenEscribirse(yo, el)) return null;

  return { id: hilo.id, otherUserId: otro.id_user, myParticipantId: mio.id_participant };
}

/**
 * Ids de los hilos entre personas que ESTE usuario puede ver hoy.
 *
 * Es la rama `people` de conversationScopeFor (lib/chat/conversations.ts):
 * la bandeja y el buscador de mensajes ven exactamente lo mismo. Tres
 * consultas para todos los hilos juntos, no una por hilo.
 */
export async function visiblePeopleConversationIds(userId: string): Promise<number[]> {
  const mias = await prisma.chatParticipant.findMany({
    where: { id_user: userId, conversation: { kind: 'people' } },
    select: {
      id_conversation: true,
      conversation: { select: { participants: { select: { id_user: true } } } },
    },
  });
  if (mias.length === 0) return [];

  const otroPorHilo = new Map<number, string>();
  for (const fila of mias) {
    const otro = fila.conversation.participants.find(
      (p) => p.id_user !== null && p.id_user !== userId
    )?.id_user;
    if (otro) otroPorHilo.set(fila.id_conversation, otro);
  }

  const perfiles = await loadPersonasParaAcceso([userId, ...otroPorHilo.values()]);
  const yo = perfiles.get(userId);
  if (!yo) return [];

  const visibles: number[] = [];
  for (const [idConversation, otro] of otroPorHilo) {
    const el = perfiles.get(otro);
    if (el && puedenEscribirse(yo, el)) visibles.push(idConversation);
  }
  return visibles;
}

/** Una persona encontrada por el buscador. */
export interface PersonaEncontrada {
  id: string;
  name: string;
  email: string;
  image: string | null;
  /** Si ya existe un hilo con ella, su id (para abrirlo sin crear nada). */
  idConversation: number | null;
}

/**
 * Buscador de personas del piloto.
 *
 * Solo devuelve a quien `userId` PUEDE iniciar (regla D2), así que no sirve
 * como directorio de todo el grupo: solo aparece gente con la que se comparte
 * una empresa donde uno tiene el piloto. Mínimo dos caracteres y tope de
 * veinte, por el mismo motivo.
 */
export async function searchPeople(userId: string, termino: string): Promise<PersonaEncontrada[]> {
  const q = termino.trim();
  if (q.length < MIN_PEOPLE_SEARCH_CHARS) return [];

  const yo = (await loadPersonasParaAcceso([userId])).get(userId);
  if (!yo) return [];
  const empresas = empresasParaIniciar(yo);
  if (empresas.length === 0) return [];

  const candidatos = await prisma.user.findMany({
    where: {
      id: { not: userId },
      isActive: true,
      role: { not: SUPPLIER_ROLE_CHAT },
      OR: [{ name: { contains: q } }, { email: { contains: q } }],
      companyUsers: {
        some: {
          id_company: { in: empresas },
          subprocesses: { some: { subprocess: { subprocess_url: CHAT_MODULE_URL } } },
        },
      },
    },
    select: { id: true, name: true, email: true, image: true },
    orderBy: [{ name: 'asc' }, { email: 'asc' }],
    take: MAX_PEOPLE_SEARCH_HITS,
  });
  if (candidatos.length === 0) return [];

  // La consulta ya filtra por empresa, pero la regla se vuelve a aplicar con
  // la misma función que usan los demás endpoints: una sola definición de
  // "quién puede", no dos que se desincronicen.
  const perfiles = await loadPersonasParaAcceso(candidatos.map((c) => c.id));
  const elegibles = candidatos.filter((c) => {
    const el = perfiles.get(c.id);
    return el ? puedeIniciar(yo, el) : false;
  });

  const claves = new Map(elegibles.map((c) => [dmKeyFor(userId, c.id), c.id]));
  const existentes = claves.size
    ? await prisma.chatConversation.findMany({
        where: { kind: 'people', dm_key: { in: [...claves.keys()] } },
        select: { id: true, dm_key: true },
      })
    : [];
  const hiloPorPersona = new Map<string, number>();
  for (const h of existentes) {
    const persona = h.dm_key ? claves.get(h.dm_key) : undefined;
    if (persona) hiloPorPersona.set(persona, h.id);
  }

  return elegibles.map((c) => ({
    id: c.id,
    name: c.name?.trim() || c.email,
    email: c.email,
    image: c.image,
    idConversation: hiloPorPersona.get(c.id) ?? null,
  }));
}

export type AbrirHiloResultado =
  | { ok: true; idConversation: number; created: boolean }
  | { ok: false; status: 403 | 404 | 503; error: string };

/**
 * Abre (o crea) el hilo entre `userId` y `otherUserId`. Idempotente: un par =
 * un hilo, garantizado por `dm_key` y su índice único filtrado.
 *
 * Si las dos personas lo abren al mismo tiempo, una de las dos inserciones
 * choca contra el índice único; en vez de devolver un error se RELEE el hilo
 * que ganó, que es lo que las dos querían.
 */
export async function openPeopleConversation(
  userId: string,
  otherUserId: string
): Promise<AbrirHiloResultado> {
  if (!otherUserId || otherUserId === userId) {
    return { ok: false, status: 404, error: 'Persona no encontrada.' };
  }

  const perfiles = await loadPersonasParaAcceso([userId, otherUserId]);
  const yo = perfiles.get(userId);
  const el = perfiles.get(otherUserId);
  // 404 y no 403 si la persona no existe: no se confirma quién está en el
  // sistema a quien prueba ids.
  if (!yo || !el) return { ok: false, status: 404, error: 'Persona no encontrada.' };

  const dmKey = dmKeyFor(userId, otherUserId);
  const existente = await prisma.chatConversation.findFirst({
    where: { kind: 'people', dm_key: dmKey },
    select: { id: true },
  });

  if (existente) {
    // Reabrir un hilo que ya existe exige la regla D1 (el otro pudo haberlo
    // iniciado; yo no necesito el piloto para contestarle).
    if (!puedenEscribirse(yo, el)) {
      return { ok: false, status: 403, error: 'Ya no puede escribirle a esta persona.' };
    }
    return { ok: true, idConversation: existente.id, created: false };
  }

  // Crear uno nuevo exige la regla D2: el piloto en una empresa compartida.
  if (!puedeIniciar(yo, el)) {
    return { ok: false, status: 403, error: 'No puede iniciar una conversación con esta persona.' };
  }

  const idAgent = await getPeopleSentinelAgentId();
  if (idAgent === null) {
    console.error(
      `[chat/people] falta el agente centinela '${PEOPLE_SENTINEL_AGENT_CODE}' (prisma/seeds/chat-personas.sql).`
    );
    return {
      ok: false,
      status: 503,
      error: 'Los mensajes entre personas todavía no están configurados en este entorno.',
    };
  }

  try {
    const creado = await prisma.chatConversation.create({
      data: {
        kind: 'people',
        dm_key: dmKey,
        id_user: userId,
        created_by: userId,
        id_agent: idAgent,
        title: null,
        participants: {
          create: [
            { id_user: userId, role: 'member' },
            { id_user: otherUserId, role: 'member' },
          ],
        },
      },
      select: { id: true },
    });
    return { ok: true, idConversation: creado.id, created: true };
  } catch (error) {
    // Carrera: el otro lo creó entre la lectura y la inserción (P2002 en el
    // índice único de dm_key). Se relee y se devuelve el que ganó.
    const ganador = await prisma.chatConversation.findFirst({
      where: { kind: 'people', dm_key: dmKey },
      select: { id: true },
    });
    if (ganador) return { ok: true, idConversation: ganador.id, created: false };
    throw error;
  }
}
