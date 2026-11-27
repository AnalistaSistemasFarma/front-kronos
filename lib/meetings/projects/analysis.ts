import 'server-only';
/**
 * Meeting ANALYSIS by the project's agent, ON DEMAND (2026-11-24, approved by Nicolás Rivera, conv 1 msg 38206).
 * Pure rules (prompt, answer schema, proposals) in ./analysis-rules.ts.
 *
 * SynerLink never calls a model. The flow reuses the project architecture:
 *   1. An ATTENDEE (owner or editor of the project, with the meeting in their own calendar) presses
 *      «Analizar». The server reads the transcript live from Teams with THEIR mailbox.
 *   2. It opens a project conversation with the project's agent («Análisis de reunión · …») and leaves a
 *      SYSTEM message with a delivery row for the agent — the same mechanism as the discussion-table
 *      turns. The stored message is a short notice; the transcript only travels in the agent's inbox
 *      (app/api/chat/agent/inbox → analysisTurnForAgent) and is never written in SynerLink.
 *   3. The agent's bridge answers in that conversation with a ```analisis-reunion``` block. The publish
 *      route calls onAgentPublishedAnalysis: the result is validated and stored, the commitments become
 *      `tarea_crear` PROPOSALS (a person confirms them in the Cronograma) and the raw reply is replaced
 *      by a readable text.
 *   4. Ten minutes after it finishes, the working conversation is archived (deleted logically): nobody
 *      can keep asking the agent about the transcript there.
 */
import { prisma } from '../../prisma';
import { meetingsEnabledFor } from '../config';
import { MeetingsGraphError } from '../graph';
import { participationFromLines, type TranscriptLine } from '../metrics';
import { findOwnOccurrence, meetingTranscript, occurrenceActuals } from '../service';
import { capabilitiesFor } from '../../chat/projects-rules';
import { writeAccessForAgent, type ProjectAccess, type ProjectUser } from '../../chat/projects';
import { crearConversacionProyecto, errorDeProyecto } from '../../proyectos/acciones';
import { registrarEvento } from '../../proyectos/cronograma';
import { crearPropuestasDelPuente } from '../../proyectos/propuestas';
import { MAX_AGENT_MESSAGE_CHARS } from '../../chat/constants';
import { formatDay, formatTime } from '../format';
import {
  ANALYSIS_ARCHIVE_AFTER_MS,
  ANALYSIS_TIMEOUT_MS,
  MAX_ANALYSES_PER_PROJECT_PER_DAY,
  MAX_TRANSCRIPT_CHARS,
  buildAnalysisPrompt,
  commitmentsToProposals,
  parseAnalysisReply,
  renderAnalysisMarkdown,
  requestNotice,
  transcriptText,
  type Commitment,
  type MeetingAnalysisResult,
} from './analysis-rules';
import { bogotaDate } from './rules';
import { MeetingLinkError } from './links';
import type { AnalysisMetrics, MeetingAnalysisDto } from './types';

/** Name the agent sees as the author of the request (no e-mail: it never activates a person's permissions). */
export const ANALYSIS_AUTHOR_NAME = 'Análisis de reuniones';

/* ───────────────────────────── Transcript in memory (never in the database) ───────────────────────────── */

const transcripts = new Map<number, { lines: TranscriptLine[]; expires: number }>();

function rememberTranscript(idAnalysis: number, lines: TranscriptLine[]): void {
  const now = Date.now();
  for (const [k, v] of transcripts) if (v.expires <= now) transcripts.delete(k);
  transcripts.set(idAnalysis, { lines, expires: now + ANALYSIS_TIMEOUT_MS });
}

function forgetTranscript(idAnalysis: number): void {
  transcripts.delete(idAnalysis);
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function nameOf(idUser: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: idUser }, select: { name: true, email: true } });
  return u?.name?.trim() || u?.email || 'Una persona';
}

async function projectMembers(idProject: number): Promise<{ name: string; email: string }[]> {
  const rows = await prisma.chatProjectMember.findMany({
    where: { id_project: idProject },
    select: { user: { select: { name: true, email: true, isActive: true } } },
  });
  return rows.filter((r) => r.user?.isActive && r.user.email).map((r) => ({ name: r.user.name?.trim() || r.user.email, email: r.user.email.toLowerCase() }));
}

/* ───────────────────────────── Housekeeping ───────────────────────────── */

/**
 * Lazy housekeeping of a project's analyses (no cron): a request without answer after the timeout
 * fails, the working conversation of a finished analysis is archived, and the turn usage is copied.
 */
export async function sweepProjectAnalyses(idProject: number, now: Date = new Date()): Promise<void> {
  await prisma.chatProjectMeetingAnalysis.updateMany({
    where: { status: 'analizando', created_at: { lt: new Date(now.getTime() - ANALYSIS_TIMEOUT_MS) }, meeting: { id_project: idProject } },
    data: { status: 'fallido', error: 'El asistente no respondió a tiempo. Puede volver a pedir el análisis.', finished_at: now },
  });
  const finished = await prisma.chatProjectMeetingAnalysis.findMany({
    where: {
      status: { in: ['listo', 'fallido'] },
      finished_at: { lt: new Date(now.getTime() - ANALYSIS_ARCHIVE_AFTER_MS) },
      id_conversation: { not: null },
      meeting: { id_project: idProject },
    },
    orderBy: { id_analysis: 'desc' },
    take: 50,
    select: { id_analysis: true, id_conversation: true, tokens_in: true },
  });
  if (finished.length === 0) return;
  const ids = finished.map((f) => f.id_conversation as number);
  const open = await prisma.chatConversation.findMany({ where: { id: { in: ids }, kind: 'project', id_project: idProject, archived: false }, select: { id: true } });
  if (open.length > 0) {
    // Copy the agent's usage of the turn before closing the thread (reported by the bridge per conversation).
    for (const f of finished.filter((x) => x.tokens_in === null && open.some((o) => o.id === x.id_conversation))) {
      const usage = await prisma.chatAgentTurnUsage.findMany({
        where: { id_conversation: f.id_conversation as number },
        select: { input_tokens: true, cache_creation_tokens: true, cache_read_tokens: true, output_tokens: true, models: true },
      });
      if (usage.length === 0) continue;
      await prisma.chatProjectMeetingAnalysis.update({
        where: { id_analysis: f.id_analysis },
        data: {
          tokens_in: usage.reduce((a, u) => a + u.input_tokens + u.cache_creation_tokens + u.cache_read_tokens, 0),
          tokens_out: usage.reduce((a, u) => a + u.output_tokens, 0),
          model: (usage.map((u) => u.models).find(Boolean) ?? '').slice(0, 60) || null,
        },
      });
    }
    await prisma.chatConversation.updateMany({ where: { id: { in: open.map((o) => o.id) }, archived: false }, data: { archived: true } });
  }
}

/* ───────────────────────────── Request («Analizar») ───────────────────────────── */

async function pickAgent(user: ProjectUser, project: ProjectAccess): Promise<{ idAgent: number; code: string; displayName: string }> {
  const p = await prisma.chatProject.findUnique({
    where: { id_project: project.idProject },
    select: { id_agent: true, agents: { orderBy: { id_project_agent: 'asc' }, select: { agent: { select: { id_agent: true, code: true, display_name: true } } } } },
  });
  const agents = (p?.agents ?? []).map((a) => a.agent);
  // The agent the project was created with goes first («el agente del proyecto»).
  agents.sort((a, b) => Number(b.id_agent === p?.id_agent) - Number(a.id_agent === p?.id_agent));
  let motivo = 'El proyecto no tiene asistentes: agregue uno para poder analizar reuniones.';
  for (const a of agents) {
    const w = await writeAccessForAgent(user, project, a.id_agent);
    if (w.ok) return { idAgent: a.id_agent, code: a.code, displayName: a.display_name };
    motivo = w.motivo;
  }
  throw new MeetingLinkError(motivo, 403);
}

export async function requestAnalysis(user: ProjectUser, project: ProjectAccess, linkId: number): Promise<{ id: number; status: 'analizando'; agentName: string }> {
  if (project.archived || !capabilitiesFor(project.role).write) {
    throw new MeetingLinkError('Su rol en el proyecto no permite pedir análisis de reuniones.', 403);
  }
  const email = user.email.toLowerCase();
  if (!meetingsEnabledFor(email)) throw new MeetingLinkError('El módulo de reuniones no está habilitado para su cuenta.', 403);
  const link = await prisma.chatProjectMeeting.findFirst({ where: { id_project_meeting: linkId, id_project: project.idProject } });
  if (!link) throw new MeetingLinkError('Reunión no encontrada en el proyecto.', 404);

  await sweepProjectAnalyses(project.idProject);
  const busy = await prisma.chatProjectMeetingAnalysis.count({ where: { id_project_meeting: linkId, status: 'analizando' } });
  if (busy > 0) throw new MeetingLinkError('Ya hay un análisis en curso para esta reunión.', 409);
  const dayStart = new Date(`${bogotaDate(new Date())}T05:00:00.000Z`);
  const today = await prisma.chatProjectMeetingAnalysis.count({ where: { created_at: { gte: dayStart }, meeting: { id_project: project.idProject } } });
  if (today >= MAX_ANALYSES_PER_PROJECT_PER_DAY) {
    throw new MeetingLinkError(`El proyecto ya pidió ${MAX_ANALYSES_PER_PROJECT_PER_DAY} análisis hoy (tope diario para cuidar el cupo del asistente).`, 429);
  }

  // Only an ATTENDEE: the meeting must be in their own calendar. The transcript is read with their mailbox.
  const own = await findOwnOccurrence(email, link.ical_uid, link.start_at.toISOString(), link.end_at.toISOString());
  if (!own) throw new MeetingLinkError('Solo quienes asistieron a la reunión (la tienen en su calendario) pueden pedir el análisis.', 403);
  const transcript = await meetingTranscript(email, own.id);
  if (!transcript.available || transcript.lines.length === 0) {
    await prisma.chatProjectMeeting.update({ where: { id_project_meeting: linkId }, data: { has_transcript: false } }).catch(() => null);
    throw new MeetingLinkError(transcript.reason ?? 'La reunión no tiene transcripción: no hay qué analizar.', 409);
  }
  const actuals = await occurrenceActuals(email, own);
  const agent = await pickAgent(user, project);

  const participation = participationFromLines(transcript.lines);
  const attended = actuals.participants ?? link.attended_count;
  const metrics: AnalysisMetrics = {
    scheduledMinutes: link.scheduled_minutes,
    actualMinutes: actuals.actualMinutes ?? link.actual_minutes,
    startDelayMinutes: actuals.startDelayMinutes ?? link.start_delay_minutes,
    overrunMinutes: actuals.overrunMinutes,
    attendeesCount: link.attendees_count,
    attendedCount: attended,
    speakers: participation.length,
    silentAttendees: attended !== null ? Math.max(0, attended - participation.length) : null,
    participation,
    transcriptTruncated: transcriptText(transcript.lines).truncated,
  };

  let idConversation: number;
  try {
    ({ idConversation } = await crearConversacionProyecto(user, project, { agentCode: agent.code, title: `Análisis de reunión · ${link.subject}` }));
  } catch (err) {
    const e = errorDeProyecto(err);
    if (e) throw new MeetingLinkError(e.error, e.status);
    throw err;
  }
  const requester = await nameOf(user.id);
  const date = bogotaDate(link.start_at);
  const now = new Date();
  const analysis = await prisma.$transaction(async (tx) => {
    const a = await tx.chatProjectMeetingAnalysis.create({
      data: {
        id_project_meeting: linkId,
        id_agent: agent.idAgent,
        id_conversation: idConversation,
        requested_by: user.id,
        mailbox: email,
        event_id: own.id,
        status: 'analizando',
        metrics_json: JSON.stringify(metrics),
      },
      select: { id_analysis: true },
    });
    // SYSTEM message with a delivery row for the agent: its bridge picks it up like a discussion-table turn.
    const msg = await tx.chatMessage.create({
      data: {
        id_conversation: idConversation,
        role: 'system',
        body: requestNotice({ requestedBy: requester, subject: link.subject, date, agentName: agent.displayName }),
        created_at: now,
        delivered_at: now,
        deliveries: { create: [{ id_agent: agent.idAgent }] },
      },
      select: { id: true },
    });
    await tx.chatProjectMeetingAnalysis.update({ where: { id_analysis: a.id_analysis }, data: { id_message_request: msg.id } });
    await tx.chatConversation.update({ where: { id: idConversation }, data: { last_message_at: now } });
    await tx.chatProjectMeeting.update({
      where: { id_project_meeting: linkId },
      data: {
        has_transcript: true,
        actual_minutes: metrics.actualMinutes,
        start_delay_minutes: metrics.startDelayMinutes,
        attended_count: metrics.attendedCount,
      },
    });
    await registrarEvento(tx, {
      idProject: project.idProject,
      entity: 'reunion',
      idEntity: linkId,
      action: 'analizar',
      detail: `${requester} pidió a ${agent.displayName} el análisis de la reunión ${link.subject.slice(0, 200)} del ${date} (análisis #${a.id_analysis}).`,
      idUser: user.id,
      idAgent: agent.idAgent,
      via: 'web',
    });
    return a;
  });
  rememberTranscript(analysis.id_analysis, transcript.lines);
  return { id: analysis.id_analysis, status: 'analizando', agentName: agent.displayName };
}

/* ───────────────────────────── Agent inbox ───────────────────────────── */

/**
 * For the projects inbox: if the message is an analysis request for THIS agent, what the agent receives
 * = notice + instructions + transcript (read from memory or, after a restart, again from Teams with the
 * requester's mailbox). Null = not an analysis request.
 */
export async function analysisTurnForAgent(m: { id: number; role: string; body: string }, idAgent: number): Promise<{ body: string } | null> {
  if (m.role !== 'system') return null;
  const a = await prisma.chatProjectMeetingAnalysis.findFirst({
    where: { id_message_request: m.id, id_agent: idAgent },
    include: { meeting: { include: { project: { select: { id_project: true, name: true } } } } },
  });
  if (!a) return null;
  if (a.status !== 'analizando') {
    return { body: `${m.body}\n\n(Este análisis ya no está pendiente en SynerLink: responda solo Entendido.)` };
  }
  let lines = transcripts.get(a.id_analysis)?.lines ?? null;
  if (!lines) {
    try {
      if (meetingsEnabledFor(a.mailbox)) {
        const t = await meetingTranscript(a.mailbox, a.event_id);
        if (t.available) lines = t.lines;
      }
    } catch (err) {
      console.error('[meetings/analysis] transcript for the agent:', err instanceof Error ? err.message : err);
    }
    if (!lines || lines.length === 0) {
      await prisma.chatProjectMeetingAnalysis.updateMany({
        where: { id_analysis: a.id_analysis, status: 'analizando' },
        data: { status: 'fallido', error: 'No se pudo volver a leer la transcripción de Teams. Pida el análisis de nuevo.', finished_at: new Date() },
      });
      return { body: `${m.body}\n\n(No se pudo leer la transcripción y el análisis se canceló: responda solo Entendido.)` };
    }
    rememberTranscript(a.id_analysis, lines);
  }

  const meeting = a.meeting;
  const [members, previous, requester] = await Promise.all([
    projectMembers(meeting.id_project),
    prisma.chatProjectMeetingAnalysis.findMany({
      where: { status: 'listo', meeting: { id_project: meeting.id_project, start_at: { lt: meeting.start_at } } },
      orderBy: { meeting: { start_at: 'desc' } },
      take: 3,
      select: { commitments_json: true, topics_json: true, meeting: { select: { subject: true, start_at: true } } },
    }),
    nameOf(a.requested_by),
  ]);
  const metrics = parseJson<AnalysisMetrics>(a.metrics_json);
  const last = previous[0];
  const topics = [
    ...new Set(
      previous.flatMap((p) => {
        const t = parseJson<{ recurringTopics?: string[]; discussed?: string[] }>(p.topics_json);
        return [...(t?.recurringTopics ?? []), ...(t?.discussed ?? [])];
      })
    ),
  ].slice(0, 10);
  const prompt = buildAnalysisPrompt({
    idAnalysis: a.id_analysis,
    projectName: meeting.project.name,
    subject: meeting.subject,
    when: `${formatDay(meeting.start_at.toISOString())} ${bogotaDate(meeting.start_at)}, ${formatTime(meeting.start_at.toISOString())} (hora de Bogotá)`,
    scheduledMinutes: meeting.scheduled_minutes,
    actualMinutes: metrics?.actualMinutes ?? meeting.actual_minutes,
    startDelayMinutes: metrics?.startDelayMinutes ?? meeting.start_delay_minutes,
    attendeesCount: meeting.attendees_count,
    attendedCount: metrics?.attendedCount ?? meeting.attended_count,
    requestedBy: requester,
    lines,
    participation: metrics?.participation ?? participationFromLines(lines),
    members,
    previous: last ? { subject: last.meeting.subject, date: bogotaDate(last.meeting.start_at), commitments: parseJson<Commitment[]>(last.commitments_json) ?? [] } : null,
    previousTopics: topics,
  });
  return { body: `${m.body}\n\n${prompt}`.slice(0, MAX_TRANSCRIPT_CHARS + 20_000) };
}

/* ───────────────────────────── Agent answer ───────────────────────────── */

/**
 * The agent published in a project conversation. If it is the FINAL answer (state idle) of a pending
 * analysis of this agent in this conversation, store it. Never throws to the caller's detriment: the
 * publish route wraps it.
 */
export async function onAgentPublishedAnalysis(p: {
  idConversation: number;
  idAgent: number;
  idMessage: number;
  body: string;
  state: string;
}): Promise<{ handled: boolean; visibleBody?: string }> {
  if (p.state !== 'idle') return { handled: false };
  const a = await prisma.chatProjectMeetingAnalysis.findFirst({
    where: { id_conversation: p.idConversation, id_agent: p.idAgent, status: 'analizando' },
    orderBy: { id_analysis: 'desc' },
    include: { meeting: true },
  });
  if (!a) return { handled: false };
  const now = new Date();
  const parsed = parseAnalysisReply(p.body);
  if (!parsed.ok) {
    await prisma.chatProjectMeetingAnalysis.updateMany({
      where: { id_analysis: a.id_analysis, status: 'analizando' },
      data: { status: 'fallido', error: parsed.error.slice(0, 500), finished_at: now },
    });
    forgetTranscript(a.id_analysis);
    return { handled: true };
  }
  const result: MeetingAnalysisResult = parsed.value.analysis;
  const date = bogotaDate(a.meeting.start_at);

  let proposals: number[] = [];
  if (result.commitments.length > 0) {
    try {
      const items = commitmentsToProposals(result.commitments, { subject: a.meeting.subject, meetingDate: date, idAnalysis: a.id_analysis }, await projectMembers(a.meeting.id_project));
      const r = await crearPropuestasDelPuente({ id: p.idConversation, idProject: a.meeting.id_project }, p.idAgent, items);
      proposals = r.creadas;
      if (r.rechazadas.length > 0) console.warn('[meetings/analysis] rejected proposals:', JSON.stringify(r.rechazadas).slice(0, 500));
    } catch (err) {
      console.error('[meetings/analysis] proposals:', err instanceof Error ? err.message : err);
    }
  }

  const saved = await prisma.chatProjectMeetingAnalysis.updateMany({
    where: { id_analysis: a.id_analysis, status: 'analizando' },
    data: {
      status: 'listo',
      score: result.score,
      summary: result.summary,
      decisions_json: JSON.stringify(result.decisions),
      commitments_json: JSON.stringify(result.commitments),
      topics_json: JSON.stringify({ discussed: result.discussed, recurringTopics: result.recurringTopics, agendaRespected: result.agendaRespected, agendaNote: result.agendaNote }),
      recommendations_json: JSON.stringify(result.recommendations),
      followup_json: JSON.stringify(result.followup),
      proposals_json: JSON.stringify(proposals),
      could_be_email: result.couldBeEmail,
      error: null,
      finished_at: now,
    },
  });
  forgetTranscript(a.id_analysis);
  if (saved.count === 0) return { handled: true };

  // The thread shows a readable text, never the raw JSON.
  const visible = renderAnalysisMarkdown(result, { subject: a.meeting.subject, date, proposals: proposals.length, rest: parsed.value.rest }).slice(0, MAX_AGENT_MESSAGE_CHARS);
  await prisma.chatMessage.update({ where: { id: p.idMessage }, data: { body: visible } }).catch(() => null);
  await registrarEvento(prisma, {
    idProject: a.meeting.id_project,
    entity: 'reunion',
    idEntity: a.id_project_meeting,
    action: 'analisis_listo',
    detail: `Análisis #${a.id_analysis} de la reunión ${a.meeting.subject.slice(0, 200)} listo: efectividad ${result.score}/100, ${result.decisions.length} decisiones, ${result.commitments.length} compromisos (${proposals.length} propuestas de tarea).`,
    idUser: null,
    idAgent: p.idAgent,
    via: 'puente',
  }).catch(() => null);
  return { handled: true, visibleBody: visible };
}

/* ───────────────────────────── Reading ───────────────────────────── */

/** Did the viewer attend? (the meeting is in their own calendar). Never throws. */
async function viewerAttended(user: ProjectUser, link: { ical_uid: string; start_at: Date; end_at: Date; linked_by: string }, requestedBy: string | null): Promise<boolean> {
  if (link.linked_by === user.id || requestedBy === user.id) return true;
  if (!meetingsEnabledFor(user.email)) return false;
  try {
    return (await findOwnOccurrence(user.email.toLowerCase(), link.ical_uid, link.start_at.toISOString(), link.end_at.toISOString())) !== null;
  } catch {
    return false;
  }
}

/** Latest analysis of a project meeting, filtered by who asks (participation by person only for attendees). */
export async function getAnalysis(user: ProjectUser, project: ProjectAccess, linkId: number): Promise<MeetingAnalysisDto | null> {
  const link = await prisma.chatProjectMeeting.findFirst({ where: { id_project_meeting: linkId, id_project: project.idProject } });
  if (!link) throw new MeetingLinkError('Reunión no encontrada en el proyecto.', 404);
  await sweepProjectAnalyses(project.idProject);
  const a = await prisma.chatProjectMeetingAnalysis.findFirst({ where: { id_project_meeting: linkId }, orderBy: { id_analysis: 'desc' } });
  const attended = await viewerAttended(user, link, a?.requested_by ?? null);
  const canRequest = !project.archived && capabilitiesFor(project.role).write && meetingsEnabledFor(user.email) && attended;
  if (!a) return null;
  const [agent, requester, proposals] = await Promise.all([
    prisma.agent.findUnique({ where: { id_agent: a.id_agent }, select: { id_agent: true, display_name: true, code: true } }),
    nameOf(a.requested_by),
    (async () => {
      const ids = (parseJson<unknown[]>(a.proposals_json) ?? []).filter((x): x is number => typeof x === 'number');
      if (ids.length === 0) return [];
      const rows = await prisma.chatProjectProposal.findMany({ where: { id_proposal: { in: ids }, id_project: project.idProject }, select: { id_proposal: true, status: true, summary: true } });
      return rows.map((r) => ({ id: r.id_proposal, status: r.status, summary: r.summary }));
    })(),
  ]);
  const metrics = parseJson<AnalysisMetrics>(a.metrics_json);
  if (metrics && !attended) delete metrics.participation;
  const topics = parseJson<{ discussed?: string[]; recurringTopics?: string[]; agendaRespected?: boolean | null; agendaNote?: string | null }>(a.topics_json);
  const result: MeetingAnalysisResult | null =
    a.status === 'listo' && a.summary !== null && a.score !== null
      ? {
          score: a.score,
          summary: a.summary,
          decisions: parseJson<string[]>(a.decisions_json) ?? [],
          discussed: topics?.discussed ?? [],
          commitments: parseJson<Commitment[]>(a.commitments_json) ?? [],
          agendaRespected: topics?.agendaRespected ?? null,
          agendaNote: topics?.agendaNote ?? null,
          couldBeEmail: a.could_be_email === true,
          couldBeEmailReason: null,
          recurringTopics: topics?.recurringTopics ?? [],
          followup: parseJson<MeetingAnalysisResult['followup']>(a.followup_json) ?? [],
          recommendations: parseJson<string[]>(a.recommendations_json) ?? [],
        }
      : null;
  return {
    id: a.id_analysis,
    status: a.status as MeetingAnalysisDto['status'],
    agent: agent ? { idAgent: agent.id_agent, displayName: agent.display_name, code: agent.code } : null,
    requestedBy: requester,
    createdAt: a.created_at.toISOString(),
    finishedAt: a.finished_at?.toISOString() ?? null,
    error: a.error,
    result,
    metrics,
    proposals,
    viewerAttended: attended,
    canRequest,
  };
}

/** Transcript for an ATTENDEE member, read live from Teams with their own mailbox (never stored). */
export async function transcriptForMember(user: ProjectUser, project: ProjectAccess, linkId: number) {
  const link = await prisma.chatProjectMeeting.findFirst({ where: { id_project_meeting: linkId, id_project: project.idProject } });
  if (!link) throw new MeetingLinkError('Reunión no encontrada en el proyecto.', 404);
  const email = user.email.toLowerCase();
  if (!meetingsEnabledFor(email)) throw new MeetingLinkError('La transcripción solo la ven quienes asistieron (y tienen el módulo de reuniones habilitado).', 403);
  const own = await findOwnOccurrence(email, link.ical_uid, link.start_at.toISOString(), link.end_at.toISOString());
  if (!own) throw new MeetingLinkError('La transcripción solo la ven quienes asistieron a la reunión.', 403);
  try {
    const t = await meetingTranscript(email, own.id);
    return { available: t.available, reason: t.reason ?? null, lines: t.lines, participation: participationFromLines(t.lines) };
  } catch (err) {
    if (err instanceof MeetingsGraphError) throw new MeetingLinkError(err.message, err.status);
    throw err;
  }
}
