import 'server-only';
import { meetingsCredentialsFor, type MeetingsCredentials } from './config';
import {
  MeetingsGraphError,
  attendanceReports,
  calendarView,
  getEvent,
  listTranscripts,
  onlineMeetingId,
  transcriptMetadata,
  userObjectId,
} from './graph';
import {
  actualsFromReports,
  belongsToOccurrence,
  isRealMeeting,
  normalizeMeeting,
  parseTranscript,
  summarize,
  summarizeActuals,
  weeklyTrend,
  type ActualsSummary,
  type GraphMeetingEvent,
  type Meeting,
  type MeetingActuals,
  type PeriodSummary,
  type TranscriptLine,
  type WeekBucket,
} from './metrics';

/**
 * Server side of "Mis reuniones": everything is read from the calendar and the
 * Teams meetings of the SESSION user. Results are cached per person for a few
 * minutes so the header icon and the page do not hammer Microsoft Graph.
 */

const DAY_MS = 86_400_000;
const LIST_TTL_MS = 5 * 60 * 1000;
const ACTUALS_TTL_MS = 15 * 60 * 1000;
/** Max meetings whose attendance/transcripts are looked up in one analysis. */
const MAX_ANALYZED = 60;
const CONCURRENCY = 4;

function credentials(email: string): MeetingsCredentials {
  const cred = meetingsCredentialsFor(email);
  if (!cred) {
    throw new MeetingsGraphError('Su cuenta no pertenece a un inquilino de Microsoft 365 habilitado.', 409);
  }
  return cred;
}

interface CacheEntry<T> {
  value: T;
  expires: number;
}
const cache = new Map<string, CacheEntry<unknown>>();

async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await load();
  if (cache.size > 500) cache.clear();
  cache.set(key, { value, expires: Date.now() + ttl });
  return value;
}

interface Window {
  meetings: Meeting[];
  /** Join URLs by event id. SERVER ONLY. */
  joinUrls: Map<string, string>;
}

/** Real meetings that already started in [from, to), newest first. */
async function loadWindow(email: string, fromMs: number, toMs: number): Promise<Window> {
  const events: GraphMeetingEvent[] = await calendarView(
    credentials(email),
    email,
    new Date(fromMs).toISOString(),
    new Date(toMs).toISOString()
  );
  const joinUrls = new Map<string, string>();
  const meetings: Meeting[] = [];
  const now = Date.now();
  for (const e of events) {
    if (!isRealMeeting(e)) continue;
    const m = normalizeMeeting(e, email);
    if (Date.parse(m.start) > now) continue;
    meetings.push(m);
    if (e.onlineMeeting?.joinUrl) joinUrls.set(m.id, e.onlineMeeting.joinUrl);
  }
  meetings.sort((a, b) => b.start.localeCompare(a.start));
  return { meetings, joinUrls };
}

export interface MeetingsOverview {
  days: number;
  from: string;
  to: string;
  meetings: Meeting[];
  summary: PeriodSummary;
  previous: PeriodSummary;
  trend: WeekBucket[];
}

/** History of the last `days` days plus the previous period of the same length (for the comparison). */
export async function meetingsOverview(email: string, days: number): Promise<MeetingsOverview> {
  const key = `overview:${email.toLowerCase()}:${days}`;
  return cached(key, LIST_TTL_MS, async () => {
    const to = Date.now();
    const from = to - days * DAY_MS;
    const window = await loadWindow(email, from - days * DAY_MS, to);
    const fromIso = new Date(from).toISOString();
    const current = window.meetings.filter((m) => m.start >= fromIso);
    const previous = window.meetings.filter((m) => m.start < fromIso);
    rememberJoinUrls(email, window.joinUrls);
    return {
      days,
      from: fromIso,
      to: new Date(to).toISOString(),
      meetings: current,
      summary: summarize(current, days),
      previous: summarize(previous, days),
      trend: weeklyTrend(current, fromIso, new Date(to).toISOString()),
    };
  });
}

/** Last meetings for the header icon (7 days). */
export async function recentMeetings(email: string, limit = 8): Promise<Meeting[]> {
  const overview = await meetingsOverview(email, 7);
  return overview.meetings.slice(0, limit);
}

/** Join URLs by event id, per person (merged across ranges). SERVER ONLY. */
const joinUrlCache = new Map<string, { map: Map<string, string>; expires: number }>();

function rememberJoinUrls(email: string, urls: Map<string, string>): void {
  const key = email.toLowerCase();
  const prev = joinUrlCache.get(key);
  const map = prev && prev.expires > Date.now() ? prev.map : new Map<string, string>();
  for (const [id, url] of urls) map.set(id, url);
  if (joinUrlCache.size > 500) joinUrlCache.clear();
  joinUrlCache.set(key, { map, expires: Date.now() + ACTUALS_TTL_MS });
}

async function joinUrlFor(email: string, cred: MeetingsCredentials, eventId: string): Promise<{
  joinUrl: string | null;
  meeting: Meeting;
}> {
  // Always re-read the event from the SESSION mailbox: an id from another mailbox gives 404.
  const event = await getEvent(cred, email, eventId);
  return { joinUrl: event.onlineMeeting?.joinUrl ?? null, meeting: normalizeMeeting(event, email) };
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export interface MeetingAnalysisRow extends MeetingActuals {
  id: string;
  hasTranscript: boolean;
  /** false when Teams did not let us look the meeting up. */
  available: boolean;
}

export interface MeetingsAnalysis {
  days: number;
  rows: MeetingAnalysisRow[];
  summary: ActualsSummary;
  truncated: boolean;
}

/** Real start/duration (attendance reports) and transcript availability of the online meetings of the period. */
export async function meetingsAnalysis(email: string, days: number): Promise<MeetingsAnalysis> {
  const key = `analysis:${email.toLowerCase()}:${days}`;
  return cached(key, ACTUALS_TTL_MS, async () => {
    const overview = await meetingsOverview(email, days);
    const urls = joinUrlCache.get(email.toLowerCase())?.map ?? new Map<string, string>();
    const online = overview.meetings.filter((m) => m.online && urls.has(m.id));
    const target = online.slice(0, MAX_ANALYZED);
    const cred = credentials(email);
    const userId = await userObjectId(cred, email);
    const rows = await mapLimited(target, CONCURRENCY, async (m): Promise<MeetingAnalysisRow> => {
      const empty = actualsFromReports([], m);
      try {
        const meetingId = await onlineMeetingId(cred, userId, urls.get(m.id) as string);
        if (!meetingId) return { id: m.id, ...empty, hasTranscript: false, available: false };
        const [reports, transcripts] = await Promise.all([
          attendanceReports(cred, userId, meetingId),
          listTranscripts(cred, userId, meetingId),
        ]);
        return {
          id: m.id,
          ...actualsFromReports(reports, m),
          hasTranscript: transcripts.some((t) => belongsToOccurrence(t.createdDateTime ?? t.endDateTime, m)),
          available: true,
        };
      } catch (err) {
        console.error('[meetings] analysis:', err instanceof Error ? err.message : err);
        return { id: m.id, ...empty, hasTranscript: false, available: false };
      }
    });
    return {
      days,
      rows,
      summary: summarizeActuals(rows.filter((r) => r.available)),
      truncated: online.length > target.length,
    };
  });
}

export interface MeetingTranscript {
  meeting: Meeting;
  available: boolean;
  reason?: string;
  createdAt?: string | null;
  lines: TranscriptLine[];
}

/** Transcript of one meeting of the SESSION user (occurrence-aware for recurring meetings). */
export async function meetingTranscript(email: string, eventId: string): Promise<MeetingTranscript> {
  const cred = credentials(email);
  const { joinUrl, meeting } = await joinUrlFor(email, cred, eventId);
  if (!joinUrl) return { meeting, available: false, reason: 'La reunión no es de Teams.', lines: [] };
  const userId = await userObjectId(cred, email);
  const meetingId = await onlineMeetingId(cred, userId, joinUrl);
  if (!meetingId) {
    return { meeting, available: false, reason: 'Teams no permite consultar esta reunión desde su cuenta.', lines: [] };
  }
  const transcripts = (await listTranscripts(cred, userId, meetingId)).filter((t) =>
    belongsToOccurrence(t.createdDateTime ?? t.endDateTime, meeting)
  );
  const latest = transcripts.sort((a, b) => String(b.createdDateTime).localeCompare(String(a.createdDateTime)))[0];
  if (!latest) return { meeting, available: false, reason: 'La reunión no se transcribió.', lines: [] };
  const vtt = await transcriptMetadata(cred, userId, meetingId, latest.id);
  return { meeting, available: true, createdAt: latest.createdDateTime, lines: parseTranscript(vtt) };
}
