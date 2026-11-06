import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * /api/chat/agents/<code>/contexto (2026-10-29):
 *   GET  — sesión + acceso al agente (404 si no); la conversación debe ser del usuario;
 *          puedeLimpiar solo con canConfigureAgents y el agente en su alcance.
 *   POST — solo administradores (403), exige confirmar (400), 409 si trabaja o ya hay orden.
 */
const r = vi.hoisted(() => ({
  sesion: vi.fn(),
  acceso: vi.fn(),
  conversacion: vi.fn(),
  configurar: vi.fn(),
  alcance: vi.fn(),
  enAlcance: vi.fn(),
  leer: vi.fn(),
  ultima: vi.fn(),
  ocupado: vi.fn(),
  crear: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('../../../app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../prisma', () => ({ prisma: { chatConversation: { findFirst: r.conversacion } } }));
vi.mock('../http', async (importOriginal) => {
  const real = await importOriginal<typeof import('../http')>();
  return { ...real, resolveSessionUser: r.sesion };
});
vi.mock('../access', () => ({ getChatAccess: r.acceso }));
vi.mock('../audit-access', () => ({ canConfigureAgents: r.configurar, getAuditScope: r.alcance, agentCodeInScope: r.enAlcance }));
vi.mock('../agent-context-store', async () => {
  class ContextoNoDisponible extends Error {}
  class OrdenActiva extends Error {
    constructor(public orden: unknown) {
      super('Ya hay una orden de limpiar contexto en curso para este agente.');
    }
  }
  return {
    ContextoNoDisponible,
    OrdenActiva,
    leerContexto: r.leer,
    ultimaOrden: r.ultima,
    agenteOcupado: r.ocupado,
    crearOrdenLimpiar: r.crear,
  };
});

import { NextRequest } from 'next/server';
import { GET, POST } from '../../../app/api/chat/agents/[code]/contexto/route';
import { OrdenActiva } from '../agent-context-store';
import type { OrdenDto } from '../agent-context';

const ctxPrincipal = {
  sessionKey: 'principal',
  runtime: 'claude-code',
  alcance: 'agente',
  sessionId: 's1',
  model: 'claude-opus-5-5',
  tokens: 870000,
  window: 1000000,
  percent: 87,
  measuredAt: new Date().toISOString(),
};

const params = (code = 'mechita') => ({ params: Promise.resolve({ code }) });
const get = async (q = '?conversacion=12', code = 'mechita'): Promise<Response> => GET(new NextRequest(`http://x/api/chat/agents/${code}/contexto${q}`), params(code));
const post = async (body: unknown, code = 'mechita'): Promise<Response> =>
  POST(
    new NextRequest(`http://x/api/chat/agents/${code}/contexto`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    params(code)
  );

beforeEach(() => {
  vi.clearAllMocks();
  r.sesion.mockResolvedValue({ id: 'u1', email: 'admin@x' });
  r.acceso.mockResolvedValue({ canUseChat: true, companies: [], agents: [{ idAgent: 7, code: 'mechita', displayName: 'Mechita' }] });
  r.conversacion.mockResolvedValue({ id: 12 });
  r.configurar.mockResolvedValue(true);
  r.alcance.mockResolvedValue({ all: true });
  r.enAlcance.mockResolvedValue(true);
  r.leer.mockResolvedValue(ctxPrincipal);
  r.ultima.mockResolvedValue(null);
  r.ocupado.mockResolvedValue(false);
  r.crear.mockImplementation(async (n) => ({ id: 1, status: 'pendiente', requestedBy: n.requestedBy }));
});

describe('GET contexto', () => {
  it('sin sesión: 401', async () => {
    r.sesion.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
  });

  it('agente sin acceso: 404 y no lee nada', async () => {
    expect((await get('', 'play')).status).toBe(404);
    expect(r.leer).not.toHaveBeenCalled();
  });

  it('usuario normal ve el contexto pero no puede limpiar ni ve la orden', async () => {
    r.configurar.mockResolvedValue(false);
    const res = await get();
    const d = await res.json();
    expect(d.contexto.percent).toBe(87);
    expect(d.puedeLimpiar).toBe(false);
    expect(r.ultima).not.toHaveBeenCalled();
  });

  it('una conversación ajena no se usa para buscar la sesión', async () => {
    r.conversacion.mockResolvedValue(null);
    await get('?conversacion=99');
    expect(r.leer).toHaveBeenCalledWith(7, null);
  });

  it('admin: puede limpiar si hay contexto', async () => {
    const d = await (await get()).json();
    expect(d.puedeLimpiar).toBe(true);
    expect(r.leer).toHaveBeenCalledWith(7, 12);
  });
});

describe('POST limpiar contexto', () => {
  it('sin permiso de configurar: 403 y no crea orden', async () => {
    r.configurar.mockResolvedValue(false);
    expect((await post({ confirmar: true })).status).toBe(403);
    expect(r.crear).not.toHaveBeenCalled();
  });

  it('agente fuera de sus empresas auditables: 403', async () => {
    r.enAlcance.mockResolvedValue(false);
    expect((await post({ confirmar: true })).status).toBe(403);
  });

  it('sin confirmar: 400', async () => {
    expect((await post({})).status).toBe(400);
  });

  it('si el agente está trabajando: 409', async () => {
    r.ocupado.mockResolvedValue(true);
    expect((await post({ confirmar: true, conversacion: 12 })).status).toBe(409);
    expect(r.crear).not.toHaveBeenCalled();
  });

  it('sin contexto publicado: 409', async () => {
    r.leer.mockResolvedValue(null);
    expect((await post({ confirmar: true })).status).toBe(409);
  });

  it('crea la orden con el correo de la sesión (202); principal sin conversación', async () => {
    const res = await post({ confirmar: true, conversacion: 12 });
    expect(res.status).toBe(202);
    expect(r.crear).toHaveBeenCalledWith(expect.objectContaining({ idAgent: 7, requestedBy: 'admin@x', idConversation: null }));
  });

  it('ya hay una orden activa: 409 con la orden', async () => {
    r.crear.mockRejectedValue(new OrdenActiva({ id: 3, status: 'en_curso' } as unknown as OrdenDto));
    const res = await post({ confirmar: true });
    expect(res.status).toBe(409);
    expect((await res.json()).orden.id).toBe(3);
  });
});
