import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Estado en vivo del agente en Proyectos (2026-10-20) — lado del servidor:
 *   - la consulta lleva SIEMPRE la puerta (miembro + módulo + nada archivado);
 *   - solo cuenta la fila del agente dueño de la conversación;
 *   - el pulso entrega los cambios en el MISMO long-poll, solo si el navegador
 *     los pide (`st`) y solo a quien tiene el módulo; sin `st` responde igual que antes;
 *   - la marca global se comparte entre peticiones (no una consulta por persona y segundo).
 */
const m = vi.hoisted(() => ({
  empresas: vi.fn(),
  estadoFindMany: vi.fn(),
  estadoAggregate: vi.fn(),
  msgFindFirst: vi.fn(),
  msgFindMany: vi.fn(),
  supFindFirst: vi.fn(),
  visiblesPersonas: vi.fn(),
  participantes: vi.fn(),
  sessionUser: vi.fn(),
}));

vi.mock('../../prisma', () => ({
  prisma: {
    chatAgentStatus: { findMany: m.estadoFindMany, aggregate: m.estadoAggregate },
    chatMessage: { findFirst: m.msgFindFirst, findMany: m.msgFindMany },
    subprocessUserCompany: { findFirst: m.supFindFirst },
    chatParticipant: { findMany: m.participantes },
  },
}));
vi.mock('../../chat/projects', () => ({ projectModuleCompanies: m.empresas }));
vi.mock('../../chat/people', () => ({ visiblePeopleConversationIds: m.visiblesPersonas }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('../../../app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../chat/http', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../chat/http')>();
  return { ...real, resolveSessionUser: m.sessionUser };
});
// El pulso espera 1 s entre vueltas y hasta 20 s: aquí se acorta.
vi.mock('../../chat/people-rules', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../chat/people-rules')>();
  return { ...real, PULSE_WAIT_SECONDS: 0.05, PULSE_TICK_MS: 10 };
});

import { NextRequest } from 'next/server';
import {
  __reiniciarMarca,
  aEstadoDto,
  estadosCambiadosVisibles,
  estadosTrabajandoVisibles,
  marcaGlobalEstados,
} from '../estado-agente-servidor';
import { GET as pulso } from '../../../app/api/chat/pulse/route';

const ANA = { id: 'u-ana', email: 'ana@gsslatam.com' };

function fila(p: { id?: number; agente?: number; dueno?: number; state?: string; label?: string | null; tasks?: string | null; t?: string; proyecto?: number | null } = {}) {
  const idAgent = p.agente ?? 7;
  return {
    id_conversation: p.id ?? 28,
    id_agent: idAgent,
    state: p.state ?? 'tool',
    label: p.label === undefined ? 'Consultando SAP…' : p.label,
    tasks: p.tasks ?? null,
    updated_at: new Date(p.t ?? '2026-10-20T16:00:05.000Z'),
    conversation: {
      id_agent: p.dueno ?? 7,
      id_project: p.proyecto === undefined ? 4 : p.proyecto,
      title: 'Conversación inicial',
      project: { name: 'Farmalógica — Orus (piloto)' },
      agent: { id_agent: p.dueno ?? 7, code: 'horus', display_name: 'Orus', avatar_url: null, avatar_updated_at: null },
    },
  };
}

const PUERTA = {
  kind: 'project',
  archived: false,
  project: { archived: false, id_company: { in: [3] }, members: { some: { id_user: 'u-ana' } } },
};

beforeEach(() => {
  vi.clearAllMocks();
  __reiniciarMarca();
  m.empresas.mockResolvedValue([{ idCompany: 3, companyName: 'OLP' }]);
  m.estadoFindMany.mockResolvedValue([]);
  m.estadoAggregate.mockResolvedValue({ _max: { updated_at: new Date('2026-10-20T16:00:00.000Z') } });
  m.msgFindFirst.mockResolvedValue({ id: 100 });
  m.msgFindMany.mockResolvedValue([]);
  m.supFindFirst.mockResolvedValue(null);
  m.visiblesPersonas.mockResolvedValue([]);
  m.participantes.mockResolvedValue([]);
});

describe('aEstadoDto', () => {
  it('fila del agente dueño → DTO con los subagentes ya leídos', () => {
    const d = aEstadoDto(fila({ tasks: JSON.stringify([{ desc: 'Analista de cartera', startedAt: '2026-10-20T15:59:00.000Z' }]) }));
    expect(d).toMatchObject({
      idConversation: 28,
      idProject: 4,
      projectName: 'Farmalógica — Orus (piloto)',
      conversationTitle: 'Conversación inicial',
      agent: { idAgent: 7, code: 'horus', displayName: 'Orus' },
      state: 'tool',
      label: 'Consultando SAP…',
      updatedAt: '2026-10-20T16:00:05.000Z',
    });
    expect(d?.tasks).toEqual([{ desc: 'Analista de cartera', startedAt: '2026-10-20T15:59:00.000Z' }]);
  });

  it('la fila de OTRO agente o sin proyecto no se muestra', () => {
    expect(aEstadoDto(fila({ agente: 9, dueno: 7 }))).toBeNull();
    expect(aEstadoDto(fila({ proyecto: null }))).toBeNull();
  });
});

describe('consultas con la puerta', () => {
  it('trabajando: solo conversaciones visibles, y de los proyectos pedidos', async () => {
    m.estadoFindMany.mockResolvedValue([fila(), fila({ id: 29, state: 'idle', label: null, tasks: '[]' })]);
    const r = await estadosTrabajandoVisibles('u-ana', [3], { idProjects: [4, 7] });
    expect(r.map((e) => e.idConversation)).toEqual([28]);
    const where = m.estadoFindMany.mock.calls[0][0].where;
    expect(where.conversation).toEqual({ ...PUERTA, id_project: { in: [4, 7] } });
  });

  it('sin módulo o sin proyectos: ni consulta', async () => {
    expect(await estadosTrabajandoVisibles('u-ana', [])).toEqual([]);
    expect(await estadosTrabajandoVisibles('u-ana', [3], { idProjects: [] })).toEqual([]);
    expect(await estadosCambiadosVisibles('u-ana', [], new Date())).toEqual([]);
    expect(m.estadoFindMany).not.toHaveBeenCalled();
  });

  it('cambiados: desde el cursor, con la puerta, y TAMBIÉN los que volvieron a reposo', async () => {
    m.estadoFindMany.mockResolvedValue([fila({ state: 'idle', label: null })]);
    const desde = new Date('2026-10-20T16:00:00.000Z');
    const r = await estadosCambiadosVisibles('u-ana', [3], desde);
    expect(r[0].state).toBe('idle');
    const arg = m.estadoFindMany.mock.calls[0][0];
    expect(arg.where).toEqual({ updated_at: { gt: desde }, conversation: PUERTA });
    expect(arg.orderBy).toEqual({ updated_at: 'asc' });
  });
});

describe('marca global', () => {
  it('se comparte entre peticiones durante ~1 s (una consulta por instancia, no por persona)', async () => {
    const t0 = Date.now();
    await Promise.all([marcaGlobalEstados(t0), marcaGlobalEstados(t0), marcaGlobalEstados(t0)]);
    await marcaGlobalEstados(Date.now() + 100);
    expect(m.estadoAggregate).toHaveBeenCalledTimes(1);
    expect(m.estadoAggregate.mock.calls[0][0].where).toEqual({ conversation: { kind: 'project' } });
    await marcaGlobalEstados(Date.now() + 5_000);
    expect(m.estadoAggregate).toHaveBeenCalledTimes(2);
  });
});

describe('pulso del chat con estados de proyecto', () => {
  const pulseReq = (q: string) => new NextRequest(`http://x/api/chat/pulse?${q}`);

  it('sin `st` responde exactamente como antes (navegador con la versión anterior)', async () => {
    m.sessionUser.mockResolvedValue(ANA);
    const r = await (await pulso(pulseReq('since=0'))).json();
    expect(r).toEqual({ cursor: 100, events: [] });
    expect(m.estadoAggregate).not.toHaveBeenCalled();
  });

  it('`st=0` en la primera vuelta: devuelve el cursor de estados, sin estados', async () => {
    m.sessionUser.mockResolvedValue(ANA);
    const r = await (await pulso(pulseReq('since=0&st=0'))).json();
    expect(r).toEqual({ cursor: 100, events: [], statusCursor: '2026-10-20T16:00:00.000Z', statuses: [] });
  });

  it('sin el módulo Proyectos (solo Chat): no hay estados aunque los pida', async () => {
    m.sessionUser.mockResolvedValue(ANA);
    m.supFindFirst.mockResolvedValue({ id_subprocess_user_company: 1 });
    m.empresas.mockResolvedValue([]);
    const r = await (await pulso(pulseReq('since=0&st=0'))).json();
    expect(r).toEqual({ cursor: 100, events: [] });
  });

  it('un cambio de estado corta la espera y viaja con la puerta; el cursor avanza', async () => {
    m.sessionUser.mockResolvedValue(ANA);
    m.estadoAggregate.mockResolvedValue({ _max: { updated_at: new Date('2026-10-20T16:00:05.000Z') } });
    m.estadoFindMany.mockResolvedValue([fila()]);
    const r = await (await pulso(pulseReq('since=100&st=2026-10-20T16:00:00.000Z'))).json();
    expect(r.events).toEqual([]);
    expect(r.statuses).toHaveLength(1);
    expect(r.statuses[0]).toMatchObject({ idConversation: 28, state: 'tool', label: 'Consultando SAP…', agent: { displayName: 'Orus' } });
    expect(r.statusCursor).toBe('2026-10-20T16:00:05.000Z');
    expect(m.estadoFindMany.mock.calls[0][0].where).toEqual({ updated_at: { gt: new Date('2026-10-20T16:00:00.000Z') }, conversation: PUERTA });
  });

  it('si la marca global no avanzó, no hace la consulta filtrada', async () => {
    m.sessionUser.mockResolvedValue(ANA);
    const r = await (await pulso(pulseReq('since=100&st=2026-10-20T16:00:00.000Z'))).json();
    expect(r).toEqual({ cursor: 100, events: [], statusCursor: '2026-10-20T16:00:00.000Z', statuses: [] });
    expect(m.estadoFindMany).not.toHaveBeenCalled();
  });

  it('cambios ajenos (de conversaciones que no ve): nada, pero el cursor avanza', async () => {
    m.sessionUser.mockResolvedValue(ANA);
    m.estadoAggregate.mockResolvedValue({ _max: { updated_at: new Date('2026-10-20T16:00:09.000Z') } });
    m.estadoFindMany.mockResolvedValue([]);
    const r = await (await pulso(pulseReq('since=100&st=2026-10-20T16:00:00.000Z'))).json();
    expect(r.statuses).toEqual([]);
    expect(r.statusCursor).toBe('2026-10-20T16:00:09.000Z');
  });
});
