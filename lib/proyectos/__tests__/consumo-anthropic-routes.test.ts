import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Medidor del consumo de Anthropic (2026-10-22) — las rejas del servidor:
 *   - POST /api/chat/agent/quota exige la llave del agente; la fila es la de SU agente (el cuerpo no trae agente);
 *   - una medición más vieja no pisa la guardada; sin la tabla responde 503;
 *   - GET /api/proyectos/<id>/consumo exige sesión y ser miembro (404 si no), y solo trae los agentes del proyecto.
 */
const h = vi.hoisted(() => ({
  db: {
    chatAgentQuota: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    chatProjectAgent: { findMany: vi.fn() },
  },
  agent: vi.fn(),
  sessionUser: vi.fn(),
  resolveProject: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('../../../app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../prisma', () => ({ prisma: h.db }));
vi.mock('../../chat/agent-auth', () => ({ authenticateAgent: h.agent }));
vi.mock('../../chat/http', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../chat/http')>();
  return { ...real, resolveSessionUser: h.sessionUser };
});
vi.mock('../../chat/projects', () => ({ resolveProjectForUser: h.resolveProject }));

import { NextRequest } from 'next/server';
import { POST as reportar } from '../../../app/api/chat/agent/quota/route';
import { GET as consultar } from '../../../app/api/proyectos/[id]/consumo/route';

const { db } = h;
const ahora = new Date();
const hace = (min: number) => new Date(ahora.getTime() - min * 60_000).toISOString();
const reporte = (extra: Record<string, unknown> = {}) => ({
  utilizacion7d: 40,
  reset7d: new Date(ahora.getTime() + 24 * 3600_000).toISOString(),
  utilizacion5h: 22,
  reset5h: new Date(ahora.getTime() + 2 * 3600_000).toISOString(),
  overage: 'rejected',
  medidoEn: hace(1),
  fuente: 'turno',
  ...extra,
});
const post = (body: unknown) =>
  new NextRequest('http://x/api/chat/agent/quota', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer llave' } });
const params = (id = '7') => ({ params: Promise.resolve({ id }) });
const get = () => new NextRequest('http://x/api/proyectos/7/consumo');

beforeEach(() => {
  vi.clearAllMocks();
  h.agent.mockResolvedValue({ idAgent: 3, code: 'horus', displayName: 'Orus', scope: 'projects' });
});

describe('POST /api/chat/agent/quota', () => {
  it('sin llave válida: 401 y no escribe', async () => {
    h.agent.mockResolvedValue(null);
    const res = await reportar(post(reporte()));
    expect(res.status).toBe(401);
    expect(db.chatAgentQuota.create).not.toHaveBeenCalled();
  });

  it('cuerpo inválido: 400', async () => {
    const res = await reportar(post(reporte({ fuente: 'otra' })));
    expect(res.status).toBe(400);
    expect(db.chatAgentQuota.findUnique).not.toHaveBeenCalled();
  });

  it('primera vez: crea la fila del agente de la LLAVE (ignora un agente en el cuerpo)', async () => {
    db.chatAgentQuota.findUnique.mockResolvedValue(null);
    const res = await reportar(post({ ...reporte(), idAgent: 99, code: 'otro' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ guardado: true });
    const data = db.chatAgentQuota.create.mock.calls[0][0].data;
    expect(data.id_agent).toBe(3);
    expect(data).toMatchObject({ utilization_7d: 40, utilization_5h: 22, overage: 'rejected', source: 'turno' });
    expect(data.measured_at).toBeInstanceOf(Date);
  });

  it('una medición más nueva actualiza; una más vieja no pisa', async () => {
    db.chatAgentQuota.findUnique.mockResolvedValue({ measured_at: new Date(hace(5)) });
    expect((await reportar(post(reporte()))).status).toBe(200);
    expect(db.chatAgentQuota.update).toHaveBeenCalledTimes(1);
    expect(db.chatAgentQuota.update.mock.calls[0][0].where).toEqual({ id_agent: 3 });

    db.chatAgentQuota.findUnique.mockResolvedValue({ measured_at: new Date(hace(0)) });
    const res = await reportar(post(reporte({ medidoEn: hace(3) })));
    expect(await res.json()).toEqual({ guardado: false });
    expect(db.chatAgentQuota.update).toHaveBeenCalledTimes(1);
  });

  it('sin la tabla todavía: 503', async () => {
    db.chatAgentQuota.findUnique.mockRejectedValue(Object.assign(new Error("Invalid object name 'dbo.chat_agent_quota'"), { code: 'P2021' }));
    const res = await reportar(post(reporte()));
    expect(res.status).toBe(503);
  });
});

describe('GET /api/proyectos/<id>/consumo', () => {
  it('sin sesión: 401', async () => {
    h.sessionUser.mockResolvedValue(null);
    expect((await consultar(get(), params())).status).toBe(401);
  });

  it('no miembro: 404 y no lee el cupo', async () => {
    h.sessionUser.mockResolvedValue({ id: 'u1', email: 'a@b.co' });
    h.resolveProject.mockResolvedValue(null);
    expect((await consultar(get(), params())).status).toBe(404);
    expect(db.chatAgentQuota.findMany).not.toHaveBeenCalled();
  });

  it('miembro (cualquier rol): solo los agentes designados del proyecto, con dato', async () => {
    h.sessionUser.mockResolvedValue({ id: 'u1', email: 'a@b.co' });
    h.resolveProject.mockResolvedValue({ idProject: 7, role: 'reader', archived: false });
    db.chatProjectAgent.findMany.mockResolvedValue([
      { agent: { id_agent: 3, code: 'horus', display_name: 'Orus' } },
      { agent: { id_agent: 5, code: 'play', display_name: 'Play' } },
    ]);
    db.chatAgentQuota.findMany.mockResolvedValue([
      { id_agent: 3, utilization_7d: 40, reset_7d: new Date('2026-10-23T22:00:00.000Z'), utilization_5h: 22, reset_5h: null, overage: 'rejected', measured_at: new Date('2026-10-22T13:00:00.000Z'), source: 'sonda' },
    ]);
    const res = await consultar(get(), params());
    expect(res.status).toBe(200);
    expect(h.resolveProject).toHaveBeenCalledWith(expect.anything(), 7, { allowArchived: true });
    expect(db.chatProjectAgent.findMany.mock.calls[0][0].where).toEqual({ id_project: 7 });
    expect(db.chatAgentQuota.findMany.mock.calls[0][0].where).toEqual({ id_agent: { in: [3, 5] } });
    expect(await res.json()).toEqual({
      agents: [
        { code: 'horus', displayName: 'Orus', utilizacion7d: 40, reset7d: '2026-10-23T22:00:00.000Z', utilizacion5h: 22, reset5h: null, overage: 'rejected', medidoEn: '2026-10-22T13:00:00.000Z', fuente: 'sonda' },
      ],
    });
  });

  it('sin la tabla todavía: lista vacía (la interfaz no pinta nada)', async () => {
    h.sessionUser.mockResolvedValue({ id: 'u1', email: 'a@b.co' });
    h.resolveProject.mockResolvedValue({ idProject: 7, role: 'owner', archived: false });
    db.chatProjectAgent.findMany.mockResolvedValue([{ agent: { id_agent: 3, code: 'horus', display_name: 'Orus' } }]);
    db.chatAgentQuota.findMany.mockRejectedValue(Object.assign(new Error('x'), { code: 'P2021' }));
    expect(await (await consultar(get(), params())).json()).toEqual({ agents: [] });
  });
});
