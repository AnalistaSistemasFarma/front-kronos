import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Multiagente en un hilo de proyecto (2026-10-29): la persona menciona con @ a
 * otro agente del proyecto → fila de entrega para ese agente (su puente lo
 * recoge); si solo mencionó a otros, el principal no lo atiende.
 */
const createMessage = vi.hoisted(() => vi.fn());
const updateConv = vi.hoisted(() => vi.fn());
const mencionables = vi.hoisted(() => vi.fn());

vi.mock('../../prisma', () => {
  const tx = { chatMessage: { create: createMessage }, chatConversation: { update: updateConv } };
  return { prisma: { $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } };
});
vi.mock('../projects', () => ({ mencionablesDelHilo: mencionables }));
vi.mock('../notifyPeople', () => ({ notifyPeopleMessage: vi.fn() }));
vi.mock('../conversations', () => ({ messageInclude: {} }));

import { publicarMensajeDePersona, type ConversationGuardOk } from '../publicar-mensaje';

const ORUS = { idAgent: 5, code: 'horus', displayName: 'Orus', handle: null };
const PLAY = { idAgent: 21, code: 'play', displayName: 'Play', handle: null };

const guard = {
  user: { id: 'u-ana', email: 'ana@x' },
  conversationId: 40,
  kind: 'project',
  idAgent: ORUS.idAgent,
  idProject: 7,
  projectRole: 'editor',
  projectWritable: { ok: true },
} as unknown as ConversationGuardOk;

const enviar = (body: string) =>
  publicarMensajeDePersona(guard, { body, uploaded: [], clientIp: null, userAgent: null, now: new Date('2026-10-29T12:00:00Z') });

beforeEach(() => {
  vi.clearAllMocks();
  createMessage.mockImplementation(async (a: { data: unknown }) => ({ id: 1, ...(a.data as object) }));
  mencionables.mockResolvedValue({ principal: ORUS, mencionables: [PLAY] });
});

describe('publicarMensajeDePersona en un PROYECTO', () => {
  it('sin @: va solo al principal, sin consultar mencionables', async () => {
    const r = await enviar('Revise el cierre');
    expect(mencionables).not.toHaveBeenCalled();
    expect(r.notifiedAgents).toEqual([ORUS.idAgent]);
    const data = createMessage.mock.calls[0][0].data;
    expect(data.deliveries).toBeUndefined();
    expect(data.delivered_at).toBeUndefined();
  });

  it('@play: entrega a Play y el principal NO lo recoge (nace entregado para él)', async () => {
    const r = await enviar('@play ¿qué opina?');
    expect(mencionables).toHaveBeenCalledWith(guard.user, 7, 'editor', ORUS.idAgent);
    const data = createMessage.mock.calls[0][0].data;
    expect(data.deliveries).toEqual({ create: [{ id_agent: PLAY.idAgent }] });
    expect(data.delivered_at).toEqual(new Date('2026-10-29T12:00:00Z'));
    expect(r.notifiedAgents).toEqual([PLAY.idAgent]);
  });

  it('@horus y @play: los dos', async () => {
    const r = await enviar('@horus y @play revisen');
    const data = createMessage.mock.calls[0][0].data;
    expect(data.deliveries).toEqual({ create: [{ id_agent: PLAY.idAgent }] });
    expect(data.delivered_at).toBeUndefined();
    expect(r.notifiedAgents).toEqual([ORUS.idAgent, PLAY.idAgent]);
  });

  it('@ a un agente que la persona NO puede usar: como si no hubiera mención', async () => {
    mencionables.mockResolvedValue({ principal: ORUS, mencionables: [] });
    const r = await enviar('@play hola');
    expect(createMessage.mock.calls[0][0].data.deliveries).toBeUndefined();
    expect(r.notifiedAgents).toEqual([ORUS.idAgent]);
  });
});
