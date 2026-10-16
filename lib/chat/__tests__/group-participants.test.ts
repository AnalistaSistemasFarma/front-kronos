import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Integrantes de un grupo (POST/DELETE /api/chat/groups/[id]/participants).
 *
 * Fija la regla de Nicolás del 2026-10-06: "solo el usuario que tiene asignado
 * el agente puede invitarlo al grupo". Cualquier integrante trae SUS agentes;
 * nadie —ni el owner— mete el agente de otro. Las personas siguen siendo cosa
 * del owner.
 */
const guard = vi.hoisted(() => vi.fn());
const agentAccess = vi.hoisted(() => vi.fn());
const findGroup = vi.hoisted(() => vi.fn());
const createParticipant = vi.hoisted(() => vi.fn());
const findParticipant = vi.hoisted(() => vi.fn());
const countParticipants = vi.hoisted(() => vi.fn());
const deleteParticipant = vi.hoisted(() => vi.fn());

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('../../../app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../prisma', () => ({
  prisma: {
    chatConversation: { findUnique: findGroup },
    chatParticipant: {
      create: createParticipant,
      findFirst: findParticipant,
      count: countParticipants,
      delete: deleteParticipant,
    },
    user: { findFirst: vi.fn() },
  },
}));
vi.mock('../access', () => ({
  CHAT_MODULE_URL: '/process/chat',
  getChatAgentAccess: agentAccess,
}));
vi.mock('../conversations', () => ({
  getConversationPayload: vi.fn(async (id: number) => ({ id })),
}));
vi.mock('../http', async (importOriginal) => {
  const real = await importOriginal<typeof import('../http')>();
  return { ...real, guardConversation: guard };
});

import { DELETE, POST } from '../../../app/api/chat/groups/[id]/participants/route';

const EMPRESA = 8;

function comoIntegrante(role: 'owner' | 'member') {
  guard.mockResolvedValue({
    kind: 'group',
    conversationId: 12,
    groupRole: role,
    user: { id: 'u-ana', email: 'ana@gsslatam.com' },
  });
}

/** Ana tiene asignado el agente 20 en la empresa 8; el 9 no es suyo. */
function agentesDeAna() {
  agentAccess.mockImplementation(async (_email: string, idAgent: number) =>
    idAgent === 20
      ? { idAgent: 20, companies: [{ idCompany: EMPRESA, companyName: 'GSS', isPrimary: true }] }
      : null
  );
}

function peticion(body: unknown) {
  return new Request('http://x/api/chat/groups/12/participants', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

const params = { params: Promise.resolve({ id: '12' }) };

beforeEach(() => {
  vi.clearAllMocks();
  agentesDeAna();
  findGroup.mockResolvedValue({
    id_company: EMPRESA,
    participants: [
      { id_user: 'u-dueno', id_agent: null },
      { id_user: 'u-ana', id_agent: null },
      { id_user: null, id_agent: 1 },
    ],
  });
});

describe('POST participants: agregar agentes', () => {
  it('un integrante agrega su propio agente', async () => {
    comoIntegrante('member');
    const res = await POST(peticion({ idAgent: 20 }), params);
    expect(res.status).toBe(201);
    expect(createParticipant).toHaveBeenCalledWith({
      data: { id_conversation: 12, id_agent: 20, role: 'member' },
    });
  });

  it('un integrante NO puede agregar un agente ajeno', async () => {
    comoIntegrante('member');
    const res = await POST(peticion({ idAgent: 9 }), params);
    expect(res.status).toBe(403);
    expect(createParticipant).not.toHaveBeenCalled();
  });

  it('el owner tampoco puede agregar un agente que no tiene asignado', async () => {
    comoIntegrante('owner');
    const res = await POST(peticion({ idAgent: 9 }), params);
    expect(res.status).toBe(403);
    expect(createParticipant).not.toHaveBeenCalled();
  });

  it('no sirve un agente propio pero de OTRA empresa', async () => {
    comoIntegrante('member');
    findGroup.mockResolvedValue({ id_company: 3, participants: [] });
    const res = await POST(peticion({ idAgent: 20 }), params);
    expect(res.status).toBe(403);
    expect(createParticipant).not.toHaveBeenCalled();
  });

  it('un integrante que no es owner NO agrega personas', async () => {
    comoIntegrante('member');
    const res = await POST(peticion({ idUser: 'u-otro' }), params);
    expect(res.status).toBe(403);
    expect(createParticipant).not.toHaveBeenCalled();
  });
});

describe('DELETE participants: sacar agentes', () => {
  function borrar(body: unknown) {
    return new Request('http://x/api/chat/groups/12/participants', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as never;
  }

  beforeEach(() => {
    countParticipants.mockResolvedValue(2);
  });

  it('un integrante saca un agente que él tiene asignado', async () => {
    comoIntegrante('member');
    findParticipant.mockResolvedValue({ id_participant: 77, role: 'member', id_user: null, id_agent: 20 });
    const res = await DELETE(borrar({ idAgent: 20 }), params);
    expect(res.status).toBe(200);
    expect(deleteParticipant).toHaveBeenCalledWith({ where: { id_participant: 77 } });
  });

  it('un integrante NO saca un agente ajeno', async () => {
    comoIntegrante('member');
    const res = await DELETE(borrar({ idAgent: 9 }), params);
    expect(res.status).toBe(403);
    expect(deleteParticipant).not.toHaveBeenCalled();
  });

  it('un integrante NO saca personas', async () => {
    comoIntegrante('member');
    const res = await DELETE(borrar({ idUser: 'u-dueno' }), params);
    expect(res.status).toBe(403);
    expect(deleteParticipant).not.toHaveBeenCalled();
  });
});
