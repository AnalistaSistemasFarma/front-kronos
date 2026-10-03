import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * La bandeja (/api/chat/conversations) NO debe pedir el último mensaje como
 * `messages: { take: 1 }` anidado en un findMany: con varios padres Prisma no
 * baja ese límite a SQL y trae TODOS los mensajes de todas las conversaciones
 * (medido en producción el 2026-10-03: 5.265 mensajes y 4,2 MB por vuelta).
 * Estas pruebas fijan que el último mensaje sale de dos consultas acotadas y
 * que el resultado conserva la forma de siempre.
 */
const findManyConversations = vi.hoisted(() => vi.fn());
const groupByMessages = vi.hoisted(() => vi.fn());
const findManyMessages = vi.hoisted(() => vi.fn());
const countMessages = vi.hoisted(() => vi.fn());
const findManyParticipants = vi.hoisted(() => vi.fn());
const getChatAccess = vi.hoisted(() => vi.fn());

vi.mock('../../prisma', () => ({
  prisma: {
    chatConversation: { findMany: findManyConversations },
    chatMessage: { groupBy: groupByMessages, findMany: findManyMessages, count: countMessages },
    chatParticipant: { findMany: findManyParticipants },
  },
}));
vi.mock('../access', () => ({ getChatAccess }));
vi.mock('../people', () => ({ visiblePeopleConversationIds: vi.fn().mockResolvedValue([]) }));

import { listUserConversations } from '../conversations';

const fecha = new Date('2026-10-03T12:00:00Z');

function conversacion(id: number) {
  return {
    id,
    title: `Hilo ${id}`,
    kind: 'direct',
    created_at: fecha,
    updated_at: fecha,
    last_message_at: fecha,
    archived: false,
    agent: { id_agent: 1, code: 'orus', display_name: 'Orus', handle: null, avatar_url: null },
    company: null,
    statuses: [],
    participants: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getChatAccess.mockResolvedValue({
    canUseChat: true,
    agents: [{ idAgent: 1 }],
    companies: [{ idCompany: 3 }],
  });
  findManyConversations.mockResolvedValue([conversacion(10), conversacion(20)]);
  // El hilo 20 no tiene mensajes todavía.
  groupByMessages.mockImplementation(async (args: { _max?: unknown; _count?: unknown }) => {
    if (args._max) return [{ id_conversation: 10, _max: { id: 99 } }];
    return [];
  });
  findManyMessages.mockResolvedValue([
    { id: 99, id_conversation: 10, role: 'agent', body: 'Último', created_at: fecha },
  ]);
});

describe('listUserConversations — último mensaje acotado', () => {
  it('no anida `messages` en el findMany de conversaciones', async () => {
    await listUserConversations('u1', 'ana@gsslatam.com', { archived: false });
    const args = findManyConversations.mock.calls[0][0];
    expect(args.include).toBeDefined();
    expect(args.include).not.toHaveProperty('messages');
  });

  it('pide el MAX(id) por hilo y luego solo esas filas por clave primaria', async () => {
    await listUserConversations('u1', 'ana@gsslatam.com', { archived: false });
    expect(groupByMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['id_conversation'],
        where: { id_conversation: { in: [10, 20] } },
        _max: { id: true },
      })
    );
    expect(findManyMessages).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [99] } } })
    );
  });

  it('conserva la forma: último mensaje donde lo hay y null donde no', async () => {
    const lista = await listUserConversations('u1', 'ana@gsslatam.com', { archived: false });
    expect(lista.map((c) => c.id)).toEqual([10, 20]);
    expect(lista[0].lastMessage).toMatchObject({ id: 99, role: 'agent' });
    expect(lista[1].lastMessage ?? null).toBeNull();
  });
});
