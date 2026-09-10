import { expect, it, vi, beforeEach } from 'vitest';
const guard = vi.hoisted(() => vi.fn());
const agent = vi.hoisted(() => vi.fn());
vi.mock('./http', () => ({ guardConversation: guard, jsonNoStore: (data: unknown, init?: ResponseInit) => Response.json(data, init) }));
vi.mock('../prisma', () => ({ prisma: { agent: { findUnique: agent } } }));
import { POST } from '../../app/api/chat/conversations/[id]/voice/route';
beforeEach(() => {
  guard.mockResolvedValue({ kind: 'direct', user: { id: 'operator', email: 'nicolas.rivera@gsslatam.com' }, idAgent: 1, conversationId: 47 });
  agent.mockResolvedValue({ code: 'duo' });
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
