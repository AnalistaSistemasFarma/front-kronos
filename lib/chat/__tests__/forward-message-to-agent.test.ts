import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * /api/chat/conversations/<id>/messages/<messageId>/reenviar — forwarding a
 * message to an AGENT (2026-11-18). What is tested:
 *   - GET lists the user's assigned agents (with or without a direct thread),
 *     skipping the origin thread;
 *   - POST { idAgent } without the agent assigned → 403 and nothing is created;
 *   - POST { idAgent } reuses the direct thread, or creates it, and publishes
 *     through the regular user-message path (so the agent's inbox gets it);
 *   - forwarding to the agent whose thread is the origin → 400;
 *   - a direct thread is still NOT a target by `idConversation`.
 */
const r = vi.hoisted(() => ({
  sesion: vi.fn(),
  guard: vi.fn(),
  mensaje: vi.fn(),
  media: vi.fn(),
  convFirst: vi.fn(),
  convCreate: vi.fn(),
  convMany: vi.fn(),
  acceso: vi.fn(),
  accesoAgente: vi.fn(),
  publicar: vi.fn(),
  bandeja: vi.fn(),
  proyectos: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('../../../app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../prisma', () => ({
  prisma: {
    chatMessage: { findUnique: r.mensaje },
    chatMessageMedia: { findFirst: r.media },
    chatConversation: { findFirst: r.convFirst, create: r.convCreate, findMany: r.convMany },
  },
}));
vi.mock('../http', async (importOriginal) => {
  const real = await importOriginal<typeof import('../http')>();
  return { ...real, resolveSessionUser: r.sesion, guardConversation: r.guard };
});
vi.mock('../access', () => ({ getChatAccess: r.acceso, getChatAgentAccess: r.accesoAgente }));
vi.mock('../attachmentStorage', () => ({ downloadChatAttachment: vi.fn(), uploadChatAttachments: vi.fn() }));
vi.mock('../publicar-mensaje', () => ({ publicarMensajeDePersona: r.publicar }));
vi.mock('../projects', () => ({ conversacionesDeProyectoEscribibles: r.proyectos }));
vi.mock('../conversations', () => ({ listUserConversations: r.bandeja, serializeMessage: (m: { id: number }) => ({ id: m.id }) }));

import { NextRequest, NextResponse } from 'next/server';
import { GET, POST } from '../../../app/api/chat/conversations/[id]/messages/[messageId]/reenviar/route';

const USER = { id: 'u1', email: 'nicolas@x.com' };
const params = { params: Promise.resolve({ id: '10', messageId: '345' }) };
const URL_FWD = 'http://x/api/chat/conversations/10/messages/345/reenviar';
const post = (body: unknown) =>
  POST(new NextRequest(URL_FWD, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), params);

const ORIGIN = { user: USER, conversationId: 10, kind: 'group', groupRole: 'member', groupAgents: [] };
const ORION = { idAgent: 5, code: 'orion', displayName: 'Orion', handle: 'orion' };
const MSG = { id_conversation: 10, role: 'user', body: 'Hola @zoe, revise esto', userAuthor: { name: 'Laura', email: 'l@x.com' }, agentAuthor: null, attachments: [] };

beforeEach(() => {
  vi.clearAllMocks();
  r.sesion.mockResolvedValue(USER);
  r.mensaje.mockResolvedValue(MSG);
  r.media.mockResolvedValue(null);
  r.bandeja.mockResolvedValue([]);
  r.proyectos.mockResolvedValue([]);
  r.publicar.mockResolvedValue({ message: { id: 900 }, notifiedAgents: [] });
  r.acceso.mockResolvedValue({ canUseChat: true, companies: [], agents: [ORION, { idAgent: 7, code: 'zoe', displayName: 'Zoe', handle: null }] });
  r.accesoAgente.mockImplementation(async (_email: string, id: number) => (id === 5 ? ORION : null));
});

describe('GET — agents as forward targets', () => {
  it('lists the assigned agents, with their direct thread when it exists', async () => {
    r.guard.mockResolvedValue(ORIGIN);
    r.convMany.mockResolvedValue([{ id: 40, id_agent: 5, last_message_at: new Date('2026-11-18T12:00:00Z') }]);
    const res = await GET(new NextRequest(URL_FWD), params);
    expect(res.status).toBe(200);
    const { destinos } = await res.json();
    expect(destinos).toEqual([
      { idConversation: 40, idAgent: 5, tipo: 'agente', titulo: 'Orion', detalle: '@orion', lastMessageAt: '2026-11-18T12:00:00.000Z' },
      { idConversation: null, idAgent: 7, tipo: 'agente', titulo: 'Zoe', detalle: null, lastMessageAt: null },
    ]);
    expect(r.convMany.mock.calls[0][0].where).toMatchObject({ kind: 'direct', id_user: 'u1', archived: false });
  });

  it('skips the agent whose direct thread is the origin', async () => {
    r.guard.mockResolvedValue({ user: USER, conversationId: 10, kind: 'direct', idAgent: 5 });
    r.convMany.mockResolvedValue([{ id: 10, id_agent: 5, last_message_at: null }]);
    const { destinos } = await (await GET(new NextRequest(URL_FWD), params)).json();
    expect(destinos.map((d: { idAgent: number }) => d.idAgent)).toEqual([7]);
  });

  it('no chat access: no agents', async () => {
    r.guard.mockResolvedValue(ORIGIN);
    r.acceso.mockResolvedValue({ canUseChat: false, companies: [], agents: [] });
    const { destinos } = await (await GET(new NextRequest(URL_FWD), params)).json();
    expect(destinos).toEqual([]);
    expect(r.convMany).not.toHaveBeenCalled();
  });
});

describe('POST { idAgent } — permissions', () => {
  it('agent not assigned: 403 and no conversation is created', async () => {
    r.guard.mockResolvedValue(ORIGIN);
    const res = await post({ idAgent: 99 });
    expect(res.status).toBe(403);
    expect(r.convFirst).not.toHaveBeenCalled();
    expect(r.convCreate).not.toHaveBeenCalled();
    expect(r.publicar).not.toHaveBeenCalled();
  });

  it('invalid idAgent: 400', async () => {
    r.guard.mockResolvedValue(ORIGIN);
    expect((await post({ idAgent: 'abc' })).status).toBe(400);
    expect((await post({ idAgent: -1 })).status).toBe(400);
  });

  it('the agent whose thread is the origin: 400', async () => {
    r.guard.mockResolvedValue({ user: USER, conversationId: 10, kind: 'direct', idAgent: 5 });
    r.convFirst.mockResolvedValue({ id: 10 });
    expect((await post({ idAgent: 5 })).status).toBe(400);
    expect(r.publicar).not.toHaveBeenCalled();
  });

  it('a direct thread is still not a target by idConversation', async () => {
    r.guard.mockResolvedValueOnce(ORIGIN).mockResolvedValueOnce({ user: USER, conversationId: 40, kind: 'direct', idAgent: 5 });
    expect((await post({ idConversation: 40 })).status).toBe(400);
    expect(r.publicar).not.toHaveBeenCalled();
  });
});

describe('POST { idAgent } — publishes in the direct thread', () => {
  it('reuses the existing direct thread and publishes as a user message', async () => {
    const direct = { user: USER, conversationId: 40, kind: 'direct', idAgent: 5 };
    r.guard.mockResolvedValueOnce(ORIGIN).mockResolvedValueOnce(direct);
    r.convFirst.mockResolvedValue({ id: 40 });
    const res = await post({ idAgent: 5, body: 'Mire esto' });
    expect(res.status).toBe(201);
    expect(r.convCreate).not.toHaveBeenCalled();
    expect(r.convFirst.mock.calls[0][0].where).toEqual({ kind: 'direct', id_user: 'u1', id_agent: 5, archived: false });
    expect(r.guard).toHaveBeenLastCalledWith('40');
    const [guard, datos] = r.publicar.mock.calls[0];
    expect(guard).toBe(direct);
    expect(datos.body).toContain('Mire esto');
    expect(datos.body).toContain('Reenviado · mensaje de Laura');
  });

  it('creates the direct thread when it does not exist (like opening the chat)', async () => {
    const direct = { user: USER, conversationId: 41, kind: 'direct', idAgent: 5 };
    r.guard.mockResolvedValueOnce(ORIGIN).mockResolvedValueOnce(direct);
    r.convFirst.mockResolvedValue(null);
    r.convCreate.mockResolvedValue({ id: 41 });
    const res = await post({ idAgent: 5 });
    expect(res.status).toBe(201);
    expect(r.convCreate.mock.calls[0][0].data).toEqual({ kind: 'direct', id_user: 'u1', id_agent: 5, title: 'Orion' });
    expect(r.publicar.mock.calls[0][0]).toBe(direct);
  });

  it('if the thread gate refuses, nothing is published', async () => {
    r.guard
      .mockResolvedValueOnce(ORIGIN)
      .mockResolvedValueOnce({ response: NextResponse.json({ error: 'Conversación no encontrada.' }, { status: 404 }) });
    r.convFirst.mockResolvedValue({ id: 40 });
    expect((await post({ idAgent: 5 })).status).toBe(404);
    expect(r.publicar).not.toHaveBeenCalled();
  });
});
