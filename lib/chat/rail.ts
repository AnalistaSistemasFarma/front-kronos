/**
 * Lógica PURA de la barra lateral del chat (components/chat/ChatRail.tsx).
 *
 * Pedido de Nicolás (2026-09-30): con tantos asistentes y personas los chats
 * ya no caben en la cabecera; pasan a una barra lateral izquierda con
 * secciones 📌 Anclados, 🤖 Agentes y 👥 Personas (y los grupos, si la persona
 * tiene alguno), un buscador y el contador de pendientes de cada chat.
 *
 * Todo lo que decide QUÉ se pinta y EN QUÉ ORDEN vive aquí, sin React, para que
 * se pueda probar sin montar la interfaz (lib/chat/rail.test.ts).
 *
 * Orden (aprobado):
 *   1. Anclados primero, en su propia sección.
 *   2. Dentro de cada sección, por actividad reciente: el último mensaje más
 *      nuevo arriba. Un chat sin mensajes va después de los que sí tienen, y
 *      entre ellos manda el orden del catálogo (`sortOrder`) y luego el nombre.
 */

/** Clave estable de un chat de la barra. Es también lo que se guarda al anclar. */
export type ChatRailKey = `agent:${number}` | `conv:${number}`;

export type ChatRailKind = 'agent' | 'people' | 'group';

export interface ChatRailItem {
  key: ChatRailKey;
  kind: ChatRailKind;
  /** Nombre visible: el agente, la OTRA persona o el título del grupo. */
  name: string;
  /** Semilla estable del color del avatar por inicial. */
  avatarCode: string;
  avatarUrl: string | null;
  avatarVersion?: number | null;
  /** Vista previa del último mensaje, ya en texto plano. null = sin mensajes. */
  preview: string | null;
  lastMessageAt: string | null;
  unread: number;
  /** Orden del catálogo (solo agentes). Desempata cuando no hay actividad. */
  sortOrder: number;
  /** Agente: su `code`. Grupo/persona: el id de la conversación. */
  agentCode?: string;
  idAgent?: number;
  idConversation?: number;
  /** El agente atiende un turno con quien sea (aro alrededor del avatar). */
  busy?: boolean;
}

export interface ChatRailSection {
  id: 'pinned' | 'agents' | 'people' | 'groups';
  title: string;
  items: ChatRailItem[];
}

export const MAX_PINS = 50;

const RAIL_KEY_RE = /^(agent|conv):([1-9]\d{0,9})$/;

/** ¿Es una clave válida de la barra? Lo usan el cliente y la ruta /api/chat/pins. */
export function isChatRailKey(value: unknown): value is ChatRailKey {
  if (typeof value !== 'string' || !RAIL_KEY_RE.test(value)) return false;
  const id = Number(value.split(':')[1]);
  return Number.isSafeInteger(id) && id <= 2_147_483_647;
}

export const agentKey = (idAgent: number): ChatRailKey => `agent:${idAgent}`;
export const conversationKey = (id: number): ChatRailKey => `conv:${id}`;

function tiempo(iso: string | null): number {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** Actividad reciente primero; sin actividad, catálogo y luego nombre. */
export function compareByActivity(a: ChatRailItem, b: ChatRailItem): number {
  const ta = tiempo(a.lastMessageAt);
  const tb = tiempo(b.lastMessageAt);
  if (ta !== tb) return tb > ta ? 1 : -1;
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.name.localeCompare(b.name, 'es');
}

/**
 * Orden de las listas de conversaciones (Personas y Grupos de la página del
 * chat), como cualquier mensajería: el último mensaje —enviado o recibido— más
 * nuevo arriba; a igual hora, el id mayor. Las que no tienen mensajes van al
 * final, por nombre. No muta la lista.
 */
export function sortConversationsByActivity<T extends { id: number; lastMessageAt: string | null }>(
  lista: readonly T[],
  nombre: (c: T) => string
): T[] {
  return [...lista].sort((a, b) => {
    const ta = tiempo(a.lastMessageAt);
    const tb = tiempo(b.lastMessageAt);
    if (ta !== tb) return tb > ta ? 1 : -1;
    if (ta === Number.NEGATIVE_INFINITY) {
      const porNombre = nombre(a).localeCompare(nombre(b), 'es');
      if (porNombre !== 0) return porNombre;
    }
    return b.id - a.id;
  });
}

/**
 * Sube la fecha del último mensaje de UNA conversación (envío optimista o
 * mensaje recibido), sin bajarla nunca. Devuelve la MISMA lista si no cambia
 * nada, para no provocar un re-render de balde.
 */
export function bumpConversationActivity<T extends { id: number; lastMessageAt: string | null }>(
  lista: T[],
  idConversation: number,
  at: string
): T[] {
  const nueva = tiempo(at);
  if (nueva === Number.NEGATIVE_INFINITY) return lista;
  let cambio = false;
  const resultado = lista.map((c) => {
    if (c.id !== idConversation || tiempo(c.lastMessageAt) >= nueva) return c;
    cambio = true;
    return { ...c, lastMessageAt: at };
  });
  return cambio ? resultado : lista;
}

/** Minúsculas y sin tildes: "José" se encuentra escribiendo "jose". */
export function normalizeSearch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function matchesSearch(item: ChatRailItem, query: string): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  return normalizeSearch(item.name).includes(q);
}

/**
 * Arma las secciones de la barra.
 *
 * Un chat anclado sale SOLO en "Anclados" (no repetido en su sección), así la
 * lista no crece con duplicados. Las secciones vacías no se devuelven, salvo
 * ninguna: si no queda nada, la barra decide qué mostrar.
 */
export function buildRailSections(
  items: ChatRailItem[],
  /**
   * Las anclas. Con la LISTA (en el orden en que se anclaron) la sección
   * "Anclados" respeta ese orden, el último anclado arriba, como WhatsApp o
   * Telegram; con un Set (forma vieja) se ordena por actividad.
   */
  pinned: ReadonlySet<string> | readonly string[],
  query = ''
): ChatRailSection[] {
  const visibles = items.filter((item) => matchesSearch(item, query));
  const ordenAncla = Array.isArray(pinned)
    ? new Map((pinned as readonly string[]).map((key, i) => [key, i]))
    : null;
  const estaAnclado = (key: string) =>
    ordenAncla ? ordenAncla.has(key) : (pinned as ReadonlySet<string>).has(key);
  const porAncla = (a: ChatRailItem, b: ChatRailItem) =>
    (ordenAncla?.get(b.key) ?? 0) - (ordenAncla?.get(a.key) ?? 0);

  const anclados: ChatRailItem[] = [];
  const agentes: ChatRailItem[] = [];
  const personas: ChatRailItem[] = [];
  const grupos: ChatRailItem[] = [];

  for (const item of visibles) {
    if (estaAnclado(item.key)) anclados.push(item);
    else if (item.kind === 'agent') agentes.push(item);
    else if (item.kind === 'people') personas.push(item);
    else grupos.push(item);
  }

  const secciones: ChatRailSection[] = [
    { id: 'pinned', title: 'Anclados', items: anclados.sort(ordenAncla ? porAncla : compareByActivity) },
    { id: 'agents', title: 'Agentes', items: agentes.sort(compareByActivity) },
    { id: 'people', title: 'Personas', items: personas.sort(compareByActivity) },
    { id: 'groups', title: 'Grupos', items: grupos.sort(compareByActivity) },
  ];
  return secciones.filter((s) => s.items.length > 0);
}

/** Suma de pendientes de una lista de chats (el número del botón del celular). */
export function totalUnread(items: ChatRailItem[]): number {
  let total = 0;
  for (const item of items) total += Math.max(0, item.unread || 0);
  return total;
}

/** Texto corto del contador: nunca más de tres caracteres. */
export function formatUnread(count: number): string {
  if (!count || count < 0) return '';
  return count > 99 ? '99+' : String(count);
}

/** Aplica un anclar/desanclar sobre la lista de anclas, sin duplicar ni pasar del tope. */
export function togglePin(pins: readonly string[], key: string, pinned: boolean): string[] {
  const sin = pins.filter((p) => p !== key);
  if (!pinned) return sin;
  if (sin.length >= MAX_PINS) return [...pins];
  return [...sin, key];
}

/* ─────────────── Construcción de los chats desde la bandeja ─────────────── */

/** Formas mínimas que se leen del overview (evita importar los DTO completos). */
interface AgentLike {
  idAgent: number;
  code: string;
  displayName: string;
  avatarUrl: string | null;
  avatarVersion?: number | null;
  sortOrder: number;
  busy?: boolean;
}

interface ParticipantLike {
  kind: 'user' | 'agent';
  id: string | number;
  name: string;
  avatarUrl: string | null;
}

interface ConversationLike {
  id: number;
  kind?: string;
  title: string | null;
  lastMessageAt: string | null;
  lastMessage: { preview: string } | null;
  unreadCount: number;
  agent: { code: string; displayName: string; avatarUrl: string | null };
  participants?: ParticipantLike[] | null;
}

export function buildRailItems({
  agents,
  conversationByAgent,
  unreadByAgent,
  people,
  groups,
  miId,
  toPreview,
}: {
  agents: AgentLike[];
  conversationByAgent: Map<number, ConversationLike>;
  unreadByAgent: Map<number, number>;
  people: ConversationLike[];
  groups: ConversationLike[];
  miId: string | undefined;
  /** Markdown → texto plano (lib/chat/client.ts, toPlainPreview). */
  toPreview: (markdown: string) => string;
}): ChatRailItem[] {
  const items: ChatRailItem[] = [];

  for (const agent of agents) {
    const conversacion = conversationByAgent.get(agent.idAgent);
    items.push({
      key: agentKey(agent.idAgent),
      kind: 'agent',
      name: agent.displayName,
      avatarCode: agent.code,
      avatarUrl: agent.avatarUrl,
      avatarVersion: agent.avatarVersion ?? null,
      preview: conversacion?.lastMessage ? toPreview(conversacion.lastMessage.preview) : null,
      lastMessageAt: conversacion?.lastMessageAt ?? null,
      unread: unreadByAgent.get(agent.idAgent) ?? 0,
      sortOrder: agent.sortOrder,
      agentCode: agent.code,
      idAgent: agent.idAgent,
      busy: agent.busy ?? false,
    });
  }

  for (const conversacion of people) {
    const personas = (conversacion.participants ?? []).filter((p) => p.kind === 'user');
    const otra = personas.find((p) => String(p.id) !== miId) ?? personas[0] ?? null;
    items.push({
      key: conversationKey(conversacion.id),
      kind: 'people',
      name: otra?.name ?? 'Persona',
      avatarCode: String(otra?.id ?? conversacion.id),
      avatarUrl: otra?.avatarUrl ?? null,
      preview: conversacion.lastMessage ? toPreview(conversacion.lastMessage.preview) : null,
      lastMessageAt: conversacion.lastMessageAt,
      unread: conversacion.unreadCount,
      sortOrder: Number.MAX_SAFE_INTEGER,
      idConversation: conversacion.id,
    });
  }

  for (const conversacion of groups) {
    items.push({
      key: conversationKey(conversacion.id),
      kind: 'group',
      name: conversacion.title?.trim() || `Grupo con ${conversacion.agent.displayName}`,
      avatarCode: `grupo-${conversacion.id}`,
      avatarUrl: null,
      preview: conversacion.lastMessage ? toPreview(conversacion.lastMessage.preview) : null,
      lastMessageAt: conversacion.lastMessageAt,
      unread: conversacion.unreadCount,
      sortOrder: Number.MAX_SAFE_INTEGER,
      idConversation: conversacion.id,
    });
  }

  return items;
}

/** A dónde lleva cada chat cuando se abre como página. */
export function railItemHref(item: Pick<ChatRailItem, 'kind' | 'agentCode' | 'idConversation'>): string {
  if (item.kind === 'agent') return `/process/chat/${encodeURIComponent(item.agentCode ?? '')}`;
  if (item.kind === 'people') return `/process/chat/persona/${item.idConversation}`;
  return `/process/chat/grupo/${item.idConversation}`;
}

/**
 * Evento con el que la barra le pide a la página del chat (ChatWorkspace) que
 * abra un chat SIN navegar: esa página refleja la selección con
 * `history.replaceState` porque cambiar de ruta la rearma en el servidor y se
 * veía unos segundos la conversación anterior.
 */
export const CHAT_RAIL_OPEN_EVENT = 'synerlink:chat-rail-open';

export type ChatRailOpenDetail =
  | { tipo: 'agente'; code: string }
  | { tipo: 'grupo'; id: number }
  | { tipo: 'persona'; id: number };

export function railOpenDetail(item: ChatRailItem): ChatRailOpenDetail {
  if (item.kind === 'agent') return { tipo: 'agente', code: item.agentCode ?? '' };
  if (item.kind === 'people') return { tipo: 'persona', id: item.idConversation ?? 0 };
  return { tipo: 'grupo', id: item.idConversation ?? 0 };
}

/* ─────────────────────── Botón "Nuevo" de la barra ─────────────────────── */

/**
 * Pedido de Nicolás (2026-10-06): "quiero un botón en la barra lateral de chat
 * que me deje crear todo: chat 1 a 1, grupos, etc."
 *
 * La barra NO tiene cuadros propios: cada opción abre el cuadro que ya existe
 * en la página del chat (ChatWorkspace). Si la persona ya está en esa página,
 * la barra le manda este evento; si está en otra pantalla, navega a
 * `/process/chat?nuevo=<tipo>` y la página abre el cuadro al cargar.
 */
export const CHAT_RAIL_CREATE_EVENT = 'synerlink:chat-rail-crear';

/** Parámetro de la URL con el que se pide abrir un cuadro de creación. */
export const CHAT_CREATE_PARAM = 'nuevo';

/** Qué se puede crear desde el botón: hilo con una persona, grupo o mensaje masivo. */
export type ChatCreateKind = 'persona' | 'grupo' | 'masivo';

export interface ChatCreateDetail {
  tipo: ChatCreateKind;
}

const CREATE_KINDS: readonly ChatCreateKind[] = ['persona', 'grupo', 'masivo'];

export function isChatCreateKind(value: unknown): value is ChatCreateKind {
  return typeof value === 'string' && (CREATE_KINDS as readonly string[]).includes(value);
}

/**
 * Las opciones del menú "Nuevo" que puede ver esta persona, en orden. Son las
 * MISMAS condiciones con que la página del chat pinta cada acceso:
 *   - persona: el piloto de mensajes entre personas (`canMessagePeople`).
 *   - grupo: `canCreateGroups` (todo usuario con chat y algún agente, #517).
 *   - masivo: solo administradores (`canBroadcast`) y con más de un asistente,
 *     igual que el botón "Enviar a todos".
 * La reja de verdad sigue en cada endpoint: esto solo decide qué se pinta.
 */
export function chatCreateOptions(permisos: {
  canMessagePeople: boolean;
  canCreateGroups: boolean;
  canBroadcast: boolean;
  totalAgents: number;
}): ChatCreateKind[] {
  const opciones: ChatCreateKind[] = [];
  if (permisos.canMessagePeople) opciones.push('persona');
  if (permisos.canCreateGroups) opciones.push('grupo');
  if (permisos.canBroadcast && permisos.totalAgents > 1) opciones.push('masivo');
  return opciones;
}

/** A dónde navegar para crear desde una pantalla que no es la del chat. */
export function chatCreateHref(tipo: ChatCreateKind): string {
  return `/process/chat?${CHAT_CREATE_PARAM}=${tipo}`;
}
