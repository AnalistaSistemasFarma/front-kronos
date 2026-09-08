/**
 * Cliente del chat de agentes — tipos y llamadas HTTP para el navegador.
 *
 * NO importa prisma ni nada de servidor a propósito: lib/chat/access.ts y
 * lib/chat/conversations.ts sí lo hacen y no pueden entrar en un bundle de
 * cliente. Aquí solo viven los tipos que viajan por la red (espejo de los
 * payloads que devuelven las rutas de app/api/chat) y los ayudantes de fetch.
 */

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
  description: string | null;
  sortOrder: number;
  companies: ChatAgentCompanyDto[];
}

export interface ChatAccessDto {
  canUseChat: boolean;
  /** Solo administradores: habilita el mensaje masivo. La reja real está en el
   *  endpoint; esto es únicamente para saber si pintar el botón. */
  canBroadcast?: boolean;
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

export interface ChatMessageDto {
  id: number;
  role: string;
  body: string;
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  attachments: ChatAttachmentDto[];
  /** Marca local: mensaje aún no confirmado por el servidor (envío optimista). */
  pending?: boolean;
  /** Marca local: el envío falló y el usuario puede reintentar. */
  failed?: boolean;
}

export interface ChatConversationDto {
  id: number;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  archived: boolean;
  agent: {
    idAgent: number;
    code: string;
    displayName: string;
    handle: string | null;
    avatarUrl: string | null;
  };
  lastMessage: { id: number; role: string; preview: string; createdAt: string } | null;
  unreadCount: number;
  agentStatus: ChatStatusDto | null;
}

export interface ChatPollDto {
  messages: ChatMessageDto[];
  cursor: number;
  hasMore: boolean;
  status: ChatStatusDto | null;
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
}

export function describeAgentStatus(status: ChatStatusDto | null): AgentStatusView {
  if (!status || status.state === 'idle') {
    return { label: 'Disponible', color: 'gray', busy: false };
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
