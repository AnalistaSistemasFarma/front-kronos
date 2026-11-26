/**
 * Pure helpers of the "Mis reuniones" module: normalize Graph calendar events,
 * compute the summary (current vs previous period, weekly trend), match
 * attendance reports / transcripts of a recurring meeting to one occurrence and
 * parse the Teams transcript (metadataContent). No I/O: tested in
 * lib/meetings/__tests__.
 *
 * Dates: Graph is called WITHOUT `Prefer: outlook.timezone`, so event
 * `dateTime` values come in UTC without offset; they are stored as ISO UTC.
 * Weeks are grouped in Bogotá time (fixed -05:00, no DST).
 */

const BOGOTA_OFFSET_MS = -5 * 60 * 60 * 1000;

/** Calendar event as returned by Graph (fields we use). */
export interface GraphMeetingEvent {
  id: string;
  /** Same in every attendee's calendar, different per occurrence (2026-11-24: project meetings). */
  iCalUId?: string | null;
  subject?: string | null;
  start: { dateTime: string; timeZone?: string };
  end: { dateTime: string; timeZone?: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  isOnlineMeeting?: boolean;
  isOrganizer?: boolean;
  sensitivity?: string;
  showAs?: string;
  type?: string;
  seriesMasterId?: string | null;
  webLink?: string | null;
  onlineMeeting?: { joinUrl?: string | null } | null;
  organizer?: { emailAddress?: { name?: string; address?: string } };
  attendees?: Array<{ type?: string; emailAddress?: { address?: string } }>;
  responseStatus?: { response?: string };
}

/** Meeting as sent to the browser (no join URL: the server resolves it again by id). */
export interface Meeting {
  id: string;
  subject: string;
  start: string;
  end: string;
  scheduledMinutes: number;
  organizerName: string;
  isOrganizer: boolean;
  attendees: number;
  online: boolean;
  recurring: boolean;
  private: boolean;
  webLink: string | null;
  /** iCalUId of the occurrence (shared by every attendee); null when Graph did not send it. */
  icalUid: string | null;
}

/** Graph `dateTime` (UTC, without offset) → epoch ms. */
export function graphUtcMs(dateTime: string): number {
  const s = dateTime.trim();
  return Date.parse(/[zZ]|[+-]\d{2}:\d{2}$/.test(s) ? s : `${s}Z`);
}

/**
 * Blocks longer than this are not meetings but "open room" events (e.g. a
 * Teams call scheduled all day long every day); counting them would distort
 * every indicator.
 */
export const MAX_MEETING_MINUTES = 300;

/** Should this calendar event count as a meeting "we had"? */
export function isRealMeeting(e: GraphMeetingEvent): boolean {
  if (e.isCancelled || e.isAllDay) return false;
  if (graphUtcMs(e.end.dateTime) - graphUtcMs(e.start.dateTime) > MAX_MEETING_MINUTES * 60_000) return false;
  if ((e.showAs ?? '').toLowerCase() === 'free') return false;
  const response = (e.responseStatus?.response ?? '').toLowerCase();
  if (response === 'declined') return false;
  const others = (e.attendees ?? []).filter((a) => (a.type ?? '').toLowerCase() !== 'resource').length;
  return e.isOnlineMeeting === true || others > 0;
}

export function normalizeMeeting(e: GraphMeetingEvent, sessionEmail: string): Meeting {
  const startMs = graphUtcMs(e.start.dateTime);
  const endMs = graphUtcMs(e.end.dateTime);
  const organizerMail = (e.organizer?.emailAddress?.address ?? '').toLowerCase();
  const isPrivate = ['private', 'confidential'].includes((e.sensitivity ?? 'normal').toLowerCase());
  const isOrganizer = e.isOrganizer === true || (!!organizerMail && organizerMail === sessionEmail.toLowerCase());
  return {
    id: e.id,
    subject: (e.subject ?? '').trim() || '(Sin asunto)',
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    scheduledMinutes: Math.max(0, Math.round((endMs - startMs) / 60_000)),
    organizerName: e.organizer?.emailAddress?.name?.trim() || organizerMail || 'Desconocido',
    isOrganizer,
    attendees: (e.attendees ?? []).filter((a) => (a.type ?? '').toLowerCase() !== 'resource').length,
    online: e.isOnlineMeeting === true && !!e.onlineMeeting?.joinUrl,
    recurring: e.type === 'occurrence' || e.type === 'exception' || !!e.seriesMasterId,
    private: isPrivate,
    webLink: e.webLink ?? null,
    icalUid: e.iCalUId?.trim() || null,
  };
}

/** Monday (YYYY-MM-DD, Bogotá) of the week that contains the instant. */
export function weekKey(isoUtc: string): string {
  const local = new Date(Date.parse(isoUtc) + BOGOTA_OFFSET_MS);
  const dow = (local.getUTCDay() + 6) % 7; // 0 = Monday
  local.setUTCDate(local.getUTCDate() - dow);
  return local.toISOString().slice(0, 10);
}

export interface PeriodSummary {
  meetings: number;
  minutes: number;
  averageMinutes: number;
  organizedByMe: number;
  /** Meetings longer than 60 minutes. */
  longMeetings: number;
  /** Average of meetings per active week day (Mon-Fri) in the period. */
  meetingsPerWorkday: number;
}

export function summarize(meetings: Meeting[], days: number): PeriodSummary {
  const minutes = meetings.reduce((acc, m) => acc + m.scheduledMinutes, 0);
  const workdays = Math.max(1, Math.round((days * 5) / 7));
  return {
    meetings: meetings.length,
    minutes,
    averageMinutes: meetings.length ? Math.round(minutes / meetings.length) : 0,
    organizedByMe: meetings.filter((m) => m.isOrganizer).length,
    longMeetings: meetings.filter((m) => m.scheduledMinutes > 60).length,
    meetingsPerWorkday: Math.round((meetings.length / workdays) * 10) / 10,
  };
}

export interface WeekBucket {
  week: string;
  meetings: number;
  minutes: number;
}

/** Weekly trend, oldest first, including weeks with no meetings. */
export function weeklyTrend(meetings: Meeting[], fromIso: string, toIso: string): WeekBucket[] {
  const buckets = new Map<string, WeekBucket>();
  let cursor = weekKey(fromIso);
  const last = weekKey(toIso);
  for (let guard = 0; cursor <= last && guard < 60; guard++) {
    buckets.set(cursor, { week: cursor, meetings: 0, minutes: 0 });
    const d = new Date(`${cursor}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7);
    cursor = d.toISOString().slice(0, 10);
  }
  for (const m of meetings) {
    const b = buckets.get(weekKey(m.start));
    if (!b) continue;
    b.meetings += 1;
    b.minutes += m.scheduledMinutes;
  }
  return [...buckets.values()];
}

/** Window used to tell one occurrence of a recurring meeting from the others. */
const MATCH_MARGIN_MS = 3 * 60 * 60 * 1000;

/** Is the instant inside the scheduled slot of the meeting (± 3 h)? */
export function belongsToOccurrence(instant: string | null | undefined, m: Pick<Meeting, 'start' | 'end'>): boolean {
  if (!instant) return false;
  const t = Date.parse(instant);
  if (Number.isNaN(t)) return false;
  return t >= Date.parse(m.start) - MATCH_MARGIN_MS && t <= Date.parse(m.end) + MATCH_MARGIN_MS;
}

export interface AttendanceReport {
  totalParticipantCount?: number;
  meetingStartDateTime?: string | null;
  meetingEndDateTime?: string | null;
}

export interface MeetingActuals {
  actualStart: string | null;
  actualEnd: string | null;
  actualMinutes: number | null;
  /** Minutes between the scheduled start and the moment the call actually started (negative = early). */
  startDelayMinutes: number | null;
  /** Actual minus scheduled duration (positive = overran). */
  overrunMinutes: number | null;
  participants: number | null;
}

/** Real start/end of one occurrence from its attendance reports. */
export function actualsFromReports(reports: AttendanceReport[], m: Pick<Meeting, 'start' | 'end'>): MeetingActuals {
  const mine = reports.filter((r) => belongsToOccurrence(r.meetingStartDateTime, m));
  const empty: MeetingActuals = {
    actualStart: null,
    actualEnd: null,
    actualMinutes: null,
    startDelayMinutes: null,
    overrunMinutes: null,
    participants: null,
  };
  if (mine.length === 0) return empty;
  const starts = mine.map((r) => Date.parse(r.meetingStartDateTime ?? '')).filter((n) => !Number.isNaN(n));
  const ends = mine.map((r) => Date.parse(r.meetingEndDateTime ?? '')).filter((n) => !Number.isNaN(n));
  if (starts.length === 0 || ends.length === 0) return empty;
  const start = Math.min(...starts);
  const end = Math.max(...ends);
  const actualMinutes = Math.max(0, Math.round((end - start) / 60_000));
  const scheduled = Math.round((Date.parse(m.end) - Date.parse(m.start)) / 60_000);
  return {
    actualStart: new Date(start).toISOString(),
    actualEnd: new Date(end).toISOString(),
    actualMinutes,
    startDelayMinutes: Math.round((start - Date.parse(m.start)) / 60_000),
    overrunMinutes: actualMinutes - scheduled,
    participants: Math.max(...mine.map((r) => r.totalParticipantCount ?? 0)),
  };
}

export interface ActualsSummary {
  analyzed: number;
  withData: number;
  onTimePct: number | null;
  averageDelayMinutes: number | null;
  overranPct: number | null;
  averageActualMinutes: number | null;
  withTranscript: number;
}

/** A call that starts within 5 minutes of the scheduled time counts as on time. */
export const ON_TIME_TOLERANCE_MIN = 5;
/** A call that lasts 5+ minutes more than scheduled counts as overran. */
export const OVERRUN_TOLERANCE_MIN = 5;

export function summarizeActuals(rows: Array<MeetingActuals & { hasTranscript: boolean }>): ActualsSummary {
  const withData = rows.filter((r) => r.actualMinutes !== null && r.startDelayMinutes !== null);
  const pct = (n: number) => (withData.length ? Math.round((n / withData.length) * 100) : null);
  const avg = (vals: number[]) => (vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null);
  return {
    analyzed: rows.length,
    withData: withData.length,
    onTimePct: pct(withData.filter((r) => (r.startDelayMinutes ?? 0) <= ON_TIME_TOLERANCE_MIN).length),
    averageDelayMinutes: avg(withData.map((r) => Math.max(0, r.startDelayMinutes ?? 0))),
    overranPct: pct(withData.filter((r) => (r.overrunMinutes ?? 0) >= OVERRUN_TOLERANCE_MIN).length),
    averageActualMinutes: avg(withData.map((r) => r.actualMinutes ?? 0)),
    withTranscript: rows.filter((r) => r.hasTranscript).length,
  };
}

export interface TranscriptLine {
  /** Offset from the start of the recording, "HH:MM:SS". */
  at: string;
  speaker: string;
  text: string;
}

/**
 * Parses the Teams transcript `metadataContent` (WEBVTT whose cues are JSON
 * with speakerName / spokenText). Consecutive cues of the same speaker are
 * merged. Plain-text cues (`<v Name>text`) are also accepted.
 */
export function parseTranscript(vtt: string, maxLines = 5000): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  const blocks = vtt.replace(/\r/g, '').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx < 0) continue;
    const at = (lines[timeIdx].split('-->')[0] ?? '').trim().split('.')[0];
    const body = lines.slice(timeIdx + 1).join('\n').trim();
    if (!body) continue;
    let speaker = '';
    let text = '';
    if (body.startsWith('{')) {
      try {
        const cue = JSON.parse(body) as { speakerName?: string; spokenText?: string };
        speaker = String(cue.speakerName ?? '').trim();
        text = String(cue.spokenText ?? '').trim();
      } catch {
        continue;
      }
    } else {
      const v = body.match(/^<v\s+([^>]+)>([\s\S]*?)(<\/v>)?$/);
      speaker = v ? v[1].trim() : '';
      text = (v ? v[2] : body).replace(/<[^>]+>/g, '').trim();
    }
    if (!text) continue;
    const prev = out[out.length - 1];
    if (prev && prev.speaker === speaker) {
      prev.text = `${prev.text} ${text}`;
      continue;
    }
    if (out.length >= maxLines) break;
    out.push({ at, speaker: speaker || 'Participante', text });
  }
  return out;
}

export interface SpeakerShare {
  speaker: string;
  words: number;
  /** Share of the words spoken in the meeting, 0-100 (rounded). */
  pct: number;
  interventions: number;
}

/**
 * Participation balance by speaker from the transcript (no AI): share of the
 * words each person spoke, biggest first. Visible only to attendees.
 */
export function participationFromLines(lines: TranscriptLine[]): SpeakerShare[] {
  const by = new Map<string, { words: number; interventions: number }>();
  let total = 0;
  for (const l of lines) {
    const words = l.text.split(/\s+/).filter(Boolean).length;
    if (words === 0) continue;
    const cur = by.get(l.speaker) ?? { words: 0, interventions: 0 };
    cur.words += words;
    cur.interventions += 1;
    by.set(l.speaker, cur);
    total += words;
  }
  return [...by.entries()]
    .map(([speaker, v]) => ({ speaker, words: v.words, interventions: v.interventions, pct: total ? Math.round((v.words / total) * 100) : 0 }))
    .sort((a, b) => b.words - a.words);
}
