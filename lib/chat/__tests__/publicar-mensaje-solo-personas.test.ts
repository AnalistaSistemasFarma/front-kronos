import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Multi-company projects (2026-11-27, msg 41680): a member WITHOUT the
 * conversation's agent assigned writes as a human member. Their message never
 * wakes the agent — not the principal and not a mentioned one — and is born
 * delivered.
 */
const create = vi.hoisted(() => vi.fn());
const updateConv = vi.hoisted(() => vi.fn());
const mencionables = vi.hoisted(() => vi.fn());

vi.mock('../../prisma', () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ chatMessage: { create }, chatConversation: { update: updateConv } })),
    chatProjectMesa: { findUnique: vi.fn(async () => null) },
    chatProject: { findUnique: vi.fn(async () => ({ name: 'P' })) },
    user: { findUnique: vi.fn(async () => ({ name: 'Sandy' })) },
  },
}));
vi.mock('../conversations', () => ({ messageInclude: {} }));
vi.mock('../projects', () => ({ mencionablesDelHilo: mencionables }));
vi.mock('../notifyPeople', () => ({ notifyPeopleMessage: vi.fn() }));

import { publicarMensajeDePersona, type ConversationGuardOk } from '../publicar-mensaje';
import type { WriteAccess } from '../projects';

const PRINCIPAL = { idAgent: 21, code: 'play', displayName: 'Play', handle: 'play' };
const OTRO = { idAgent: 22, code: 'doki', displayName: 'Doki', handle: 'doki' };

function guard(writable: WriteAccess): ConversationGuardOk {
  return {
    user: { id: 'u-sandy', email: 'sandy@gsslatam.com' },
    conversationId: 40,
    kind: 'project',
    idAgent: PRINCIPAL.idAgent,
    idProject: 43,
    projectRole: 'editor',
    projectWritable: writable,
  } as ConversationGuardOk;
}
const datos = (body: string) => ({ body, uploaded: [], clientIp: null, userAgent: null, now: new Date('2026-11-27T20:00:00Z') });

beforeEach(() => {
  vi.clearAllMocks();
  create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 1, created_at: new Date(), ...data }));
  mencionables.mockResolvedValue({ principal: PRINCIPAL, mencionables: [OTRO] });
});

describe('publicarMensajeDePersona — member without the agent (soloPersonas)', () => {
  it('with the agent assigned: the principal is woken as always', async () => {
    const r = await publicarMensajeDePersona(guard({ ok: true }), datos('Hola'));
    expect(r.notifiedAgents).toEqual([PRINCIPAL.idAgent]);
    expect(create.mock.calls[0][0].data).not.toHaveProperty('delivered_at');
  });

  it('without the agent: no agent turn, the message is born delivered', async () => {
    const r = await publicarMensajeDePersona(guard({ ok: true, soloPersonas: true, nota: 'x' }), datos('Hola equipo'));
    expect(r.notifiedAgents).toEqual([]);
    expect(create.mock.calls[0][0].data.delivered_at).toEqual(new Date('2026-11-27T20:00:00Z'));
    expect(create.mock.calls[0][0].data).not.toHaveProperty('deliveries');
  });

  it('without the agent: mentioning the principal or another agent does not wake them either', async () => {
    const r = await publicarMensajeDePersona(guard({ ok: true, soloPersonas: true, nota: 'x' }), datos('@play @doki revisen'));
    expect(r.notifiedAgents).toEqual([]);
    expect(create.mock.calls[0][0].data).not.toHaveProperty('deliveries');
    expect(create.mock.calls[0][0].data.delivered_at).toBeInstanceOf(Date);
  });
});
