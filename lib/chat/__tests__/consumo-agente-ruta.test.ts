import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * GET /api/chat/agents/<code>/consumo (2026-10-22, botón de consumo del chat):
 *   - exige sesión (401);
 *   - exige ACCESO al agente según getChatAccess (404 si no: no se sondea qué agentes existen);
 *   - devuelve solo la fila de ESE agente; sin medición (o sin la tabla), lista vacía.
 */
const r = vi.hoisted(() => ({
  sesion: vi.fn(),
  acceso: vi.fn(),
  cuotas: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('../../../app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../prisma', () => ({ prisma: { chatAgentQuota: { findMany: r.cuotas } } }));
vi.mock('../http', async (importOriginal) => {
  const real = await importOriginal<typeof import('../http')>();
  return { ...real, resolveSessionUser: r.sesion };
});
vi.mock('../access', () => ({ getChatAccess: r.acceso }));

import { NextRequest } from 'next/server';
import { GET } from '../../../app/api/chat/agents/[code]/consumo/route';

const pedir = (code = 'horus') =>
  GET(new NextRequest(`http://x/api/chat/agents/${code}/consumo`), { params: Promise.resolve({ code }) });

const ahora = new Date();
const filaCuota = {
  id_agent: 3,
  utilization_7d: 42,
  reset_7d: new Date(ahora.getTime() + 86_400_000),
  utilization_5h: 31,
  reset_5h: new Date(ahora.getTime() + 3_600_000),
  overage: null,
  measured_at: ahora,
  source: 'sonda',
};

beforeEach(() => {
  vi.clearAllMocks();
  r.sesion.mockResolvedValue({ id: 'yo', email: 'yo@x' });
  r.acceso.mockResolvedValue({
    canUseChat: true,
    companies: [],
    agents: [{ idAgent: 3, code: 'horus', displayName: 'Orus' }],
  });
});

describe('GET /api/chat/agents/<code>/consumo', () => {
  it('sin sesión: 401', async () => {
    r.sesion.mockResolvedValue(null);
    expect((await pedir()).status).toBe(401);
    expect(r.acceso).not.toHaveBeenCalled();
  });

  it('agente sin acceso (o inexistente): 404 y no lee la cuota', async () => {
    const res = await pedir('play');
    expect(res.status).toBe(404);
    expect(r.cuotas).not.toHaveBeenCalled();
  });

  it('sin el módulo de chat: 404 aunque el agente exista', async () => {
    r.acceso.mockResolvedValue({ canUseChat: false, companies: [], agents: [{ idAgent: 3, code: 'horus', displayName: 'Orus' }] });
    expect((await pedir()).status).toBe(404);
  });

  it('con acceso: la cuota de ESE agente, con el formato del medidor de Proyectos', async () => {
    r.cuotas.mockResolvedValue([filaCuota]);
    const res = await pedir();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(r.cuotas).toHaveBeenCalledWith({ where: { id_agent: { in: [3] } } });
    const { agents } = await res.json();
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ code: 'horus', displayName: 'Orus', utilizacion7d: 42, utilizacion5h: 31, fuente: 'sonda' });
  });

  it('agente que no publica cuota: lista vacía (el botón no se pinta)', async () => {
    r.cuotas.mockResolvedValue([]);
    expect(await (await pedir()).json()).toEqual({ agents: [] });
  });

  it('la tabla todavía no existe en esta base: lista vacía, no 500', async () => {
    r.cuotas.mockRejectedValue(new Error("Invalid object name 'dbo.chat_agent_quota'."));
    const res = await pedir();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ agents: [] });
  });
});
