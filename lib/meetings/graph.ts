import 'server-only';
import type { MeetingsCredentials } from './config';
import type { AttendanceReport, GraphMeetingEvent } from './metrics';

/**
 * Minimal Microsoft Graph client of the "Mis reuniones" module (client
 * credentials, SERVER ONLY, read only). Credentials are never logged nor sent
 * to the browser. The mailbox is always the one of the SynerLink session.
 */
const GRAPH = 'https://graph.microsoft.com/v1.0';
const TIMEOUT_MS = 20_000;
/** Upper bound of a transcript download (a 2 h meeting is ~1 MB). */
const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;

export class MeetingsGraphError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'MeetingsGraphError';
  }
}

const tokens = new Map<string, { value: string; expires: number }>();

async function getToken(cred: MeetingsCredentials): Promise<string> {
  const key = `${cred.tenantId}:${cred.clientId}`;
  const cached = tokens.get(key);
  if (cached && cached.expires > Date.now() + 60_000) return cached.value;
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
  if (!res.ok) throw new MeetingsGraphError('No se pudo autenticar con Microsoft 365.', 502);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new MeetingsGraphError('No se pudo autenticar con Microsoft 365.', 502);
  tokens.set(key, { value: json.access_token, expires: Date.now() + (json.expires_in ?? 3000) * 1000 });
  return json.access_token;
}

async function call(cred: MeetingsCredentials, url: string): Promise<Response> {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.host !== 'graph.microsoft.com') {
    throw new MeetingsGraphError('URL de Graph no permitida.', 500);
  }
  const token = await getToken(cred);
  return fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
}

async function errorFrom(res: Response, context: string): Promise<MeetingsGraphError> {
  let code = '';
  try {
    const j = (await res.json()) as { error?: { code?: string } };
    code = j.error?.code ? ` (${j.error.code})` : '';
  } catch {
    /* no body */
  }
  const status = res.status === 404 ? 404 : res.status === 403 ? 403 : 502;
  return new MeetingsGraphError(`${context}: Microsoft 365 respondió ${res.status}${code}.`, status);
}

function mailboxPath(mailbox: string): string {
  return `${GRAPH}/users/${encodeURIComponent(mailbox.trim().toLowerCase())}`;
}

const EVENT_FIELDS =
  'id,iCalUId,subject,start,end,isAllDay,isCancelled,isOnlineMeeting,isOrganizer,sensitivity,showAs,type,seriesMasterId,webLink,onlineMeeting,organizer,attendees,responseStatus';

/** calendarView of the mailbox between two instants (UTC), with paging. */
export async function calendarView(
  cred: MeetingsCredentials,
  mailbox: string,
  fromIso: string,
  toIso: string
): Promise<GraphMeetingEvent[]> {
  const params = new URLSearchParams({
    startDateTime: fromIso,
    endDateTime: toIso,
    $select: EVENT_FIELDS,
    $orderby: 'start/dateTime desc',
    $top: '200',
  });
  let url: string | null = `${mailboxPath(mailbox)}/calendarView?${params.toString()}`;
  const events: GraphMeetingEvent[] = [];
  for (let page = 0; url && page < 20; page++) {
    const res = await call(cred, url);
    if (!res.ok) throw await errorFrom(res, 'No se pudo leer el calendario');
    const json = (await res.json()) as { value?: GraphMeetingEvent[]; '@odata.nextLink'?: string };
    events.push(...(json.value ?? []));
    url = json['@odata.nextLink'] ?? null;
  }
  return events;
}

export async function getEvent(cred: MeetingsCredentials, mailbox: string, id: string): Promise<GraphMeetingEvent> {
  const res = await call(cred, `${mailboxPath(mailbox)}/events/${encodeURIComponent(id)}?$select=${EVENT_FIELDS}`);
  if (!res.ok) throw await errorFrom(res, 'No se pudo leer la reunión');
  return (await res.json()) as GraphMeetingEvent;
}

const userIds = new Map<string, string>();

/** Entra object id of the mailbox (the onlineMeetings API only accepts the GUID). */
export async function userObjectId(cred: MeetingsCredentials, mailbox: string): Promise<string> {
  const key = mailbox.trim().toLowerCase();
  const cached = userIds.get(key);
  if (cached) return cached;
  const res = await call(cred, `${mailboxPath(key)}?$select=id`);
  if (!res.ok) throw await errorFrom(res, 'No se pudo identificar el usuario');
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new MeetingsGraphError('No se pudo identificar el usuario.', 502);
  userIds.set(key, json.id);
  return json.id;
}

const meetingIds = new Map<string, { id: string | null; expires: number }>();

/**
 * Online meeting id for a join URL, seen from the session user. Returns null
 * when Teams does not let the user look it up (403 "User does not have access
 * to lookup meeting") or it does not exist.
 */
export async function onlineMeetingId(
  cred: MeetingsCredentials,
  userId: string,
  joinUrl: string
): Promise<string | null> {
  const key = `${userId}|${joinUrl}`;
  const cached = meetingIds.get(key);
  if (cached && cached.expires > Date.now()) return cached.id;
  const params = new URLSearchParams({ $filter: `JoinWebUrl eq '${joinUrl.replace(/'/g, "''")}'`, $select: 'id' });
  const res = await call(cred, `${GRAPH}/users/${encodeURIComponent(userId)}/onlineMeetings?${params.toString()}`);
  let id: string | null = null;
  if (res.ok) {
    const json = (await res.json()) as { value?: Array<{ id?: string }> };
    id = json.value?.[0]?.id ?? null;
  } else if (res.status !== 403 && res.status !== 404) {
    throw await errorFrom(res, 'No se pudo ubicar la reunión de Teams');
  }
  if (meetingIds.size > 5000) meetingIds.clear();
  meetingIds.set(key, { id, expires: Date.now() + 6 * 60 * 60 * 1000 });
  return id;
}

export interface TranscriptRef {
  id: string;
  createdDateTime: string | null;
  endDateTime: string | null;
}

function meetingPath(userId: string, meetingId: string): string {
  return `${GRAPH}/users/${encodeURIComponent(userId)}/onlineMeetings/${encodeURIComponent(meetingId)}`;
}

export async function listTranscripts(
  cred: MeetingsCredentials,
  userId: string,
  meetingId: string
): Promise<TranscriptRef[]> {
  const res = await call(cred, `${meetingPath(userId, meetingId)}/transcripts`);
  if (res.status === 403 || res.status === 404) return [];
  if (!res.ok) throw await errorFrom(res, 'No se pudieron leer las transcripciones');
  const json = (await res.json()) as { value?: Array<Record<string, unknown>> };
  return (json.value ?? []).map((t) => ({
    id: String(t.id),
    createdDateTime: (t.createdDateTime as string | undefined) ?? null,
    endDateTime: (t.endDateTime as string | undefined) ?? null,
  }));
}

/** WEBVTT with speaker names (metadataContent). */
export async function transcriptMetadata(
  cred: MeetingsCredentials,
  userId: string,
  meetingId: string,
  transcriptId: string
): Promise<string> {
  const res = await call(
    cred,
    `${meetingPath(userId, meetingId)}/transcripts/${encodeURIComponent(transcriptId)}/metadataContent`
  );
  if (!res.ok) throw await errorFrom(res, 'No se pudo leer la transcripción');
  const length = Number(res.headers.get('content-length') ?? '0');
  if (length > MAX_TRANSCRIPT_BYTES) throw new MeetingsGraphError('La transcripción es demasiado grande.', 413);
  const text = await res.text();
  return text.length > MAX_TRANSCRIPT_BYTES ? text.slice(0, MAX_TRANSCRIPT_BYTES) : text;
}

export async function attendanceReports(
  cred: MeetingsCredentials,
  userId: string,
  meetingId: string
): Promise<AttendanceReport[]> {
  const res = await call(
    cred,
    `${meetingPath(userId, meetingId)}/attendanceReports`
  );
  if (res.status === 403 || res.status === 404) return [];
  if (!res.ok) throw await errorFrom(res, 'No se pudo leer la asistencia');
  const json = (await res.json()) as { value?: AttendanceReport[] };
  return json.value ?? [];
}
