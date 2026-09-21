import { expect, it, vi, beforeEach } from 'vitest';
const rows = vi.hoisted(() => new Map<string, any>());
vi.mock('../prisma', () => ({ prisma: { chatVoiceCall: {
  count: vi.fn(async ({ where }: any) => [...rows.values()].filter((r: any) => r.expires_at > new Date() && (!where.id_user || r.id_user === where.id_user)).length),
  create: vi.fn(async ({ data }: any) => { rows.set(data.id, { ...data, claimed: false, answer_sdp: null, error: null }); return data; }),
  findFirst: vi.fn(async ({ where }: any) => [...rows.values()].find((r: any) => r.id === where.id && r.id_user === where.id_user && r.id_conversation === where.id_conversation && r.expires_at > new Date()) ?? null),
  findMany: vi.fn(async ({ where }: any) => [...rows.values()].filter((r: any) => r.id_agent === where.id_agent && r.expires_at > new Date())),
  update: vi.fn(async ({ where, data }: any) => { const row = rows.get(where.id); Object.assign(row, data); return row; }),
  updateMany: vi.fn(async ({ where, data }: any) => { for (const row of rows.values()) if (where.id.in.includes(row.id) && row.claimed === false) Object.assign(row, data); return { count: 1 }; }),
  delete: vi.fn(async ({ where }: any) => { rows.delete(where.id); }),
} } }));
import { answerVoiceCall, closeVoiceCall, createVoiceCall, getVoiceCall, pollVoiceCalls, touchVoiceCall } from './voice-broker';
beforeEach(() => rows.clear());
it('shares negotiation state through the durable broker', async () => {
  const id = await createVoiceCall(501, 47, 'pilot-a', 'v=0');
  expect(await getVoiceCall(id!, 'other', 47)).toBeNull();
  expect((await pollVoiceCalls(502)).offers).toEqual([]);
  expect(await answerVoiceCall(502, id!, 'v=0 answer')).toBe(false);
  expect((await pollVoiceCalls(501)).offers).toHaveLength(1);
  expect(await answerVoiceCall(501, id!, 'v=0 answer')).toBe(true);
  expect((await getVoiceCall(id!, 'pilot-a', 47))?.answer_sdp).toBe('v=0 answer');
  await closeVoiceCall(id!, 'pilot-a', 47);
  expect(await getVoiceCall(id!, 'pilot-a', 47)).toBeNull();
});
it('refreshes expiry while the browser polls', async () => {
  const id = await createVoiceCall(501, 47, 'pilot-b', 'v=0');
  const before = (await getVoiceCall(id!, 'pilot-b', 47))!.expires_at;
  await new Promise(resolve => setTimeout(resolve, 2));
  const after = await touchVoiceCall(id!, 'pilot-b', 47);
  expect(after!.expires_at.getTime()).toBeGreaterThanOrEqual(before.getTime());
});
