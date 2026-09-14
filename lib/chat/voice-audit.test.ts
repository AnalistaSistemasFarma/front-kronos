import { beforeEach, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({
  chatVoiceCall: { findUnique: vi.fn(), create: vi.fn() },
  chatConversation: { findFirst: vi.fn(), updateMany: vi.fn() },
  chatMessage: { create: vi.fn() }, chatVoiceEvent: { findUnique: vi.fn(), create: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../prisma', () => ({ prisma: db }));
import { parseVoiceTranscript, saveVoiceTranscript } from './voice-audit';
const event = { eventId: 'voice-1:7', role: 'user' as const, text: 'Consulta por voz', timestamp: new Date().toISOString() };
beforeEach(() => {
  vi.clearAllMocks();
  db.chatVoiceCall.findUnique.mockResolvedValue({ id: 'call-1', id_agent: 2, id_conversation: 13,
    id_user: 'operator', client_ip: '192.0.2.5', user_agent: 'Browser',
    created_at: new Date(Date.now() - 1000), expires_at: new Date(Date.now() + 60_000) });
  db.chatConversation.findFirst.mockResolvedValue({ id: 13 });
  db.chatVoiceEvent.findUnique.mockResolvedValue(null);
  db.chatMessage.create.mockResolvedValue({ id: 123 });
  db.$transaction.mockImplementation(fn => fn(db));
});
it('validates text, role, timestamp and bounded event identifiers', () => {
  expect(parseVoiceTranscript(event)).toEqual(event);
  for (const patch of [{ role: 'system' }, { text: ' ' }, { text: 'a'.repeat(40001) }, { eventId: '../file' }, { timestamp: 'invalid' }]) {
    expect(parseVoiceTranscript({ ...event, ...patch })).toBeNull();
  }
});
it('rejects another agent or a changed conversation owner before writing', async () => {
  expect(await saveVoiceTranscript(99, 'call-1', event)).toBeNull();
  db.chatConversation.findFirst.mockResolvedValue(null);
  expect(await saveVoiceTranscript(2, 'call-1', event)).toBeNull();
  expect(db.chatMessage.create).not.toHaveBeenCalled();
});
it('uses server-bound identity and prevents a second text-agent execution', async () => {
  await saveVoiceTranscript(2, 'call-1', event);
  expect(db.chatMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    id_conversation: 13, id_user_author: 'operator', id_agent_author: null,
    client_ip: '192.0.2.5', user_agent: 'Browser', role: 'user', delivered_at: new Date(event.timestamp),
  }) }));
  expect(db.chatVoiceEvent.create).toHaveBeenCalled();
});
it('records spoken assistant as agent, without inventing a human author or IP', async () => {
  await saveVoiceTranscript(2, 'call-1', { ...event, role: 'assistant' });
  expect(db.chatMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    role: 'agent', id_agent_author: 2, id_user_author: null, client_ip: null, user_agent: null,
  }) }));
});
it('acknowledges durable duplicate without inserting another message', async () => {
  db.chatVoiceEvent.findUnique.mockResolvedValue({ id_message: 101 });
  expect(await saveVoiceTranscript(2, 'call-1', event)).toEqual({ id: 101, duplicate: true });
  expect(db.$transaction).not.toHaveBeenCalled();
});
it('permits delayed retry of an in-call event but rejects out-of-call timestamps', async () => {
  const prior = new Date(Date.now() - 3600_000);
  db.chatVoiceCall.findUnique.mockResolvedValue({ id_agent: 2, id_conversation: 13, id_user: 'operator',
    created_at: prior, expires_at: new Date(prior.getTime() + 600_000) });
  expect(await saveVoiceTranscript(2, 'call-1', { ...event, timestamp: new Date(prior.getTime() + 10_000).toISOString() })).toEqual({ id: 123, duplicate: false });
  expect(await saveVoiceTranscript(2, 'call-1', event)).toBeNull();
});

it('tolerates measured Gateway/Windows clock skew without accepting arbitrary future events', async () => {
  expect(await saveVoiceTranscript(2, 'call-1', { ...event, timestamp: new Date(Date.now() + 45_000).toISOString() })).toEqual({ id: 123, duplicate: false });
  expect(await saveVoiceTranscript(2, 'call-1', { ...event, timestamp: new Date(Date.now() + 180_000).toISOString() })).toBeNull();
});
