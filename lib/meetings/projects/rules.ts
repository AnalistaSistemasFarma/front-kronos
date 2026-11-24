/**
 * Meetings per PROJECT (2026-11-24, approved by Nicolás Rivera, SynerLink conv 1, msg 38206) — PURE rules.
 * Data access lives in ./links.ts and ./analysis.ts; this file has no I/O and is unit tested.
 *
 * Decisions:
 *   - A meeting assigned to a project is visible to ALL project members (like linked e-mails): subject,
 *     date, duration, attendee COUNTS, the linker's summary and the agent's analysis. The transcript is
 *     only for attendees and is never stored in SynerLink.
 *   - One meeting → one project (iCalUId is unique).
 *   - Suggestions are simple rules, no AI: the series already went to a project, the subject names the
 *     project, or most of the other attendees are members of the same project.
 *   - No ranking of people: indicators are per meeting / per project.
 */

export type MeetingOrigin = 'manual' | 'serie' | 'sugerencia';
export const MEETING_ORIGINS: readonly MeetingOrigin[] = ['manual', 'serie', 'sugerencia'];

export const ORIGIN_LABELS: Record<MeetingOrigin, string> = {
  manual: 'Asignada a mano',
  serie: 'Por la regla de la serie',
  sugerencia: 'Sugerencia confirmada',
};

/** Same normalization used to match names (no accents, lower case, single spaces). */
export function normalizeText(t: string | null | undefined): string {
  return String(t ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Words that never identify a project by themselves. */
const STOPWORDS = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'o', 'u', 'en', 'con', 'para', 'por', 'a', 'al', 'un', 'una',
  'proyecto', 'proyectos', 'reunion', 'reuniones', 'seguimiento', 'semanal', 'mensual', 'comite', 'prueba',
  'pruebas', 'the', 'and', 'of', 'meeting',
]);

export function tokens(t: string | null | undefined): string[] {
  return normalizeText(t)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

export interface SuggestionCandidate {
  idProject: number;
  name: string;
  /** Lower-case e-mails of the project members. */
  memberEmails: string[];
}

export interface SuggestionInput {
  subject: string;
  /** Lower-case e-mails of the invitees (resources excluded). */
  attendeeEmails: string[];
  /** Session e-mail (not counted as "another attendee"). */
  me: string;
  /** Project of another occurrence of the same series already linked, if any. */
  seriesProject?: number | null;
}

export type SuggestionReason = 'serie' | 'asunto' | 'asistentes';

export const SUGGESTION_REASON_LABELS: Record<SuggestionReason, string> = {
  serie: 'otra reunión de la misma serie ya está en este proyecto',
  asunto: 'el asunto menciona el proyecto',
  asistentes: 'la mayoría de asistentes son miembros del proyecto',
};

/**
 * Suggested project for a meeting, or null. Only among `candidates` (projects where the person can
 * assign: owner or editor). Ties give no suggestion: the server never guesses between two projects.
 */
export function suggestProject(input: SuggestionInput, candidates: SuggestionCandidate[]): { idProject: number; reason: SuggestionReason } | null {
  if (candidates.length === 0) return null;
  if (input.seriesProject && candidates.some((c) => c.idProject === input.seriesProject)) {
    return { idProject: input.seriesProject, reason: 'serie' };
  }

  // Subject: words of the project name that no other candidate project shares.
  const freq = new Map<string, number>();
  const byProject = new Map<number, Set<string>>();
  for (const c of candidates) {
    const set = new Set(tokens(c.name));
    byProject.set(c.idProject, set);
    for (const w of set) freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  const subject = new Set(tokens(input.subject));
  const subjectNorm = normalizeText(input.subject);
  let best: { id: number; score: number } | null = null;
  let tie = false;
  for (const c of candidates) {
    const fullName = normalizeText(c.name);
    let score = fullName.length >= 4 && subjectNorm.includes(fullName) ? 10 : 0;
    for (const w of byProject.get(c.idProject) ?? []) if (freq.get(w) === 1 && subject.has(w)) score += 1;
    if (score === 0) continue;
    if (!best || score > best.score) {
      best = { id: c.idProject, score };
      tie = false;
    } else if (score === best.score) tie = true;
  }
  if (best && !tie) return { idProject: best.id, reason: 'asunto' };

  // Attendees: more than half of the OTHER invitees are members of one project.
  const me = input.me.trim().toLowerCase();
  const others = [...new Set(input.attendeeEmails.map((e) => e.trim().toLowerCase()).filter((e) => e && e !== me))];
  if (others.length === 0) return null;
  let bestA: { id: number; n: number } | null = null;
  let tieA = false;
  for (const c of candidates) {
    const members = new Set(c.memberEmails);
    const n = others.filter((e) => members.has(e)).length;
    if (n * 2 <= others.length) continue;
    if (!bestA || n > bestA.n) {
      bestA = { id: c.idProject, n };
      tieA = false;
    } else if (n === bestA.n) tieA = true;
  }
  return bestA && !tieA ? { idProject: bestA.id, reason: 'asistentes' } : null;
}

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

export interface LinkInput {
  eventId: string;
  applyToSeries: boolean;
  origin: 'manual' | 'sugerencia';
}

/** Body of POST /api/proyectos/[id]/vinculos/reuniones (the summary is validated with normalizeLinkSummary). */
export function parseLinkInput(raw: Record<string, unknown>): Validation<LinkInput> {
  const eventId = typeof raw.eventId === 'string' ? raw.eventId.trim() : '';
  if (!eventId || eventId.length > 512 || /[\s/\\?#]/.test(eventId)) return { ok: false, error: 'Reunión inválida.' };
  if (raw.applyToSeries !== undefined && typeof raw.applyToSeries !== 'boolean') return { ok: false, error: 'applyToSeries debe ser verdadero o falso.' };
  const origin = raw.origin === 'sugerencia' ? 'sugerencia' : 'manual';
  return { ok: true, value: { eventId, applyToSeries: raw.applyToSeries === true, origin } };
}

export interface ProjectMeetingRow {
  scheduledMinutes: number;
  actualMinutes: number | null;
  attendeesCount: number;
  attendedCount: number | null;
  startDelayMinutes: number | null;
  analysis: { status: string; decisions: number; commitments: number; proposalsConfirmed: number } | null;
}

export interface ProjectMeetingsKpis {
  meetings: number;
  /** Person-hours ×10 rounded to one decimal: sum of (real or scheduled minutes × people who joined or were invited). */
  personHours: number;
  analyzed: number;
  withDecisions: number;
  commitments: number;
  proposalsConfirmed: number;
  onTime: number;
  withActuals: number;
}

/** Indicators of the project section (no ranking of people: only per meeting / per project). */
export function projectKpis(rows: ProjectMeetingRow[]): ProjectMeetingsKpis {
  let minutes = 0;
  const k: ProjectMeetingsKpis = { meetings: rows.length, personHours: 0, analyzed: 0, withDecisions: 0, commitments: 0, proposalsConfirmed: 0, onTime: 0, withActuals: 0 };
  for (const r of rows) {
    const people = r.attendedCount ?? r.attendeesCount ?? 0;
    minutes += (r.actualMinutes ?? r.scheduledMinutes) * Math.max(people, 1);
    if (r.startDelayMinutes !== null) {
      k.withActuals += 1;
      if (r.startDelayMinutes <= 5) k.onTime += 1;
    }
    if (r.analysis?.status === 'listo') {
      k.analyzed += 1;
      if (r.analysis.decisions > 0) k.withDecisions += 1;
      k.commitments += r.analysis.commitments;
      k.proposalsConfirmed += r.analysis.proposalsConfirmed;
    }
  }
  k.personHours = Math.round((minutes / 60) * 10) / 10;
  return k;
}

/** Bogotá date (YYYY-MM-DD) of an instant. */
export function bogotaDate(iso: string | Date): string {
  const ms = typeof iso === 'string' ? Date.parse(iso) : iso.getTime();
  return new Date(ms - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
