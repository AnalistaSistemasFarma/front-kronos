import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Assigning a meeting to a project (2026-11-24): only from the SESSION calendar, never a private
 * meeting, one meeting → one project, and the series rule.
 */
const h = vi.hoisted(() => {
  const db = {
    chatProjectMeeting: { findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    chatProjectMeetingRule: { upsert: vi.fn(), findMany: vi.fn() },
    chatProjectMember: { count: vi.fn() },
    chatProject: { update: vi.fn() },
    $transaction: vi.fn(),
  };
  return { db, enabled: vi.fn(), readEvent: vi.fn(), actuals: vi.fn(), withEvents: vi.fn(), event: vi.fn() };
});

vi.mock('../../prisma', () => ({ prisma: h.db }));
vi.mock('../config', () => ({ meetingsEnabledFor: h.enabled }));
vi.mock('../service', () => ({ readEvent: h.readEvent, occurrenceActuals: h.actuals, meetingsWithEvents: h.withEvents }));
vi.mock('../../chat/projects', () => ({ projectModuleCompanies: vi.fn() }));
vi.mock('../../proyectos/cronograma', () => ({ registrarEvento: h.event }));

import { MeetingsGraphError } from '../graph';
import { linkMeeting, meetingErrorResponse } from '../projects/links';
import type { GraphMeetingEvent } from '../metrics';

const user = { id: 'u-ana', email: 'Ana@gsslatam.com' };
const project = { idProject: 32, name: 'Validación SGC', idCompany: 8, profile: 'x', role: 'editor' as const, archived: false };
const ev = (over: Partial<GraphMeetingEvent> = {}): GraphMeetingEvent => ({
  id: 'evt-1',
  iCalUId: 'ical-1',
  subject: 'Seguimiento semanal SGC',
  start: { dateTime: '2026-11-23T14:00:00.0000000' },
  end: { dateTime: '2026-11-23T15:00:00.0000000' },
  isOnlineMeeting: true,
  onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/x' },
  organizer: { emailAddress: { name: 'Ana', address: 'ana@gsslatam.com' } },
  attendees: [{ type: 'required', emailAddress: { address: 'bob@gsslatam.com' } }],
  type: 'occurrence',
  seriesMasterId: 'series-1',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.db.$transaction.mockImplementation((fn: (t: typeof h.db) => unknown) => fn(h.db));
  h.enabled.mockReturnValue(true);
  h.readEvent.mockResolvedValue(ev());
  h.actuals.mockResolvedValue({ actualMinutes: 70, startDelayMinutes: 3, participants: 3, hasTranscript: true, available: true });
  h.db.chatProjectMeeting.findUnique.mockResolvedValue(null);
  h.db.chatProjectMeeting.create.mockResolvedValue({ id_project_meeting: 9 });
  h.db.chatProjectMeetingRule.upsert.mockResolvedValue({ id_rule: 4 });
  h.db.chatProjectMeetingRule.findMany.mockResolvedValue([]);
  h.withEvents.mockResolvedValue([]);
  h.event.mockResolvedValue(undefined);
});

const input = { eventId: 'evt-1', applyToSeries: false, origin: 'manual' as const };

describe('linkMeeting', () => {
  it('reads the event from the SESSION mailbox (lower case), never another one', async () => {
    await linkMeeting(user, project, input, 'Resumen');
    expect(h.readEvent).toHaveBeenCalledWith('ana@gsslatam.com', 'evt-1');
    const data = h.db.chatProjectMeeting.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ id_project: 32, ical_uid: 'ical-1', mailbox: 'ana@gsslatam.com', summary: 'Resumen', origin: 'manual', attendees_count: 1, attended_count: 3, has_transcript: true, linked_by: 'u-ana' });
    // Only counts: no attendee list and no transcript.
    expect(JSON.stringify(data)).not.toContain('bob@gsslatam.com');
  });
  it('an id of another calendar → 404', async () => {
    h.readEvent.mockRejectedValue(new MeetingsGraphError('x', 404));
    await expect(linkMeeting(user, project, input, null)).rejects.toMatchObject({ status: 404 });
  });
  it('private or confidential meetings can never be assigned', async () => {
    h.readEvent.mockResolvedValue(ev({ sensitivity: 'private' }));
    await expect(linkMeeting(user, project, input, null)).rejects.toMatchObject({ status: 403 });
    h.readEvent.mockResolvedValue(ev({ sensitivity: 'confidential' }));
    await expect(linkMeeting(user, project, input, null)).rejects.toMatchObject({ status: 403 });
  });
  it('one meeting → one project', async () => {
    h.db.chatProjectMeeting.findUnique.mockResolvedValue({ id_project: 40, project: { name: 'Otro' } });
    h.db.chatProjectMember.count.mockResolvedValue(0);
    await expect(linkMeeting(user, project, input, null)).rejects.toMatchObject({ status: 409, message: 'Esa reunión ya está asignada a otro proyecto.' });
    expect(h.db.chatProjectMeeting.create).not.toHaveBeenCalled();
  });
  it('readers and people without the module cannot assign', async () => {
    await expect(linkMeeting(user, { ...project, role: 'reader' }, input, null)).rejects.toMatchObject({ status: 403 });
    h.enabled.mockReturnValue(false);
    await expect(linkMeeting(user, project, input, null)).rejects.toMatchObject({ status: 403 });
  });
  it('the whole series: creates the rule for (mailbox, series) and marks the origin', async () => {
    const r = await linkMeeting(user, project, { ...input, applyToSeries: true }, null);
    expect(r).toEqual({ id: 9, seriesRule: true });
    expect(h.db.chatProjectMeetingRule.upsert.mock.calls[0][0].where).toEqual({ mailbox_series_key: { mailbox: 'ana@gsslatam.com', series_key: 'series-1' } });
    expect(h.db.chatProjectMeeting.create.mock.calls[0][0].data).toMatchObject({ origin: 'serie', id_rule: 4 });
  });
  it('a single meeting has no series', async () => {
    h.readEvent.mockResolvedValue(ev({ seriesMasterId: null, type: 'singleInstance' }));
    await expect(linkMeeting(user, project, { ...input, applyToSeries: true }, null)).rejects.toMatchObject({ status: 400 });
  });
});

describe('meetingErrorResponse', () => {
  it('missing tables → 503 «no disponible» (code deployed before the DDL)', () => {
    expect(meetingErrorResponse(Object.assign(new Error('x'), { code: 'P2021' }))?.status).toBe(503);
    expect(meetingErrorResponse(new Error("Invalid object name 'dbo.chat_project_meeting'."))?.status).toBe(503);
    expect(meetingErrorResponse(Object.assign(new Error('x'), { code: 'P2002' }))?.status).toBe(409);
    expect(meetingErrorResponse(new Error('other'))).toBeNull();
  });
});
