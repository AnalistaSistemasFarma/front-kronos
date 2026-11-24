import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * On-demand analysis of a project meeting (2026-11-24): who can ask for it, what the agent receives
 * (the transcript travels only in its inbox) and how its answer is stored (proposals + readable text).
 */
const h = vi.hoisted(() => {
  const db = {
    chatProjectMeeting: { findFirst: vi.fn(), update: vi.fn() },
    chatProjectMeetingAnalysis: { count: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    chatMessage: { create: vi.fn(), update: vi.fn() },
    chatConversation: { update: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    chatProjectMember: { findMany: vi.fn() },
    chatProject: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    chatAgentTurnUsage: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return {
    db,
    enabled: vi.fn(),
    own: vi.fn(),
    transcript: vi.fn(),
    actuals: vi.fn(),
    write: vi.fn(),
    conv: vi.fn(),
    proposals: vi.fn(),
    event: vi.fn(),
  };
});

vi.mock('../../prisma', () => ({ prisma: h.db }));
vi.mock('../config', () => ({ meetingsEnabledFor: h.enabled }));
vi.mock('../service', () => ({ findOwnOccurrence: h.own, meetingTranscript: h.transcript, occurrenceActuals: h.actuals }));
vi.mock('../../chat/projects', () => ({ writeAccessForAgent: h.write }));
vi.mock('../../proyectos/acciones', () => ({ crearConversacionProyecto: h.conv, errorDeProyecto: () => null }));
vi.mock('../../proyectos/cronograma', () => ({ registrarEvento: h.event }));
vi.mock('../../proyectos/propuestas', () => ({ crearPropuestasDelPuente: h.proposals }));

import { analysisTurnForAgent, onAgentPublishedAnalysis, requestAnalysis } from '../projects/analysis';

const user = { id: 'u-ana', email: 'ana@gsslatam.com' };
const project = { idProject: 32, name: 'Validación SGC', idCompany: 8, profile: 'x', role: 'editor' as const, archived: false };
const link = {
  id_project_meeting: 5,
  id_project: 32,
  ical_uid: 'ical-1',
  subject: 'Seguimiento semanal SGC',
  start_at: new Date('2026-11-23T14:00:00Z'),
  end_at: new Date('2026-11-23T15:00:00Z'),
  scheduled_minutes: 60,
  actual_minutes: null,
  start_delay_minutes: null,
  attendees_count: 3,
  attended_count: null,
  linked_by: 'u-bob',
};
const lines = [
  { at: '00:00:05', speaker: 'Ana', text: 'Secreto de la reunión: decidimos salir el viernes.' },
  { at: '00:01:00', speaker: 'Bob', text: 'Yo envío la propuesta el viernes.' },
];

beforeEach(() => {
  vi.clearAllMocks();
  h.db.$transaction.mockImplementation((fn: (t: typeof h.db) => unknown) => fn(h.db));
  h.enabled.mockReturnValue(true);
  h.db.chatProjectMeeting.findFirst.mockResolvedValue(link);
  h.db.chatProjectMeetingAnalysis.count.mockResolvedValue(0);
  h.db.chatProjectMeetingAnalysis.updateMany.mockResolvedValue({ count: 1 });
  h.db.chatProjectMeetingAnalysis.findMany.mockResolvedValue([]);
  h.db.chatProjectMeetingAnalysis.create.mockResolvedValue({ id_analysis: 77 });
  h.db.chatMessage.create.mockResolvedValue({ id: 900 });
  h.db.chatMessage.update.mockResolvedValue({});
  h.db.chatProjectMeeting.update.mockResolvedValue({});
  h.event.mockResolvedValue(undefined);
  h.own.mockResolvedValue({ id: 'evt-ana' });
  h.transcript.mockResolvedValue({ available: true, lines, meeting: {} });
  h.actuals.mockResolvedValue({ actualMinutes: 70, startDelayMinutes: 3, overrunMinutes: 10, participants: 3 });
  h.db.chatProject.findUnique.mockResolvedValue({ id_agent: 1, agents: [{ agent: { id_agent: 1, code: 'horus', display_name: 'Orus' } }] });
  h.write.mockResolvedValue({ ok: true });
  h.conv.mockResolvedValue({ idConversation: 400 });
  h.db.user.findUnique.mockResolvedValue({ name: 'Ana', email: 'ana@gsslatam.com' });
  h.db.chatProjectMember.findMany.mockResolvedValue([{ user: { name: 'Bob', email: 'bob@gsslatam.com', isActive: true } }]);
  h.proposals.mockResolvedValue({ creadas: [11], rechazadas: [] });
});

describe('requestAnalysis', () => {
  it('a reader cannot ask', async () => {
    await expect(requestAnalysis(user, { ...project, role: 'reader' }, 5)).rejects.toMatchObject({ status: 403 });
  });
  it('without the meetings module, no', async () => {
    h.enabled.mockReturnValue(false);
    await expect(requestAnalysis(user, project, 5)).rejects.toMatchObject({ status: 403 });
  });
  it('only an attendee (the meeting is in HER calendar)', async () => {
    h.own.mockResolvedValue(null);
    await expect(requestAnalysis(user, project, 5)).rejects.toMatchObject({ status: 403, message: expect.stringContaining('asistieron') });
    expect(h.own).toHaveBeenCalledWith('ana@gsslatam.com', 'ical-1', link.start_at.toISOString(), link.end_at.toISOString());
  });
  it('one at a time, and a daily cap', async () => {
    h.db.chatProjectMeetingAnalysis.count.mockResolvedValueOnce(1);
    await expect(requestAnalysis(user, project, 5)).rejects.toMatchObject({ status: 409 });
    h.db.chatProjectMeetingAnalysis.count.mockResolvedValueOnce(0).mockResolvedValueOnce(10);
    await expect(requestAnalysis(user, project, 5)).rejects.toMatchObject({ status: 429 });
  });
  it('no transcript, nothing to analyze', async () => {
    h.transcript.mockResolvedValue({ available: false, reason: 'La reunión no se transcribió.', lines: [] });
    await expect(requestAnalysis(user, project, 5)).rejects.toMatchObject({ status: 409, message: 'La reunión no se transcribió.' });
  });
  it('the person must be able to write to the agent', async () => {
    h.write.mockResolvedValue({ ok: false, motivo: 'Usted no tiene este asistente asignado en la empresa del proyecto.' });
    await expect(requestAnalysis(user, project, 5)).rejects.toMatchObject({ status: 403, message: expect.stringContaining('asignado') });
  });
  it('opens a project thread with the agent and leaves a SYSTEM notice delivered only to it — never the transcript', async () => {
    const r = await requestAnalysis(user, project, 5);
    expect(r).toEqual({ id: 77, status: 'analizando', agentName: 'Orus' });
    expect(h.conv).toHaveBeenCalledWith(user, project, { agentCode: 'horus', title: 'Análisis de reunión · Seguimiento semanal SGC' });
    const msg = h.db.chatMessage.create.mock.calls[0][0].data;
    expect(msg.role).toBe('system');
    expect(msg.deliveries).toEqual({ create: [{ id_agent: 1 }] });
    expect(msg.body).not.toContain('Secreto');
    const created = h.db.chatProjectMeetingAnalysis.create.mock.calls[0][0].data;
    expect(created).toMatchObject({ status: 'analizando', mailbox: 'ana@gsslatam.com', event_id: 'evt-ana', id_agent: 1, id_conversation: 400 });
    expect(JSON.stringify(created)).not.toContain('Secreto');
  });
});

describe('analysisTurnForAgent (inbox)', () => {
  it('not an analysis request of this agent → null', async () => {
    h.db.chatProjectMeetingAnalysis.findFirst.mockResolvedValue(null);
    expect(await analysisTurnForAgent({ id: 900, role: 'system', body: 'x' }, 2)).toBeNull();
    expect(await analysisTurnForAgent({ id: 900, role: 'user', body: 'x' }, 1)).toBeNull();
  });
  it('the agent receives the instructions and the transcript (read live with the requester mailbox)', async () => {
    h.db.chatProjectMeetingAnalysis.findFirst.mockResolvedValue({
      id_analysis: 78,
      status: 'analizando',
      mailbox: 'ana@gsslatam.com',
      event_id: 'evt-ana',
      requested_by: 'u-ana',
      metrics_json: null,
      meeting: { ...link, project: { id_project: 32, name: 'Validación SGC' } },
    });
    const t = await analysisTurnForAgent({ id: 901, role: 'system', body: '📋 Aviso' }, 1);
    expect(h.transcript).toHaveBeenCalledWith('ana@gsslatam.com', 'evt-ana');
    expect(t?.body).toContain('📋 Aviso');
    expect(t?.body).toContain('[00:00:05] Ana: Secreto de la reunión');
    expect(t?.body).toContain('```analisis-reunion');
  });
});

describe('onAgentPublishedAnalysis', () => {
  const pending = { id_analysis: 77, id_project_meeting: 5, status: 'analizando', meeting: link };
  const answer = `\`\`\`analisis-reunion\n${JSON.stringify({
    score: 64,
    summary: 'Se decidió salir el viernes.',
    decisions: ['Salir el viernes'],
    commitments: [{ task: 'Enviar la propuesta', owner: 'bob@gsslatam.com', dueDate: '2026-11-28' }],
    recommendations: ['Agenda previa', 'Cerrar a tiempo', 'Menos estado'],
  })}\n\`\`\`\nListo.`;

  it('progress notices (state thinking) are ignored', async () => {
    expect(await onAgentPublishedAnalysis({ idConversation: 400, idAgent: 1, idMessage: 1, body: '⏳ Sigo trabajando', state: 'thinking' })).toEqual({ handled: false });
    expect(h.db.chatProjectMeetingAnalysis.findFirst).not.toHaveBeenCalled();
  });
  it('a final answer without the block fails the analysis with a clear reason', async () => {
    h.db.chatProjectMeetingAnalysis.findFirst.mockResolvedValue(pending);
    await onAgentPublishedAnalysis({ idConversation: 400, idAgent: 1, idMessage: 1, body: 'No pude.', state: 'idle' });
    expect(h.db.chatProjectMeetingAnalysis.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'fallido' });
  });
  it('stores the result, turns commitments into PROPOSALS and leaves readable text in the thread', async () => {
    h.db.chatProjectMeetingAnalysis.findFirst.mockResolvedValue(pending);
    const r = await onAgentPublishedAnalysis({ idConversation: 400, idAgent: 1, idMessage: 555, body: answer, state: 'idle' });
    expect(r.handled).toBe(true);
    const [conv, idAgent, items] = h.proposals.mock.calls[0];
    expect(conv).toEqual({ id: 400, idProject: 32 });
    expect(idAgent).toBe(1);
    expect(items[0]).toMatchObject({ kind: 'tarea_crear', tarea: { title: 'Enviar la propuesta', responsable: 'bob@gsslatam.com', startDate: '2026-11-23', endDate: '2026-11-28' } });
    const saved = h.db.chatProjectMeetingAnalysis.updateMany.mock.calls[0][0].data;
    expect(saved).toMatchObject({ status: 'listo', score: 64, proposals_json: '[11]' });
    const visible = h.db.chatMessage.update.mock.calls[0][0].data.body as string;
    expect(visible).toContain('Efectividad 64/100');
    expect(visible).not.toContain('```');
    expect(r.visibleBody).toBe(visible);
  });
});
