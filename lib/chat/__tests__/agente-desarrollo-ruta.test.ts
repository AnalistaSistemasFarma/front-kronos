import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Marca «Agente de desarrollo» (2026-11-11) — la reja del servidor:
 *   - sin sesión, 401; sin ser administrador, 403 y NO se toca la base;
 *   - el cuerpo debe traer esDesarrollo booleano;
 *   - un administrador la cambia y, si ya estaba igual, no escribe.
 */
const h = vi.hoisted(() => ({
  db: { agent: { findUnique: vi.fn(), update: vi.fn() } },
  sessionUser: vi.fn(),
  admin: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('../../../app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../prisma', () => ({ prisma: h.db }));
vi.mock('../../access-control', () => ({ checkAdminPrivileges: h.admin }));
vi.mock('../http', async (importOriginal) => {
  const real = await importOriginal<typeof import('../http')>();
  return { ...real, resolveSessionUser: h.sessionUser };
});

import { NextRequest } from 'next/server';
import { GET, PATCH } from '../../../app/api/chat/agents/[code]/desarrollo/route';

const params = (code = 'sirio') => ({ params: Promise.resolve({ code }) });
const patch = (body: unknown) =>
  new NextRequest('http://x/api/chat/agents/sirio/desarrollo', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  h.sessionUser.mockResolvedValue({ id: 'u1', email: 'admin@gsslatam.com' });
  h.admin.mockResolvedValue(true);
  h.db.agent.findUnique.mockResolvedValue({ id_agent: 5, display_name: 'Sirio', es_desarrollo: false });
});

describe('/api/chat/agents/[code]/desarrollo', () => {
  it('sin sesión responde 401', async () => {
    h.sessionUser.mockResolvedValue(null);
    expect((await PATCH(patch({ esDesarrollo: true }), params())).status).toBe(401);
    expect(h.db.agent.update).not.toHaveBeenCalled();
  });

  it('quien no es administrador recibe 403 y no se escribe nada', async () => {
    h.admin.mockResolvedValue(false);
    expect((await PATCH(patch({ esDesarrollo: true }), params())).status).toBe(403);
    expect((await GET(new Request('http://x'), params())).status).toBe(403);
    expect(h.db.agent.findUnique).not.toHaveBeenCalled();
    expect(h.db.agent.update).not.toHaveBeenCalled();
  });

  it('exige esDesarrollo booleano', async () => {
    expect((await PATCH(patch({ esDesarrollo: 'si' }), params())).status).toBe(400);
    expect(h.db.agent.update).not.toHaveBeenCalled();
  });

  it('agente inexistente: 404', async () => {
    h.db.agent.findUnique.mockResolvedValue(null);
    expect((await PATCH(patch({ esDesarrollo: true }), params('nadie'))).status).toBe(404);
  });

  it('un administrador lo marca y queda registrado', async () => {
    const res = await PATCH(patch({ esDesarrollo: true }), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, esDesarrollo: true });
    expect(h.db.agent.update).toHaveBeenCalledWith({ where: { id_agent: 5 }, data: { es_desarrollo: true } });
    expect(console.info).toHaveBeenCalled();
  });

  it('si ya tenía ese valor, no escribe', async () => {
    const res = await PATCH(patch({ esDesarrollo: false }), params());
    expect(res.status).toBe(200);
    expect(h.db.agent.update).not.toHaveBeenCalled();
  });

  it('GET devuelve la marca actual al administrador', async () => {
    h.db.agent.findUnique.mockResolvedValue({ es_desarrollo: true });
    const res = await GET(new Request('http://x'), params());
    expect(await res.json()).toEqual({ esDesarrollo: true });
  });
});
