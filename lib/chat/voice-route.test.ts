import { expect, it, vi, beforeEach } from 'vitest';
const guard = vi.hoisted(() => vi.fn());
const agent = vi.hoisted(() => vi.fn());
const auditCall = vi.hoisted(() => vi.fn());
vi.mock('./http', () => ({ guardConversation: guard, jsonNoStore: (data: unknown, init?: ResponseInit) => Response.json(data, init) }));
vi.mock('../prisma', () => ({ prisma: { agent: { findUnique: agent }, chatVoiceCall: { create: auditCall } } }));
import { POST } from '../../app/api/chat/conversations/[id]/voice/route';
beforeEach(() => {
  vi.stubEnv('NEXTAUTH_URL', 'https://test.example');
  guard.mockResolvedValue({ kind: 'direct', user: { id: 'operator', email: 'nicolas.rivera@gsslatam.com' }, idAgent: 1, conversationId: 47 });
  agent.mockResolvedValue({ code: 'duo' });
  auditCall.mockResolvedValue({});
});
const call = (body: string, origin = 'https://test.example') => POST(new Request('https://test.example/api/chat/conversations/47/voice', { method: 'POST', headers: { origin }, body }), { params: Promise.resolve({ id: '47' }) });
it('preserves conversation access denial', async () => {
  guard.mockResolvedValue({ response: new Response(null, { status: 404 }) });
  expect((await call('{}')).status).toBe(404);
});
it('does not grant another user operator tool authority', async () => {
  guard.mockResolvedValue({ kind: 'direct', user: { email: 'other@example.com' } });
  expect((await call('{}')).status).toBe(403);
});
it('rejects foreign origins', async () => { expect((await call('{}', 'https://evil.example')).status).toBe(403); });
it('bounds chunked request size', async () => { expect((await call('a'.repeat(64_001))).status).toBe(413); });
it('rejects malformed and null JSON', async () => {
  expect((await call('[')).status).toBe(400);
  expect((await call('null')).status).toBe(400);
});

it('captures authenticated call identity and the browser origin for auditing', async () => {
  const response = await POST(new Request('https://test.example/api/chat/conversations/47/voice', {
    method: 'POST', headers: { origin: 'https://test.example', 'x-forwarded-for': '192.0.2.10:50', 'user-agent': 'Test Browser' },
    body: JSON.stringify({ action: 'offer', sdp: 'v=0', id_user: 'impostor' }),
  }), { params: Promise.resolve({ id: '47' }) });
  expect(response.status).toBe(200);
  expect(auditCall).toHaveBeenCalledWith({ data: expect.objectContaining({ id_user: 'operator',
    id_agent: 1, id_conversation: 47, client_ip: '192.0.2.10', user_agent: 'Test Browser' }) });
  const { callId } = await response.json();
  await call(JSON.stringify({ action: 'close', callId }));
});
it('fails closed if durable audit cannot be initialized', async () => {
  auditCall.mockRejectedValue(new Error('DB offline'));
  expect((await call(JSON.stringify({ action: 'offer', sdp: 'v=0' }))).status).toBe(503);
  auditCall.mockResolvedValue({});
  const response = await call(JSON.stringify({ action: 'offer', sdp: 'v=0' }));
  expect(response.status).toBe(200);
  const { callId } = await response.json();
  await call(JSON.stringify({ action: 'close', callId }));
});
