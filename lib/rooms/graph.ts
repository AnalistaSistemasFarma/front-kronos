import 'server-only';
import type { GraphCredentials } from './config';
import { GRAPH_TIME_ZONE, dayRange, graphParts } from './dates';

/**
 * Minimal Microsoft Graph client for the Rooms module (client credentials,
 * SERVER ONLY). Credentials are never logged nor sent to the browser. The
 * mailboxes queried are always built by the server: a room's (from
 * SALAS_ROOMS) or the SynerLink session user's (organizer).
 */
const GRAPH = 'https://graph.microsoft.com/v1.0';
const TIMEOUT_MS = 20_000;

export class GraphError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

interface CachedAccess {
  value: string;
  expiresAt: number;
}
let cachedAccess: CachedAccess | null = null;

async function getAccess(cred: GraphCredentials): Promise<string> {
  if (cachedAccess && cachedAccess.expiresAt > Date.now() + 60_000) return cachedAccess.value;
  const body = new URLSearchParams({
    client_id: cred.clientId,
    client_secret: cred.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(cred.tenantId)}/oauth2/v2.0/token`,
    { method: 'POST', body, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' }
  );
  if (!res.ok) throw new GraphError('No se pudo autenticar con Microsoft 365.', 502);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new GraphError('No se pudo autenticar con Microsoft 365.', 502);
  cachedAccess = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3000) * 1000 };
  return cachedAccess.value;
}

function mailboxPath(mailbox: string): string {
  return `${GRAPH}/users/${encodeURIComponent(mailbox.trim().toLowerCase())}`;
}

async function call(
  cred: GraphCredentials,
  url: string,
  init: { method?: string; body?: unknown } = {}
): Promise<Response> {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.host !== 'graph.microsoft.com') {
    throw new GraphError('URL de Graph no permitida.', 500);
  }
  const access = await getAccess(cred);
  return fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: 'Bearer ' + access,
      'Content-Type': 'application/json',
      Prefer: `outlook.timezone="${GRAPH_TIME_ZONE}"`,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
}

async function errorFrom(res: Response, context: string): Promise<GraphError> {
  let detail = '';
  try {
    const j = (await res.json()) as { error?: { code?: string } };
    detail = j.error?.code ? ` (${j.error.code})` : '';
  } catch {
    /* no body */
  }
  return new GraphError(`${context}: Microsoft 365 respondió ${res.status}${detail}.`, res.status === 404 ? 404 : 502);
}

/** Calendar event as returned by Graph (fields we use). */
export interface GraphEvent {
  id: string;
  iCalUId?: string;
  subject?: string | null;
  sensitivity?: string;
  isCancelled?: boolean;
  showAs?: string;
  type?: string;
  seriesMasterId?: string | null;
  start: { dateTime: string };
  end: { dateTime: string };
  organizer?: { emailAddress?: { name?: string; address?: string } };
  attendees?: Array<{ type?: string; emailAddress?: { address?: string }; status?: { response?: string } }>;
}

const FIELDS =
  'id,iCalUId,subject,sensitivity,isCancelled,showAs,type,seriesMasterId,start,end,organizer,attendees';

/** A mailbox's calendarView for one or more whole days (-05:00 offset), with paging. */
export async function calendarView(
  cred: GraphCredentials,
  mailbox: string,
  from: string,
  to: string = from
): Promise<GraphEvent[]> {
  const { start, end } = dayRange(from, to);
  const params = new URLSearchParams({
    startDateTime: start,
    endDateTime: end,
    $select: FIELDS,
    $orderby: 'start/dateTime',
    $top: '200',
  });
  let url: string | null = `${mailboxPath(mailbox)}/calendarView?${params.toString()}`;
  const events: GraphEvent[] = [];
  for (let page = 0; url && page < 30; page++) {
    const res = await call(cred, url);
    if (!res.ok) throw await errorFrom(res, 'No se pudo leer el calendario');
    const json = (await res.json()) as { value?: GraphEvent[]; '@odata.nextLink'?: string };
    events.push(...(json.value ?? []));
    url = json['@odata.nextLink'] ?? null;
  }
  return events;
}

export async function createEvent(
  cred: GraphCredentials,
  organizer: string,
  body: Record<string, unknown>
): Promise<GraphEvent> {
  const res = await call(cred, `${mailboxPath(organizer)}/events`, { method: 'POST', body });
  if (!res.ok) throw await errorFrom(res, 'No se pudo crear la reserva');
  return (await res.json()) as GraphEvent;
}

export async function getEvent(cred: GraphCredentials, mailbox: string, id: string): Promise<GraphEvent> {
  const res = await call(cred, `${mailboxPath(mailbox)}/events/${encodeURIComponent(id)}?$select=${FIELDS}`);
  if (!res.ok) throw await errorFrom(res, 'No se pudo leer la reserva');
  return (await res.json()) as GraphEvent;
}

export async function deleteEvent(cred: GraphCredentials, mailbox: string, id: string): Promise<void> {
  const res = await call(cred, `${mailboxPath(mailbox)}/events/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw await errorFrom(res, 'No se pudo cancelar la reserva');
}

/** Is the event private or confidential? Shown as «Ocupado». */
export function isPrivate(e: GraphEvent): boolean {
  const s = (e.sensitivity ?? 'normal').toLowerCase();
  return s === 'private' || s === 'confidential';
}

/** Does it count as occupancy? (not cancelled and not marked as free). */
export function isBusy(e: GraphEvent): boolean {
  return !e.isCancelled && (e.showAs ?? 'busy').toLowerCase() !== 'free';
}

export function localTimes(e: GraphEvent) {
  const s = graphParts(e.start.dateTime);
  const f = graphParts(e.end.dateTime);
  return { date: s.date, startTime: s.time, endDate: f.date, endTime: f.time };
}
