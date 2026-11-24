import 'server-only';
/**
 * Meetings per PROJECT — data access (2026-11-24, approved by Nicolás Rivera, conv 1 msg 38206).
 * Pure rules in ./rules.ts. Same privacy model as linked e-mails (lib/chat/projects-links.ts):
 *   - only a meeting of the SESSION mailbox can be linked: the event is read again on the server by id;
 *   - the project gets a MINIMAL copy (subject, date, durations, attendee COUNTS, the linker's summary);
 *   - private or confidential meetings can never be linked;
 *   - one meeting → one project (unique iCalUId).
 * If the tables do not exist yet (code deployed before the DDL) everything answers «no disponible»
 * and "Mis reuniones" keeps working.
 */
import { prisma } from '../../prisma';
import { meetingsEnabledFor } from '../config';
import { isRealMeeting, normalizeMeeting, type GraphMeetingEvent } from '../metrics';
import { meetingsWithEvents, occurrenceActuals, readEvent } from '../service';
import { MeetingsGraphError } from '../graph';
import { canRemoveContribution, capabilitiesFor } from '../../chat/projects-rules';
import { projectModuleCompanies, type ProjectAccess, type ProjectUser } from '../../chat/projects';
import { registrarEvento } from '../../proyectos/cronograma';
import { projectKpis, suggestProject, type LinkInput, type MeetingOrigin, type SuggestionCandidate, type SuggestionReason } from './rules';
import type { MeetingProjectItemDto, ProjectMeetingDto, ProjectMeetingRuleDto, ProjectMeetingsDto } from './types';

export class MeetingLinkError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = 'MeetingLinkError';
  }
}

export const NOT_AVAILABLE = 'Las reuniones por proyecto todavía no están disponibles en este ambiente.';

/** The new tables are missing (code deployed before the DDL). */
function prismaCode(err: unknown): string | null {
  return err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'string' ? (err as { code: string }).code : null;
}

export function isUniqueViolation(err: unknown): boolean {
  return prismaCode(err) === 'P2002';
}

export function isMissingTable(err: unknown): boolean {
  const code = prismaCode(err);
  if (code === 'P2021' || code === 'P2022') return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /Invalid object name '?(dbo\.)?chat_project_meeting/i.test(msg);
}

/** Error → { status, error } for the routes (null = unexpected). */
export function meetingErrorResponse(err: unknown): { status: number; error: string } | null {
  if (err instanceof MeetingLinkError) return { status: err.status, error: err.message };
  if (err instanceof MeetingsGraphError) return { status: err.status === 404 ? 404 : err.status, error: err.message };
  if (isMissingTable(err)) return { status: 503, error: NOT_AVAILABLE };
  if (isUniqueViolation(err)) return { status: 409, error: 'Esa reunión ya quedó asignada a un proyecto.' };
  return null;
}

function clip(t: string | null | undefined, max: number): string | null {
  const v = (t ?? '').replace(/\s+/g, ' ').trim();
  if (!v) return null;
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

function attendeeEmails(e: GraphMeetingEvent): string[] {
  return (e.attendees ?? [])
    .filter((a) => (a.type ?? '').toLowerCase() !== 'resource')
    .map((a) => (a.emailAddress?.address ?? '').trim().toLowerCase())
    .filter((x) => x.includes('@'));
}

function isPrivate(e: GraphMeetingEvent): boolean {
  return ['private', 'confidential'].includes((e.sensitivity ?? 'normal').toLowerCase());
}

/* ───────────────────────────── Projects the person can assign to ───────────────────────────── */

/** Active projects where the person is OWNER or EDITOR and still has the module in the project's company. */
async function assignableProjects(user: ProjectUser): Promise<(SuggestionCandidate & { idCompany: number })[]> {
  const companies = new Set((await projectModuleCompanies(user.id)).map((c) => c.idCompany));
  if (companies.size === 0) return [];
  const rows = await prisma.chatProjectMember.findMany({
    where: { id_user: user.id, role: { in: ['owner', 'editor'] }, project: { archived: false, id_company: { in: [...companies] } } },
    select: {
      project: {
        select: {
          id_project: true,
          name: true,
          id_company: true,
          members: { select: { user: { select: { email: true } } } },
        },
      },
    },
    take: 200,
  });
  return rows
    .map((r) => ({
      idProject: r.project.id_project,
      name: r.project.name,
      idCompany: r.project.id_company,
      memberEmails: r.project.members.map((m) => (m.user?.email ?? '').toLowerCase()).filter(Boolean),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ───────────────────────────── Series rules ───────────────────────────── */

/**
 * Links the occurrences (already started, not private, not linked) of the series that have a rule for
 * this mailbox. Best effort: a conflict (someone linked it meanwhile) is skipped.
 */
async function applyRules(mailbox: string, events: GraphMeetingEvent[]): Promise<number> {
  const withSeries = events.filter((e) => e.seriesMasterId && e.iCalUId && !isPrivate(e) && isRealMeeting(e));
  if (withSeries.length === 0) return 0;
  const rules = await prisma.chatProjectMeetingRule.findMany({
    where: { mailbox, series_key: { in: [...new Set(withSeries.map((e) => e.seriesMasterId as string))] }, project: { archived: false } },
  });
  if (rules.length === 0) return 0;
  const ruleBySeries = new Map(rules.map((r) => [r.series_key, r]));
  const ya = await prisma.chatProjectMeeting.findMany({
    where: { ical_uid: { in: withSeries.map((e) => (e.iCalUId as string).trim()) } },
    select: { ical_uid: true },
  });
  const linked = new Set(ya.map((x) => x.ical_uid));
  let n = 0;
  const now = Date.now();
  for (const e of withSeries) {
    const rule = ruleBySeries.get(e.seriesMasterId as string);
    const ical = (e.iCalUId as string).trim();
    if (!rule || linked.has(ical)) continue;
    const m = normalizeMeeting(e, mailbox);
    if (Date.parse(m.start) > now) continue;
    try {
      const row = await prisma.chatProjectMeeting.create({
        data: {
          id_project: rule.id_project,
          ical_uid: ical,
          series_key: e.seriesMasterId ?? null,
          event_id: e.id,
          mailbox,
          subject: clip(m.subject, 400) ?? '(Sin asunto)',
          start_at: new Date(m.start),
          end_at: new Date(m.end),
          scheduled_minutes: m.scheduledMinutes,
          organizer_name: clip(m.organizerName, 200),
          organizer_email: clip(e.organizer?.emailAddress?.address?.toLowerCase(), 254),
          attendees_count: m.attendees,
          online: m.online,
          origin: 'serie',
          id_rule: rule.id_rule,
          linked_by: rule.id_user,
        },
        select: { id_project_meeting: true },
      });
      linked.add(ical);
      n++;
      await registrarEvento(prisma, {
        idProject: rule.id_project,
        entity: 'reunion',
        idEntity: row.id_project_meeting,
        action: 'vincular',
        detail: `Reunión «${clip(m.subject, 200)}» del ${m.start.slice(0, 10)} asignada por la regla de la serie.`,
        idUser: rule.id_user,
        via: 'web',
      }).catch(() => null);
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }
  return n;
}

const rulesAppliedAt = new Map<number, number>();
const RULES_EVERY_MS = 5 * 60_000;

/** When a member opens the project: apply its series rules with the calendar of each rule's owner. */
async function applyProjectRules(idProject: number): Promise<void> {
  const last = rulesAppliedAt.get(idProject) ?? 0;
  if (Date.now() - last < RULES_EVERY_MS) return;
  rulesAppliedAt.set(idProject, Date.now());
  const rules = await prisma.chatProjectMeetingRule.findMany({ where: { id_project: idProject }, select: { mailbox: true } });
  for (const mailbox of new Set(rules.map((r) => r.mailbox))) {
    if (!meetingsEnabledFor(mailbox)) continue;
    try {
      const rows = await meetingsWithEvents(mailbox, 30);
      await applyRules(mailbox, rows.map((r) => r.event).filter((e): e is GraphMeetingEvent => !!e));
    } catch (err) {
      console.error('[meetings/projects] series rules:', err instanceof Error ? err.message : err);
    }
  }
}

/* ───────────────────────────── «Mis reuniones»: project column ───────────────────────────── */

/**
 * Project of each meeting of the period for "Mis reuniones": the link (if the person can see the
 * project, its name; otherwise only that it belongs to another project), the suggestion and the rule.
 */
export async function meetingsProjectsView(user: ProjectUser, days: number): Promise<{
  projects: { idProject: number; name: string }[];
  items: Record<string, MeetingProjectItemDto>;
}> {
  const email = user.email.toLowerCase();
  const [rows, candidates] = await Promise.all([meetingsWithEvents(email, days), assignableProjects(user)]);
  const events = rows.map((r) => r.event).filter((e): e is GraphMeetingEvent => !!e);
  await applyRules(email, events);

  const icals = rows.map((r) => r.meeting.icalUid).filter((x): x is string => !!x);
  const series = [...new Set(events.map((e) => e.seriesMasterId).filter((x): x is string => !!x))];
  const [links, rules, seriesLinks, memberships] = await Promise.all([
    icals.length ? prisma.chatProjectMeeting.findMany({ where: { ical_uid: { in: icals } }, select: { id_project_meeting: true, id_project: true, ical_uid: true, origin: true, project: { select: { name: true } } } }) : [],
    series.length ? prisma.chatProjectMeetingRule.findMany({ where: { mailbox: email, series_key: { in: series } }, select: { id_rule: true, id_project: true, series_key: true } }) : [],
    series.length
      ? prisma.chatProjectMeeting.findMany({
          where: { mailbox: email, series_key: { in: series } },
          orderBy: { start_at: 'desc' },
          select: { series_key: true, id_project: true },
        })
      : [],
    prisma.chatProjectMember.findMany({ where: { id_user: user.id, project: { archived: false } }, select: { id_project: true } }),
  ]);
  const mine = new Set(memberships.map((m) => m.id_project));
  const byIcal = new Map(links.map((l) => [l.ical_uid, l]));
  const ruleBySeries = new Map(rules.map((r) => [r.series_key, r]));
  const seriesProject = new Map<string, number>();
  for (const s of seriesLinks) if (s.series_key && !seriesProject.has(s.series_key)) seriesProject.set(s.series_key, s.id_project);
  const nameOf = new Map(candidates.map((c) => [c.idProject, c.name]));

  const items: Record<string, MeetingProjectItemDto> = {};
  for (const { meeting, event } of rows) {
    const link = meeting.icalUid ? byIcal.get(meeting.icalUid) : undefined;
    const rule = event?.seriesMasterId ? ruleBySeries.get(event.seriesMasterId) : undefined;
    const item: MeetingProjectItemDto = { canAssign: !meeting.private && !!meeting.icalUid && candidates.length > 0 };
    if (link) {
      const visible = mine.has(link.id_project);
      item.link = {
        linkId: visible ? link.id_project_meeting : null,
        idProject: visible ? link.id_project : null,
        projectName: visible ? link.project.name : null,
        origin: link.origin as MeetingOrigin,
      };
      item.canAssign = false;
    } else if (item.canAssign && event) {
      const s = suggestProject(
        { subject: meeting.subject, attendeeEmails: attendeeEmails(event), me: email, seriesProject: event.seriesMasterId ? seriesProject.get(event.seriesMasterId) ?? null : null },
        candidates
      );
      if (s) item.suggestion = { idProject: s.idProject, projectName: nameOf.get(s.idProject) ?? '', reason: s.reason as SuggestionReason };
    }
    if (rule) item.rule = { idRule: rule.id_rule, idProject: rule.id_project, projectName: nameOf.get(rule.id_project) ?? null };
    items[meeting.id] = item;
  }
  return { projects: candidates.map((c) => ({ idProject: c.idProject, name: c.name })), items };
}

/* ───────────────────────────── Link / unlink ───────────────────────────── */

export async function linkMeeting(
  user: ProjectUser,
  project: ProjectAccess,
  input: LinkInput,
  summary: string | null
): Promise<{ id: number; seriesRule: boolean }> {
  if (project.archived || !capabilitiesFor(project.role).contribute) {
    throw new MeetingLinkError('Su rol en el proyecto no permite asignar reuniones.', 403);
  }
  const email = user.email.toLowerCase();
  if (!meetingsEnabledFor(email)) throw new MeetingLinkError('El módulo de reuniones no está habilitado para su cuenta.', 403);

  // Always the SESSION mailbox: an id from another calendar gives 404.
  let event: GraphMeetingEvent;
  try {
    event = await readEvent(email, input.eventId);
  } catch (err) {
    if (err instanceof MeetingsGraphError && err.status === 404) throw new MeetingLinkError('No se encontró la reunión en su calendario.', 404);
    throw err;
  }
  if (!isRealMeeting(event)) throw new MeetingLinkError('Ese evento no cuenta como reunión (cancelado, de todo el día o sin invitados).', 400);
  if (isPrivate(event)) throw new MeetingLinkError('Las reuniones privadas o confidenciales no se pueden asignar a un proyecto.', 403);
  const ical = event.iCalUId?.trim();
  if (!ical) throw new MeetingLinkError('Microsoft 365 no entregó el identificador de la reunión; no se puede asignar.', 409);

  const existing = await prisma.chatProjectMeeting.findUnique({ where: { ical_uid: ical }, select: { id_project: true, project: { select: { name: true } } } });
  if (existing) {
    const member = await prisma.chatProjectMember.count({ where: { id_project: existing.id_project, id_user: user.id } });
    throw new MeetingLinkError(
      existing.id_project === project.idProject
        ? 'Esa reunión ya está en este proyecto.'
        : member > 0
          ? `Esa reunión ya está asignada al proyecto «${existing.project.name}». Quítela de allá primero.`
          : 'Esa reunión ya está asignada a otro proyecto.',
      409
    );
  }

  const m = normalizeMeeting(event, email);
  const actuals = await occurrenceActuals(email, event);
  const seriesKey = input.applyToSeries ? event.seriesMasterId ?? null : null;
  if (input.applyToSeries && !seriesKey) throw new MeetingLinkError('Esa reunión no es periódica: no tiene serie.', 400);

  const result = await prisma.$transaction(async (tx) => {
    let idRule: number | null = null;
    if (seriesKey) {
      const rule = await tx.chatProjectMeetingRule.upsert({
        where: { mailbox_series_key: { mailbox: email, series_key: seriesKey } },
        create: { id_project: project.idProject, id_user: user.id, mailbox: email, series_key: seriesKey, subject_snapshot: clip(m.subject, 400) ?? '(Sin asunto)' },
        update: { id_project: project.idProject, id_user: user.id, subject_snapshot: clip(m.subject, 400) ?? '(Sin asunto)' },
        select: { id_rule: true },
      });
      idRule = rule.id_rule;
    }
    const row = await tx.chatProjectMeeting.create({
      data: {
        id_project: project.idProject,
        ical_uid: ical,
        series_key: event.seriesMasterId ?? null,
        event_id: event.id,
        mailbox: email,
        subject: clip(m.subject, 400) ?? '(Sin asunto)',
        start_at: new Date(m.start),
        end_at: new Date(m.end),
        scheduled_minutes: m.scheduledMinutes,
        actual_minutes: actuals.actualMinutes,
        start_delay_minutes: actuals.startDelayMinutes,
        organizer_name: clip(m.organizerName, 200),
        organizer_email: clip(event.organizer?.emailAddress?.address?.toLowerCase(), 254),
        attendees_count: m.attendees,
        attended_count: actuals.participants,
        online: m.online,
        has_transcript: actuals.available ? actuals.hasTranscript : null,
        summary,
        origin: seriesKey ? 'serie' : input.origin,
        id_rule: idRule,
        linked_by: user.id,
      },
      select: { id_project_meeting: true },
    });
    await registrarEvento(tx, {
      idProject: project.idProject,
      entity: 'reunion',
      idEntity: row.id_project_meeting,
      action: seriesKey ? 'regla_serie' : 'vincular',
      detail: `Reunión «${clip(m.subject, 200)}» del ${m.start.slice(0, 10)} asignada${seriesKey ? ' con toda su serie' : ''}.`,
      idUser: user.id,
      via: 'web',
    });
    await tx.chatProject.update({ where: { id_project: project.idProject }, data: { updated_at: new Date() } });
    return row;
  });
  if (seriesKey) {
    // The other occurrences already in the calendar go to the project right away.
    const rows = await meetingsWithEvents(email, 90).catch(() => []);
    await applyRules(email, rows.map((r) => r.event).filter((e): e is GraphMeetingEvent => !!e)).catch((err) => console.error('[meetings/projects] series:', err));
  }
  return { id: result.id_project_meeting, seriesRule: !!seriesKey };
}

export async function unlinkMeeting(user: ProjectUser, project: ProjectAccess, linkId: number): Promise<void> {
  if (project.archived) throw new MeetingLinkError('El proyecto está archivado.', 403);
  const row = await prisma.chatProjectMeeting.findFirst({ where: { id_project_meeting: linkId, id_project: project.idProject } });
  if (!row) throw new MeetingLinkError('Reunión no encontrada en el proyecto.', 404);
  if (!canRemoveContribution(project.role, user.id, row.linked_by)) {
    throw new MeetingLinkError('Solo quien la asignó o el dueño del proyecto pueden quitarla.', 403);
  }
  const busy = await prisma.chatProjectMeetingAnalysis.count({ where: { id_project_meeting: linkId, status: 'analizando' } });
  if (busy > 0) throw new MeetingLinkError('Hay un análisis en curso: espere a que termine para quitar la reunión.', 409);
  await prisma.$transaction(async (tx) => {
    await tx.chatProjectMeeting.delete({ where: { id_project_meeting: linkId } });
    await registrarEvento(tx, {
      idProject: project.idProject,
      entity: 'reunion',
      idEntity: linkId,
      action: 'desvincular',
      detail: `Reunión «${clip(row.subject, 200)}» del ${row.start_at.toISOString().slice(0, 10)} quitada del proyecto.`,
      idUser: user.id,
      via: 'web',
    });
  });
}

/** Removes a «whole series» rule: whoever created it, or the owner of its project. Linked meetings stay. */
export async function deleteRule(user: ProjectUser, idRule: number): Promise<void> {
  const rule = await prisma.chatProjectMeetingRule.findUnique({ where: { id_rule: idRule } });
  if (!rule) throw new MeetingLinkError('Regla no encontrada.', 404);
  if (rule.id_user !== user.id) {
    const owner = await prisma.chatProjectMember.count({ where: { id_project: rule.id_project, id_user: user.id, role: 'owner' } });
    if (owner === 0) throw new MeetingLinkError('Regla no encontrada.', 404);
  }
  await prisma.$transaction(async (tx) => {
    await tx.chatProjectMeetingRule.delete({ where: { id_rule: idRule } });
    await registrarEvento(tx, {
      idProject: rule.id_project,
      entity: 'reunion',
      idEntity: null,
      action: 'quitar_regla',
      detail: `Se quitó la regla de la serie «${clip(rule.subject_snapshot, 200)}»: las próximas reuniones ya no se asignan solas.`,
      idUser: user.id,
      via: 'web',
    });
  });
}

/* ───────────────────────────── Project section ───────────────────────────── */

const DAY_MS = 86_400_000;

function parseJsonArray(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Meetings of the project in the period, with their latest analysis and the indicators. */
export async function projectMeetings(user: ProjectUser, project: ProjectAccess, days: number): Promise<ProjectMeetingsDto> {
  await applyProjectRules(project.idProject).catch(() => null);
  const since = new Date(Date.now() - days * DAY_MS);
  const [rows, rules] = await Promise.all([
    prisma.chatProjectMeeting.findMany({
      where: { id_project: project.idProject, start_at: { gte: since } },
      orderBy: { start_at: 'desc' },
      take: 300,
      include: {
        analyses: {
          orderBy: { id_analysis: 'desc' },
          take: 1,
          select: { id_analysis: true, status: true, score: true, decisions_json: true, commitments_json: true, proposals_json: true, created_at: true, finished_at: true, error: true },
        },
      },
    }),
    prisma.chatProjectMeetingRule.findMany({ where: { id_project: project.idProject }, orderBy: { created_at: 'asc' } }),
  ]);
  const proposalIds = rows.flatMap((r) => parseJsonArray(r.analyses[0]?.proposals_json ?? null)).filter((x): x is number => typeof x === 'number');
  const [proposals, people] = await Promise.all([
    proposalIds.length ? prisma.chatProjectProposal.findMany({ where: { id_proposal: { in: proposalIds } }, select: { id_proposal: true, status: true } }) : [],
    prisma.user.findMany({
      where: { id: { in: [...new Set([...rows.map((r) => r.linked_by), ...rules.map((r) => r.id_user)])] } },
      select: { id: true, name: true, email: true },
    }),
  ]);
  const status = new Map(proposals.map((p) => [p.id_proposal, p.status]));
  const nameOf = new Map(people.map((p) => [p.id, p.name?.trim() || p.email]));

  const meetings: ProjectMeetingDto[] = rows.map((r) => {
    const a = r.analyses[0];
    const ids = parseJsonArray(a?.proposals_json ?? null).filter((x): x is number => typeof x === 'number');
    return {
      id: r.id_project_meeting,
      subject: r.subject,
      start: r.start_at.toISOString(),
      end: r.end_at.toISOString(),
      scheduledMinutes: r.scheduled_minutes,
      actualMinutes: r.actual_minutes,
      startDelayMinutes: r.start_delay_minutes,
      organizerName: r.organizer_name,
      attendeesCount: r.attendees_count,
      attendedCount: r.attended_count,
      online: r.online,
      hasTranscript: r.has_transcript,
      summary: r.summary,
      origin: r.origin as MeetingOrigin,
      linkedBy: nameOf.get(r.linked_by) ?? 'Persona retirada',
      linkedByMe: r.linked_by === user.id,
      canRemove: !project.archived && canRemoveContribution(project.role, user.id, r.linked_by),
      analysis: a
        ? {
            id: a.id_analysis,
            status: a.status as 'analizando' | 'listo' | 'fallido',
            score: a.score,
            decisions: parseJsonArray(a.decisions_json).length,
            commitments: parseJsonArray(a.commitments_json).length,
            proposals: ids.length,
            proposalsConfirmed: ids.filter((id) => status.get(id) === 'confirmada').length,
            createdAt: a.created_at.toISOString(),
            finishedAt: a.finished_at?.toISOString() ?? null,
            error: a.error,
          }
        : null,
    };
  });
  const ruleDtos: ProjectMeetingRuleDto[] = rules.map((r) => ({
    id: r.id_rule,
    subject: r.subject_snapshot,
    createdBy: nameOf.get(r.id_user) ?? 'Persona retirada',
    createdAt: r.created_at.toISOString(),
    canDelete: r.id_user === user.id || project.role === 'owner',
  }));
  return {
    days,
    meetings,
    rules: ruleDtos,
    kpis: projectKpis(
      meetings.map((m) => ({
        scheduledMinutes: m.scheduledMinutes,
        actualMinutes: m.actualMinutes,
        attendeesCount: m.attendeesCount,
        attendedCount: m.attendedCount,
        startDelayMinutes: m.startDelayMinutes,
        analysis: m.analysis ? { status: m.analysis.status, decisions: m.analysis.decisions, commitments: m.analysis.commitments, proposalsConfirmed: m.analysis.proposalsConfirmed } : null,
      }))
    ),
    viewer: {
      meetingsEnabled: meetingsEnabledFor(user.email),
      canAssign: !project.archived && capabilitiesFor(project.role).contribute && meetingsEnabledFor(user.email),
    },
  };
}

