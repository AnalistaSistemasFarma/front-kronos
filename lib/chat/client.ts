/**
 * Cliente del chat de agentes — tipos y llamadas HTTP para el navegador.
 *
 * NO importa prisma ni nada de servidor a propósito: lib/chat/access.ts y
 * lib/chat/conversations.ts sí lo hacen y no pueden entrar en un bundle de
 * cliente. Aquí solo viven los tipos que viajan por la red (espejo de los
 * payloads que devuelven las rutas de app/api/chat) y los ayudantes de fetch.
 */

/* ──────────────────────── Foto de un asistente ─────────────────────────── */

/** Tope de la imagen ya reducida. 512×512 en JPEG no llega ni a 100 KB. */
export const MAX_AVATAR_BYTES = 512 * 1024;
/** Formatos que se aceptan al subir. */
export const AVATAR_MIMES_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'];
/** Lado del cuadrado al que el navegador reduce la imagen antes de subirla. */
export const AVATAR_LADO = 512;

/**
 * De dónde sale la imagen de un asistente.
 *
 * Si le subieron una, va por el endpoint que la lee de la base, CON la versión
 * en la URL: así se puede cachear un año y aun así cambiar al instante cuando
 * la reemplacen. Si no, se queda con la ruta de siempre dentro de /public, y
 * si tampoco hay, `null` y la interfaz cae al avatar por inicial.
 */
export function agentAvatarSrc(agent: {
  code: string;
  avatarUrl: string | null;
  avatarVersion?: number | null;
}): string | null {
  if (agent.avatarVersion) {
    return `/api/chat/agents/${encodeURIComponent(agent.code)}/avatar?v=${agent.avatarVersion}`;
  }
  return agent.avatarUrl || null;
}

/* ─────────────────────── Buscador de mensajes ──────────────────────────── */

/** Mínimo de caracteres para buscar. Con uno o dos, todo coincide con todo. */
export const MIN_SEARCH_CHARS = 3;
/** Tope de resultados. El buscador es para encontrar, no para exportar. */
export const MAX_SEARCH_HITS = 40;

/**
 * Un mensaje encontrado, con lo justo para pintarlo y para poder abrirlo.
 *
 * Vive aquí y no en lib/chat/search.ts porque ese módulo importa prisma y no
 * puede entrar en un bundle de cliente; el buscador de la pantalla sí necesita
 * este tipo y el mínimo de caracteres.
 */
export interface ChatSearchHit {
  idMessage: number;
  idConversation: number;
  kind: 'direct' | 'group';
  /** Nombre del agente en un hilo directo; título en un grupo. */
  conversationTitle: string;
  /** `code` del agente: es con lo que la interfaz abre un hilo directo. */
  agentCode: string | null;
  /** Quién escribió: la persona, el agente, o el sistema. */
  author: string;
  /** Extracto alrededor de la coincidencia, en texto plano. */
  snippet: string;
  createdAt: string;
}

/* ────────────────── Tipos que devuelve la API (fase 2b) ────────────────── */

export interface ChatAgentCompanyDto {
  idCompany: number;
  companyName: string;
  isPrimary: boolean;
}

export interface ChatAgentDto {
  idAgent: number;
  code: string;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  /** Marca de tiempo de la foto SUBIDA, o null si no le han subido ninguna.
   *  Es también el número de versión de la URL (ver `agentAvatarSrc`). */
  avatarVersion: number | null;
  description: string | null;
  sortOrder: number;
  companies: ChatAgentCompanyDto[];
}

export interface ChatAccessDto {
  canUseChat: boolean;
  /** Solo administradores: habilita el mensaje masivo. La reja real está en el
   *  endpoint; esto es únicamente para saber si pintar el botón. */
  canBroadcast?: boolean;
  /** Solo administradores: habilita crear grupos. Igual que arriba, la reja
   *  real está en POST /api/chat/groups. */
  canCreateGroups?: boolean;
  companies: ChatAgentCompanyDto[];
  agents: ChatAgentDto[];
}

/**
 * Sub-agentes en curso. El tipo vive en lib/chat/status-tasks.ts, que es el
 * único que valida y parsea ese JSON; aquí se re-exporta para que los
 * componentes lo importen del mismo lugar que el resto de los DTO.
 */
export type { AgentTaskDto } from './status-tasks';
import type { AgentTaskDto } from './status-tasks';

export interface ChatStatusDto {
  state: string;
  label: string | null;
  /**
   * Sub-agentes en curso, para la tablita de "qué está corriendo". Opcional a
   * propósito: una respuesta vieja (o un front desplegado antes que la API) no
   * la trae, y la interfaz simplemente no pinta la tabla.
   */
  tasks?: AgentTaskDto[];
  updatedAt: string;
}

export interface ChatAttachmentDto {
  id: number;
  fileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  /** Siempre /api/chat/attachments/<id>: el contenido pasa por la aplicación. */
  downloadUrl: string;
}

/**
 * Quién escribió un mensaje. En un hilo directo el `role` alcanzaba; en un
 * GRUPO hay que decir cuál de las personas o cuál de los agentes.
 * `null` en los mensajes de sistema: no los escribió nadie.
 *
 * Opcional a propósito: una respuesta vieja (o un front desplegado antes que
 * la API) no lo trae y el hilo directo se pinta como siempre.
 */
export interface ChatAuthorDto {
  kind: 'user' | 'agent';
  id: string | number;
  name: string;
  avatarUrl: string | null;
}

/**
 * El mensaje CITADO, tal como se pinta encima de la respuesta.
 *
 * Viaja recortado (`preview`) y con el nombre del autor ya resuelto: la
 * interfaz no tiene que volver a buscar nada, y un mensaje citado larguísimo
 * no se manda entero para pintar dos renglones.
 */
export interface ChatReplyToDto {
  idMessage: number;
  author: string;
  preview: string;
}

export interface ChatMessageDto {
  id: number;
  role: string;
  body: string;
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  attachments: ChatAttachmentDto[];
  author?: ChatAuthorDto | null;
  /** El mensaje al que responde, o null. */
  replyTo?: ChatReplyToDto | null;
  /** Marca local: mensaje aún no confirmado por el servidor (envío optimista). */
  pending?: boolean;
  /** Marca local: el envío falló y el usuario puede reintentar. */
  failed?: boolean;
}

/** Un integrante de un grupo. */
export interface ChatParticipantDto {
  kind: 'user' | 'agent';
  id: string | number;
  name: string;
  avatarUrl: string | null;
  /** El `@handle` del agente; null en las personas. */
  handle: string | null;
  role: string;
}

/** Indicador de "qué está haciendo" de UN agente dentro de la conversación. */
export interface ChatAgentStatusDto extends ChatStatusDto {
  idAgent: number;
  agentName?: string;
  agentAvatarUrl?: string | null;
}

export interface ChatConversationDto {
  id: number;
  title: string | null;
  /**
   * 'direct' | 'group'. Opcional para que un front viejo siga funcionando: si
   * no viene, se trata como 'direct', que es lo que había antes de los grupos.
   */
  kind?: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  archived: boolean;
  /** En un grupo, el agente ANFITRIÓN (la cara del grupo en la bandeja). */
  agent: {
    idAgent: number;
    code: string;
    displayName: string;
    handle: string | null;
    avatarUrl: string | null;
  };
  /** Empresa del grupo. null en los hilos directos. */
  company?: { idCompany: number; companyName: string } | null;
  /** Integrantes. null en los hilos directos. */
  participants?: ChatParticipantDto[] | null;
  lastMessage: { id: number; role: string; preview: string; createdAt: string } | null;
  unreadCount: number;
  agentStatus: ChatStatusDto | null;
  /** Un estado por agente. En un hilo directo trae, como máximo, uno. */
  agentStatuses?: ChatAgentStatusDto[];
}

/** ¿Es un grupo? Un hilo sin `kind` es de antes de los grupos: es directo. */
export function esGrupo(conversacion: { kind?: string } | null | undefined): boolean {
  return conversacion?.kind === 'group';
}

export interface ChatPollDto {
  messages: ChatMessageDto[];
  cursor: number;
  hasMore: boolean;
  status: ChatStatusDto | null;
  /** Desglose por agente: lo que pinta el encabezado de un grupo. */
  statuses?: ChatAgentStatusDto[];
  /** Cadencia que ORDENA el servidor. El cliente la respeta tal cual. */
  nextPollMs: number;
  serverTime: string;
}

/* ─────────────────────────── Ayudantes de red ─────────────────────────── */

/** `fetch` con las cabeceras y el `no-store` que exigen todas las rutas. */
export async function chatFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

/** GET que devuelve JSON tipado, o null si la respuesta no fue 2xx. */
export async function chatGetJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  const res = await chatFetch(url, { signal });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

/* ──────────────────────── Presentación (puro) ─────────────────────────── */

/** Iniciales del agente para el avatar de respaldo cuando avatar_url es NULL. */
export function agentInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * Color estable derivado del código del agente, para que cada avatar de
 * respaldo tenga su propio matiz y se distingan de un vistazo. Determinista:
 * el mismo agente siempre se ve igual.
 */
const AVATAR_COLORS = [
  'blue',
  'teal',
  'grape',
  'indigo',
  'cyan',
  'violet',
  'orange',
  'lime',
] as const;

export function agentColor(code: string): string {
  let hash = 0;
  for (let i = 0; i < code.length; i += 1) {
    hash = (hash * 31 + code.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/**
 * Cómo se ve el estado del agente en la interfaz.
 *
 * `null` (nunca publicó estado) e `idle` se muestran igual — "Disponible" —
 * porque para el usuario significan lo mismo: no está haciendo nada ahora.
 */
export interface AgentStatusView {
  /** Etiqueta corta para el punto de estado y el tooltip. */
  label: string;
  /** Color de Mantine del punto. */
  color: string;
  /** true mientras el agente está trabajando (anima el punto). */
  busy: boolean;
  /**
   * true cuando el estado dice "trabajando" pero lleva demasiado rato sin
   * refrescarse. Ver ESTADO_RANCIO_MS.
   */
  stale?: boolean;
}

/**
 * Cuánto puede pasar un estado "trabajando" sin refrescarse antes de que deje
 * de creérsele.
 *
 * POR QUÉ EXISTE: el indicador lo publican los hooks del bot, y el hook `Stop`
 * es el que lo baja al terminar. Si la sesión del bot muere de golpe —se le
 * agota la cuota, se le vence la autenticación, se congela, se apaga la
 * máquina— ese `Stop` NUNCA CORRE y el indicador se queda diciendo
 * "trabajando…" para siempre. Nicolás lo reportó así: "el hook se quedó
 * cargando", después de que a Troy se le acabó el consumo y los usuarios
 * tuvieron que esperar hasta las 11 sin saberlo.
 *
 * Un indicador que miente es peor que no tener indicador: el usuario espera de
 * más porque cree que hay alguien trabajando.
 *
 * ⚠️ EL UMBRAL NO MIDE LO QUE DURA LA TAREA, mide CUÁNTO LLEVA SIN REPORTAR.
 * Nicolás hizo justo la objeción correcta: "pero si hay una tarea que demanda
 * más de 5 minutos". Una tarea larga que sigue trabajando sigue reportando —los
 * hooks refrescan el estado en CADA uso de herramienta—, así que no se vuelve
 * rancia por durar. Se vuelve rancia por CALLARSE.
 *
 * El hueco real que queda es un turno que pasa mucho rato razonando sin tocar
 * ninguna herramienta. Por eso el umbral es de DIEZ minutos y no de cinco, y por
 * eso sube a VEINTE cuando el agente reporta sub-agentes en curso: unos
 * sub-agentes trabajando son prueba de que la tarea está viva aunque el padre
 * lleve rato sin publicar nada.
 *
 * Y por eso el aviso está redactado como "no hemos tenido novedades" y no como
 * "está caído": ante la duda, se informa el hecho, no se acusa.
 */
export const ESTADO_RANCIO_MS = 10 * 60 * 1000;

/** Con sub-agentes en curso se es más paciente: son prueba de trabajo vivo. */
export const ESTADO_RANCIO_CON_SUBAGENTES_MS = 20 * 60 * 1000;

/** ¿Este estado dice "trabajando" pero lleva demasiado sin refrescarse? */
export function estadoEstaRancio(status: ChatStatusDto | null): boolean {
  if (!status || status.state === 'idle') return false;
  const marca = Date.parse(status.updatedAt);
  if (Number.isNaN(marca)) return false;
  const umbral =
    status.tasks && status.tasks.length > 0
      ? ESTADO_RANCIO_CON_SUBAGENTES_MS
      : ESTADO_RANCIO_MS;
  return Date.now() - marca > umbral;
}

/**
 * Cuánto se espera, sin respuesta ninguna, antes de avisarle al usuario.
 *
 * Se mide desde SU último mensaje y solo aplica cuando el agente NO está
 * reportando actividad fresca. Es más largo que el umbral del estado a
 * propósito: primero se le da la oportunidad de que el propio indicador
 * muestre que está trabajando.
 */
export const SIN_RESPUESTA_MS = 12 * 60 * 1000;

export function describeAgentStatus(status: ChatStatusDto | null): AgentStatusView {
  if (!status || status.state === 'idle') {
    return { label: 'Disponible', color: 'gray', busy: false };
  }
  // Un "trabajando" viejo no se pinta como trabajando: se avisa. Ver
  // ESTADO_RANCIO_MS para el porqué.
  if (estadoEstaRancio(status)) {
    return { label: 'Sin novedades hace rato', color: 'orange', busy: false, stale: true };
  }
  if (status.state === 'thinking') {
    return { label: status.label?.trim() || 'Pensando…', color: 'blue', busy: true };
  }
  if (status.state === 'tool') {
    return { label: status.label?.trim() || 'Consultando…', color: 'teal', busy: true };
  }
  return { label: status.label?.trim() || status.state, color: 'gray', busy: false };
}

/**
 * Orden de los avatares de la barra superior.
 *
 * Nicolás: "si el usuario tiene acceso a más de 5, ordenar dinámicamente
 * priorizando a los que tienen mensajes pendientes". Con pocos agentes el orden
 * se queda QUIETO (sort_order del catálogo) para que nadie tenga que buscar un
 * avatar que se movió solo; a partir del umbral manda lo pendiente.
 */
export const AGENT_BAR_VISIBLE = 5;

export function sortAgentsForBar<T extends { idAgent: number; sortOrder: number; displayName: string }>(
  agents: T[],
  unreadByAgent: Map<number, number>
): T[] {
  const dynamic = agents.length > AGENT_BAR_VISIBLE;

  return [...agents].sort((a, b) => {
    if (dynamic) {
      const ua = unreadByAgent.get(a.idAgent) ?? 0;
      const ub = unreadByAgent.get(b.idAgent) ?? 0;
      // Primero los que tienen pendientes, y entre ellos el que más tiene.
      if (ua !== ub) return ub - ua;
    }
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.displayName.localeCompare(b.displayName, 'es');
  });
}

/**
 * Resuelve el agente al que apunta una ruta o un parámetro de la URL.
 *
 * Hace falta porque el `code` del catálogo y el último segmento del
 * subproceso-permiso NO siempre coinciden: Orus tiene `code = 'horus'` (es el
 * mismo bot de Telegram, @horus_gss_bot) pero su subproceso es
 * `/process/chat/orus`, que es como lo conoce el usuario. Si se buscara solo
 * por `code`, entrar por el hub de procesos no encontraría a nadie.
 *
 * Se prueba, en orden: el `code`, el nombre visible normalizado y el `handle`
 * sin el `@` ni el sufijo `_gss_bot`.
 */
export function normalizeAgentKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^@/, '')
    .replace(/_gss_bot$/, '')
    .replace(/[^a-z0-9]+/g, '');
}

export function findAgentByRouteKey<T extends ChatAgentDto>(
  agents: T[],
  rawKey: string | null | undefined
): T | null {
  if (!rawKey) return null;
  const key = normalizeAgentKey(rawKey);
  if (!key) return null;

  return (
    agents.find((agent) => normalizeAgentKey(agent.code) === key) ??
    agents.find((agent) => normalizeAgentKey(agent.displayName) === key) ??
    agents.find((agent) => agent.handle && normalizeAgentKey(agent.handle) === key) ??
    null
  );
}

/** Agrupa los agentes por empresa: las "carpetas" de /process/chat. */
export function groupAgentsByCompany(
  agents: ChatAgentDto[]
): { idCompany: number; companyName: string; agents: ChatAgentDto[] }[] {
  const folders = new Map<number, { idCompany: number; companyName: string; agents: ChatAgentDto[] }>();

  for (const agent of agents) {
    // ⚠️ Las carpetas salen de las empresas de los AGENTES PERMITIDOS, nunca de
    // las empresas del usuario (company_user): un usuario puede tener permiso
    // explícito sobre un agente de GSS sin tener fila de GSS, y derivar las
    // carpetas del usuario lo dejaría sin ver a ese agente.
    for (const company of agent.companies) {
      let folder = folders.get(company.idCompany);
      if (!folder) {
        folder = { idCompany: company.idCompany, companyName: company.companyName, agents: [] };
        folders.set(company.idCompany, folder);
      }
      folder.agents.push(agent);
    }
  }

  const list = [...folders.values()];
  list.sort((a, b) => a.companyName.localeCompare(b.companyName, 'es'));
  for (const folder of list) {
    folder.agents.sort(
      (a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName, 'es')
    );
  }
  return list;
}

/**
 * Convierte el extracto Markdown que devuelve la API (`lastMessage.preview`)
 * en texto llano para las tarjetas de la bandeja.
 *
 * El servidor solo aplasta los espacios: si el agente respondió con una tabla,
 * el extracto llega como `### Resumen | Documento | Cantidad | |---|---:|`, que
 * en una tarjeta no dice nada. Aquí se quitan las marcas — nunca se renderiza,
 * solo se limpia — y por eso es seguro: la salida es una cadena que se pinta
 * como texto, jamás como HTML.
 *
 * Las expresiones son todas de un solo cuantificador para no abrir la puerta a
 * un retroceso catastrófico con un extracto malicioso.
 */
export function toPlainPreview(markdown: string): string {
  return markdown
    .replace(/```+/g, ' ')
    .replace(/`/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*{1,3}/g, '')
    .replace(/~{1,2}/g, '')
    .replace(/^\s{0,8}[-*+]\s+/gm, '')
    .replace(/^\s{0,8}>\s?/gm, '')
    .replace(/\|/g, ' ')
    .replace(/-{3,}/g, ' ')
    .replace(/:?-{2,}:?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fecha relativa corta, en español, para la bandeja y las burbujas. */
export function formatChatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const diffMin = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (diffMin < 1) return 'Ahora';
  if (diffMin < 60) return `Hace ${diffMin} min`;

  const sameDay = new Date().toDateString() === date.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleString('es-CO', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Evento que dispara la página del chat cuando cambia algo que la barra de la
 * cabecera debe reflejar de inmediato (p.ej. el usuario leyó un hilo). Evita
 * tener que montar un contexto compartido en el layout: la barra escucha en
 * `window` y refresca sin esperar a su próximo sondeo.
 */
export const CHAT_REFRESH_EVENT = 'synerlink:chat-refresh';

export function notifyChatRefresh(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CHAT_REFRESH_EVENT));
}
