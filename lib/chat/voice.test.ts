import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const guard = vi.hoisted(() => vi.fn());
const findMany = vi.hoisted(() => vi.fn());
vi.mock('./http', () => ({
  guardConversation: guard,
  NO_STORE: { 'Cache-Control': 'no-store' },
  jsonNoStore: (data: unknown, init?: ResponseInit) => Response.json(data, init),
}));
vi.mock('../prisma', () => ({ prisma: { chatMessage: { findMany } } }));
import { POST } from '../../app/api/chat/conversations/[id]/voice/route';

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'test-only-placeholder');
  guard.mockResolvedValue({ kind: 'direct', user: { id: crypto.randomUUID() }, conversationId: 47 });
  findMany.mockResolvedValue([]);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const call = (body = 'v=0\r\n', origin = 'https://synerlink.test') => POST(new Request('https://synerlink.test/api/chat/conversations/47/voice', {
  method: 'POST', headers: { origin, 'Content-Type': 'application/sdp' }, body,
}), { params: Promise.resolve({ id: '47' }) });

it('denies an inaccessible conversation before contacting OpenAI', async () => {
  guard.mockResolvedValue({ response: new Response(null, { status: 404 }) });
  expect((await call()).status).toBe(404);
  expect(findMany).not.toHaveBeenCalled();
});
it('rejects cross-origin calls', async () => { expect((await call('v=0', 'https://other.test')).status).toBe(403); });
it('fails clearly when credentials are absent', async () => {
  vi.stubEnv('OPENAI_API_KEY', ''); expect((await call()).status).toBe(503);
});
it('rejects oversized offers', async () => { expect((await call('v=0' + 'a'.repeat(64_000))).status).toBe(413); });
it('passes only SDP back and scopes history to the authorized conversation', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('v=0\r\nanswer'));
  vi.stubGlobal('fetch', fetcher);
  const response = await call();
  expect(await response.text()).toBe('v=0\r\nanswer');
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id_conversation: 47 } }));
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('does not return upstream error bodies or credentials', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private upstream error', { status: 401 })));
  const response = await call();
  expect(response.status).toBe(502);
  expect(await response.text()).not.toContain('private');
});
