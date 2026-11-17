import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Bandeja del agente: la llave del bot vivo NO recibe mensajes de proyecto
 * (su consulta sigue anclada a 'direct' + entregas de grupo), y la del puente
 * SOLO recibe mensajes de proyectos activos de su agente.
 */
const auth = vi.hoisted(() => vi.fn());
const findMessages = vi.hoisted(() => vi.fn());
const findDeliveries = vi.hoisted(() => vi.fn());
const updateMessages = vi.hoisted(() => vi.fn());

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('../../../app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../agent-auth', () => ({ authenticateAgent: auth }));
vi.mock('../../prisma', () => ({
  prisma: {
    chatMessage: { findMany: findMessages, updateMany: updateMessages },
    chatMessageDelivery: { findMany: findDeliveries, updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    // Configuración del módulo por empresa (2026-10-20): vacía = manda CHAT_PROJECTS_AGENTS, como antes.
    chatProjectAgentConfig: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { NextRequest } from 'next/server';
import { GET } from '../../../app/api/chat/agent/inbox/route';
import { __resetProjectAgentsCache } from '../projects-rules';

const pedir = (q = 'wait=0') => new NextRequest(`http://x/api/chat/agent/inbox?${q}`);

beforeEach(() => {
  vi.clearAllMocks();
  __resetProjectAgentsCache();
  process.env.CHAT_PROJECTS_AGENTS = '{"play":["olp"]}';
  findMessages.mockResolvedValue([]);
  findDeliveries.mockResolvedValue([]);
});

describe('GET /api/chat/agent/inbox', () => {
  it("llave 'channel': la consulta sigue anclada a hilos directos", async () => {
    auth.mockResolvedValue({ idAgent: 21, code: 'play', displayName: 'Play', scope: 'channel' });
    const res = await GET(pedir());
    expect(res.status).toBe(200);
    expect(findMessages.mock.calls[0][0].where.conversation).toEqual({ kind: 'direct', id_agent: 21 });
    expect((await res.json()).scope).toBeUndefined();
  });

  it("llave 'projects': solo proyectos activos donde su agente está designado, sin tocar la bandeja de siempre", async () => {
    auth.mockResolvedValue({ idAgent: 21, code: 'play', displayName: 'Play', scope: 'projects' });
    const res = await GET(pedir());
    expect(res.status).toBe(200);
    expect(findMessages).toHaveBeenCalledTimes(1);
    expect(findMessages.mock.calls[0][0].where).toMatchObject({
      role: 'user',
      delivered_at: null,
      conversation: { kind: 'project', archived: false, id_agent: 21, project: { archived: false, agents: { some: { id_agent: 21 } } } },
    });
    // Multiagente (2026-10-29): además, SUS menciones en hilos de proyecto de
    // otros agentes. Desde 2026-11-03 en dos pasos: primero SOLO el índice de
    // entregas (sin JOIN a chat_message), y los mensajes después por id.
    expect(findDeliveries).toHaveBeenCalledTimes(1);
    expect(findDeliveries.mock.calls[0][0].where).toEqual({ id_agent: 21, delivered_at: null });
    expect(findDeliveries.mock.calls[0][0].select).toEqual({ id_message: true });
    expect((await res.json()).scope).toBe('projects');
  });

  it("llave 'channel': sus entregas de grupo NO incluyen menciones de proyectos", async () => {
    auth.mockResolvedValue({ idAgent: 21, code: 'play', displayName: 'Play', scope: 'channel' });
    findDeliveries.mockResolvedValueOnce([{ id_message: 5 }, { id_message: 8 }]);
    await GET(pedir());
    expect(findDeliveries.mock.calls[0][0].where).toEqual({ id_agent: 21, delivered_at: null });
    // El filtro de tipo va sobre los ids de SUS entregas, por la PK.
    const grupos = findMessages.mock.calls.find((c) => c[0].where.id);
    expect(grupos?.[0].where).toEqual({ id: { in: [5, 8] }, conversation: { kind: 'group' } });
  });

  it("llave 'projects': una mención en el hilo de otro agente llega una sola vez y se marca en SU fila", async () => {
    auth.mockResolvedValue({ idAgent: 21, code: 'play', displayName: 'Play', scope: 'projects' });
    const m = {
      id: 9, id_conversation: 41, role: 'user', body: '@play ¿qué opina?', created_at: new Date(), attachments: [],
      userAuthor: { id: 'u', name: 'Ana', email: 'a@x' },
      conversation: { id: 41, title: 't', kind: 'project', project: { id_project: 7, name: 'Comex' } },
    };
    findDeliveries.mockResolvedValueOnce([{ id_message: 9 }]);
    findMessages.mockImplementation(async (args) => (args.where.id ? [m] : []));
    const res = await GET(pedir('wait=0&ack=true'));
    const data = await res.json();
    expect(data.messages).toHaveLength(1);
    expect(data.messages[0]).toMatchObject({ id: 9, idConversation: 41 });
    expect(updateMessages.mock.calls[0][0].where).toMatchObject({ conversation: { kind: 'project', id_agent: 21 } });
  });

  it("llave 'projects': la mención de OTRO ASISTENTE llega con autor 'agent' y sin correo (2026-11-12)", async () => {
    auth.mockResolvedValue({ idAgent: 21, code: 'play', displayName: 'Play', scope: 'projects' });
    const m = {
      id: 12, id_conversation: 41, role: 'agent', body: '@play ¿me confirma el dato?', created_at: new Date(), attachments: [],
      userAuthor: null,
      agentAuthor: { id_agent: 30, code: 'galileo', display_name: 'Galileo' },
      conversation: { id: 41, title: 't', kind: 'project', project: { id_project: 7, name: 'Comex' } },
    };
    findDeliveries.mockResolvedValueOnce([{ id_message: 12 }]);
    findMessages.mockImplementation(async (args) => (args.where.id ? [m] : []));
    const res = await GET(pedir('wait=0'));
    const data = await res.json();
    const consulta = findMessages.mock.calls.find((c) => c[0].where.id)?.[0];
    expect(consulta.where.OR).toContainEqual({ role: 'agent' });
    expect(data.messages[0].author).toEqual({ kind: 'agent', id: null, name: 'Galileo (asistente)', email: null, code: 'galileo' });
  });

  it("llave 'projects' de un agente sin interruptor: 404 y ni consulta la base", async () => {
    auth.mockResolvedValue({ idAgent: 5, code: 'horus', displayName: 'Orus', scope: 'projects' });
    const res = await GET(pedir());
    expect(res.status).toBe(404);
    expect(findMessages).not.toHaveBeenCalled();
  });

  it('con ack=false no marca nada como entregado', async () => {
    auth.mockResolvedValue({ idAgent: 21, code: 'play', displayName: 'Play', scope: 'projects' });
    findMessages.mockResolvedValue([
      {
        id: 1, id_conversation: 40, role: 'user', body: 'hola', created_at: new Date(), attachments: [],
        userAuthor: { id: 'u', name: 'Ana', email: 'a@x' },
        conversation: { id: 40, title: 't', kind: 'project', project: { id_project: 7, name: 'Comex' } },
      },
    ]);
    const res = await GET(pedir('wait=0&ack=false'));
    const data = await res.json();
    expect(data.messages[0]).toMatchObject({ id: 1, idConversation: 40, project: { idProject: 7, name: 'Comex' } });
    expect(updateMessages).not.toHaveBeenCalled();
  });
});
