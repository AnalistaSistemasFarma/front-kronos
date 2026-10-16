import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * guardConversation lee la clase del hilo UNA vez y prueba SOLO la puerta que
 * le corresponde. Estas pruebas fijan eso: que un grupo no pase por la puerta
 * del hilo directo (y al revés), y que una clase desconocida responda 404.
 */
const session = vi.hoisted(() => vi.fn());
const findUser = vi.hoisted(() => vi.fn());
const findConversation = vi.hoisted(() => vi.fn());
const ownership = vi.hoisted(() => vi.fn());
const groupAccess = vi.hoisted(() => vi.fn());
const peopleAccess = vi.hoisted(() => vi.fn());

vi.mock('next-auth', () => ({ getServerSession: session }));
vi.mock('../../../app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../prisma', () => ({
  prisma: {
    user: { findUnique: findUser },
    chatConversation: { findUnique: findConversation },
  },
}));
vi.mock('../access', () => ({ assertConversationOwnership: ownership }));
vi.mock('../groups', () => ({ assertGroupAccess: groupAccess }));
vi.mock('../people', () => ({ assertPeopleAccess: peopleAccess }));

import { guardConversation } from '../http';

beforeEach(() => {
  vi.clearAllMocks();
  session.mockResolvedValue({ user: { email: 'ana@gsslatam.com' } });
  findUser.mockResolvedValue({ id: 'u1', email: 'ana@gsslatam.com', isActive: true });
});

describe('guardConversation', () => {
  it('un hilo directo pasa solo por la puerta del hilo directo', async () => {
    findConversation.mockResolvedValue({ kind: 'direct' });
    ownership.mockResolvedValue({ id: 5, idAgent: 3 });
    const guard = await guardConversation('5');
    expect(guard).toMatchObject({ kind: 'direct', conversationId: 5, idAgent: 3 });
    expect(groupAccess).not.toHaveBeenCalled();
  });

  it('un grupo pasa solo por la puerta del grupo', async () => {
    findConversation.mockResolvedValue({ kind: 'group' });
    groupAccess.mockResolvedValue({ id: 9, role: 'member', agentes: [] });
    const guard = await guardConversation('9');
    expect(guard).toMatchObject({ kind: 'group', conversationId: 9, groupRole: 'member' });
    expect(ownership).not.toHaveBeenCalled();
  });

  it('un hilo entre personas pasa solo por su puerta', async () => {
    findConversation.mockResolvedValue({ kind: 'people' });
    peopleAccess.mockResolvedValue({ id: 11, otherUserId: 'u2', myParticipantId: 40 });
    const guard = await guardConversation('11');
    expect(guard).toMatchObject({ kind: 'people', conversationId: 11, otherUserId: 'u2' });
    expect(peopleAccess).toHaveBeenCalledWith('u1', 11);
    expect(ownership).not.toHaveBeenCalled();
    expect(groupAccess).not.toHaveBeenCalled();
  });

  it('un hilo entre personas ajeno responde 404', async () => {
    findConversation.mockResolvedValue({ kind: 'people' });
    peopleAccess.mockResolvedValue(null);
    const guard = await guardConversation('11');
    expect('response' in guard && guard.response.status).toBe(404);
  });

  it('una clase desconocida responde 404 sin probar ninguna puerta', async () => {
    findConversation.mockResolvedValue({ kind: 'otra' });
    const guard = await guardConversation('7');
    expect('response' in guard && guard.response.status).toBe(404);
    expect(ownership).not.toHaveBeenCalled();
    expect(groupAccess).not.toHaveBeenCalled();
  });

  it('una conversación que no existe responde 404', async () => {
    findConversation.mockResolvedValue(null);
    const guard = await guardConversation('7');
    expect('response' in guard && guard.response.status).toBe(404);
  });

  it('sin sesión responde 401 y un id inválido 400', async () => {
    session.mockResolvedValueOnce(null);
    const sinSesion = await guardConversation('7');
    expect('response' in sinSesion && sinSesion.response.status).toBe(401);
    const invalido = await guardConversation('abc');
    expect('response' in invalido && invalido.response.status).toBe(400);
  });
});
