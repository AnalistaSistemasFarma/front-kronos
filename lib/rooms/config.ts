/**
 * Rooms module configuration. SERVER ONLY: reads environment variables.
 *
 *   SALAS_ROOMS          mailbox|Name[|windowDays];mailbox2|Name2…  (required)
 *   SALAS_GRAPH_*        Graph app credentials (never sent to the client)
 *   SALAS_SOLO_LECTURA   "1" blocks creating and cancelling in Graph
 *   SALAS_VENTANA_DIAS   optional, mailbox|days;… (each room's BookingWindowInDays)
 *
 * Rooms are never hardcoded: they come from SALAS_ROOMS. The browser only
 * receives a room id (the mailbox local part), never the full mailbox.
 */

/** Default booking window (administrative and guest rooms). */
export const DEFAULT_WINDOW_DAYS = 15;
/**
 * Known windows as of 2026-11-17 (Exchange BookingWindowInDays). Used only when
 * neither SALAS_ROOMS nor SALAS_VENTANA_DIAS provide the room's value.
 */
const KNOWN_WINDOWS: Record<string, number> = { quietroom: 10 };

export interface Room {
  /** Public id (mailbox local part, lowercase). */
  id: string;
  /** Room mailbox. SERVER ONLY. */
  mailbox: string;
  name: string;
  /** How many days ahead the room accepts bookings. */
  windowDays: number;
}

/** Browser-safe view. */
export interface PublicRoom {
  id: string;
  name: string;
  windowDays: number;
}

const MAILBOX_RE = /^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,}$/;

function validDays(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value.trim());
  return Number.isInteger(n) && n >= 1 && n <= 1080 ? n : null;
}

function windowMap(raw: string | undefined): Map<string, number> {
  const map = new Map<string, number>();
  for (const part of (raw ?? '').split(';')) {
    const [mailbox, days] = part.split('|').map((s) => s.trim());
    const n = validDays(days);
    if (mailbox && n) map.set(mailbox.toLowerCase(), n);
  }
  return map;
}

/** Parses SALAS_ROOMS. Ignores malformed or duplicated entries. */
export function parseRooms(raw: string | undefined, windowsRaw?: string): Room[] {
  const windows = windowMap(windowsRaw);
  const rooms: Room[] = [];
  const seen = new Set<string>();
  for (const part of (raw ?? '').split(';')) {
    const [mailboxRaw, nameRaw, daysRaw] = part.split('|');
    const mailbox = (mailboxRaw ?? '').trim().toLowerCase();
    if (!MAILBOX_RE.test(mailbox)) continue;
    const id = mailbox.split('@')[0];
    if (seen.has(id)) continue;
    seen.add(id);
    const name = (nameRaw ?? '').trim() || id;
    const windowDays =
      validDays(daysRaw) ?? windows.get(mailbox) ?? KNOWN_WINDOWS[id] ?? DEFAULT_WINDOW_DAYS;
    rooms.push({ id, mailbox, name, windowDays });
  }
  return rooms;
}

export function toPublicRooms(rooms: Room[]): PublicRoom[] {
  return rooms.map(({ id, name, windowDays }) => ({ id, name, windowDays }));
}

/** Is the environment in read-only mode? */
export function isReadOnly(value: string | undefined = process.env.SALAS_SOLO_LECTURA): boolean {
  const v = (value ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'si' || v === 'sí';
}

export const READ_ONLY_MESSAGE =
  'Modo de solo lectura: en este ambiente no se crean ni cancelan reservas en las salas reales.';

export interface GraphCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

/** Graph credentials, or null if missing. SERVER ONLY; never logged or returned. */
export function graphCredentials(env: NodeJS.ProcessEnv = process.env): GraphCredentials | null {
  const tenantId = env.SALAS_GRAPH_TENANT_ID?.trim();
  const clientId = env.SALAS_GRAPH_CLIENT_ID?.trim();
  const clientSecret = env.SALAS_GRAPH_CLIENT_SECRET?.trim();
  if (!tenantId || !clientId || !clientSecret) return null;
  return { tenantId, clientId, clientSecret };
}

/** Rooms configured in the environment. */
export function environmentRooms(env: NodeJS.ProcessEnv = process.env): Room[] {
  return parseRooms(env.SALAS_ROOMS, env.SALAS_VENTANA_DIAS);
}
