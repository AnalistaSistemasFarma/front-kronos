import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * POST /api/chat/agent/messages en un HILO DE PROYECTO (2026-11-12): la
 * mención de un asistente crea la fila de entrega del otro; un freno no la
 * crea y deja el aviso de sistema UNA vez; en una mesa no se mira nada.
 */
const auth = vi.hoisted(() => vi.fn());
const resolver = vi.hoisted(() => vi.fn());
const mencionables = vi.hoisted(() => vi.fn());
const findFirst = vi.hoisted(() => vi.fn());
const findMany = vi.hoisted(() => vi.fn());
const count = vi.hoisted(() => vi.fn());
const create = vi.hoisted(() => vi.fn());

vi.mock('../../chat/agent-auth', () => ({ authenticateAgent: auth, resolveAgentConversation: resolver }));
vi.mock('../../chat/projects', () => ({ mencionablesParaAgente: mencionables }));
vi.mock('../../chat/notifyAgentReply', () => ({ notifyAgentReply: vi.fn() }));
vi.mock('../mesas', () => ({ alPublicarAgenteEnMesa: vi.fn().mockResolvedValue({ esMesa: false, esSintesis: false }) }));
vi.mock('../../chat/conversations', () => ({ messageInclude: {}, serializeMessage: (m: unknown) => m }));
vi.mock('../../prisma', () => {
  const tx = {
    chatMessage: { findMany, count, create },
    chatConversation: { update: vi.fn() },
    chatAgentStatus: { upsert: vi.fn() },
  };
  return {
    prisma: {
      chatMessage: { findFirst },
      chatProjectMember: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

import { NextRequest } from 'next/server';
import { POST } from '../../../app/api/chat/agent/messages/route';
import { AVISO_BUCLE_ASISTENTES } from '../menciones-agentes';

const ORUS = { idAgent: 1, code: 'horus', displayName: 'Orus', handle: null };
const GALILEO = { idAgent: 2, code: 'galileo', displayName: 'Galileo', handle: null };
const conv = (extra = {}) => ({ id: 50, kind: 'project', idProject: 7, projectName: 'P', idAgentPrincipal: 1, esMesa: false, ...extra });
const publicar = (body: string) =>
  POST(
    new NextRequest('http://x/api/chat/agent/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idConversation: 50, body }),
    })
  );

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ idAgent: 1, code: 'horus', displayName: 'Orus', avatarUrl: null, scope: 'projects' });
  resolver.mockResolvedValue(conv());
  findFirst.mockResolvedValue({ id_user_author: 'u-ana' });
  mencionables.mockResolvedValue([GALILEO]);
  findMany.mockResolvedValue([{ role: 'user', body: 'pregúntele a Galileo', id_agent_author: null, id_user_author: 'u-ana', deliveries: [] }]);
  count.mockResolvedValue(0);
  create.mockImplementation(async ({ data }) => ({ id: 99, ...data }));
});

describe('menciones entre asistentes en la ruta', () => {
  it('la mención crea la entrega del otro asistente (elegibles según la última persona del hilo)', async () => {
    const res = await publicar('@galileo ¿cuál es el estado del cronograma?');
    expect(res.status).toBe(201);
    expect(mencionables).toHaveBeenCalledWith({ idProject: 7, idAgentPrincipal: 1, idAgentAutor: 1, idUserOrigen: 'u-ana' });
    expect(create.mock.calls[0][0].data.deliveries).toEqual({ create: [{ id_agent: 2 }] });
    const data = await res.json();
    expect(data).toMatchObject({ notifiedAgents: [2], chainStopped: false });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('freno de profundidad: sin entrega y con el aviso de sistema (una sola vez)', async () => {
    const salto = (autor: number, destino: number) => ({ role: 'agent', body: 'x', id_agent_author: autor, id_user_author: null, deliveries: [{ id_agent: destino }] });
    findMany.mockResolvedValue([salto(1, 2), salto(2, 1), salto(1, 2), { role: 'user', body: 'hola', id_agent_author: null, id_user_author: 'u-ana', deliveries: [] }]);
    const res = await publicar('@galileo una más');
    const data = await res.json();
    expect(data).toMatchObject({ notifiedAgents: [], chainStopped: true });
    expect(create.mock.calls[0][0].data.deliveries).toBeUndefined();
    expect(create.mock.calls[1][0].data).toMatchObject({ role: 'system', body: AVISO_BUCLE_ASISTENTES });

    // Si el último mensaje ya es el aviso, no se repite.
    create.mockClear();
    findMany.mockResolvedValue([{ role: 'system', body: AVISO_BUCLE_ASISTENTES, id_agent_author: null, id_user_author: null, deliveries: [] }, salto(1, 2), salto(2, 1), salto(1, 2)]);
    await publicar('@galileo insisto');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('freno de ritmo: con 10 saltos en la última hora no se entrega', async () => {
    count.mockResolvedValue(10);
    const data = await (await publicar('@galileo')).json();
    expect(data).toMatchObject({ notifiedAgents: [], chainStopped: true });
  });

  it('MESA: no se resuelven menciones ni se cuentan saltos', async () => {
    resolver.mockResolvedValue(conv({ esMesa: true }));
    const data = await (await publicar('@galileo opine')).json();
    expect(mencionables).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
    expect(data).toMatchObject({ notifiedAgents: [], chainStopped: false });
  });

  it('sin @ no consulta nada extra', async () => {
    await publicar('Listo, ya quedó.');
    expect(findFirst).not.toHaveBeenCalled();
    expect(mencionables).not.toHaveBeenCalled();
  });
});
