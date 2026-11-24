import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * POST /api/chat/agent/messages in a PROJECT thread (2026-11-23): the agent's reply is pushed to
 * the project members EXCEPT whoever muted the project. The others are not affected.
 */
const notify = vi.hoisted(() => vi.fn());
const members = vi.hoisted(() => vi.fn());
const mutes = vi.hoisted(() => vi.fn());

vi.mock('../../chat/agent-auth', () => ({
  authenticateAgent: vi.fn().mockResolvedValue({ idAgent: 1, code: 'horus', displayName: 'Orus', avatarUrl: null, scope: 'projects' }),
  resolveAgentConversation: vi.fn().mockResolvedValue({ id: 50, kind: 'project', idProject: 7, projectName: 'P', idAgentPrincipal: 1, esMesa: false }),
}));
vi.mock('../../chat/projects', () => ({ mencionablesParaAgente: vi.fn().mockResolvedValue([]) }));
vi.mock('../../chat/notifyAgentReply', () => ({ notifyAgentReply: notify }));
vi.mock('../mesas', () => ({ alPublicarAgenteEnMesa: vi.fn().mockResolvedValue({ esMesa: false, esSintesis: false }) }));
vi.mock('../../meetings/projects/analysis', () => ({ onAgentPublishedAnalysis: vi.fn().mockResolvedValue({ handled: false }) }));
vi.mock('../../chat/conversations', () => ({ messageInclude: {}, serializeMessage: (x: unknown) => x }));
vi.mock('../../prisma', () => {
  const tx = {
    chatMessage: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), create: vi.fn(async ({ data }) => ({ id: 99, ...data })) },
    chatConversation: { update: vi.fn() },
    chatAgentStatus: { upsert: vi.fn() },
  };
  return {
    prisma: {
      chatMessage: { findFirst: vi.fn() },
      chatProjectMember: { findMany: members },
      chatProjectMute: { findMany: mutes },
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

import { NextRequest } from 'next/server';
import { POST } from '../../../app/api/chat/agent/messages/route';

const publish = () =>
  POST(
    new NextRequest('http://x/api/chat/agent/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idConversation: 50, body: 'Listo, ya quedó.' }),
    })
  );

beforeEach(() => {
  vi.clearAllMocks();
  members.mockResolvedValue([
    { id_user: 'u-ana', user: { email: 'ana@x', isActive: true } },
    { id_user: 'u-bob', user: { email: 'bob@x', isActive: true } },
    { id_user: 'u-cy', user: { email: 'cy@x', isActive: false } },
  ]);
  mutes.mockResolvedValue([]);
});

describe('project push and mute', () => {
  it('nobody muted: every active member', async () => {
    expect((await publish()).status).toBe(201);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0].groupEmails).toEqual(['ana@x', 'bob@x']);
    expect(mutes).toHaveBeenCalledWith({ where: { id_project: 7 }, select: { id_user: true } });
  });

  it('Ana muted the project: only Bob gets the push', async () => {
    mutes.mockResolvedValue([{ id_user: 'u-ana' }]);
    await publish();
    expect(notify.mock.calls[0][0].groupEmails).toEqual(['bob@x']);
  });

  it('the mutes cannot be read: everyone gets it, as before (fail open)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    mutes.mockRejectedValue(new Error('Invalid object name'));
    await publish();
    expect(notify.mock.calls[0][0].groupEmails).toEqual(['ana@x', 'bob@x']);
    err.mockRestore();
  });
});
