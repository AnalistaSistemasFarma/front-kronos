import { beforeEach, describe, expect, it, vi } from 'vitest';

// GET /api/correo/no-leidos (icono de la cabecera): 401 sin sesión, 403 sin el
// permiso del módulo, 200 con solo un número, sin caché HTTP.

const m = vi.hoisted(() => ({ getServerSession: vi.fn(), getCorreoAccess: vi.fn(), correoDeps: vi.fn() }));

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { tag: 'prisma' } }));
vi.mock('../../../../lib/correo/runtime', () => ({ correoDeps: m.correoDeps }));
vi.mock('../../../../lib/correo/db', () => ({ getCorreoAccess: m.getCorreoAccess }));

import { readCorreoConfig } from '../../../../lib/correo/config';
import { limpiarCacheNoLeidos } from '../../../../lib/correo/noLeidos';
import { GET } from '../no-leidos/route';

let n = 0;
const req = () => new Request('http://x/api/correo/no-leidos', { headers: { 'x-forwarded-for': '10.0.0.9' } });

beforeEach(() => {
  vi.clearAllMocks();
  limpiarCacheNoLeidos();
  m.correoDeps.mockImplementation(() => ({ cfg: readCorreoConfig({ CORREO_MODO: 'mock' }), dominiosGrupo: [] }));
});

describe('GET /api/correo/no-leidos', () => {
  it('401 sin sesión', async () => {
    m.getServerSession.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(m.getCorreoAccess).not.toHaveBeenCalled();
  });

  it('403 sin el permiso del módulo (el icono no se muestra)', async () => {
    m.getServerSession.mockResolvedValue({ user: { email: 'sin@gsslatam.com' } });
    m.getCorreoAccess.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(403);
  });

  it('200 con el permiso: solo el número, sin caché HTTP', async () => {
    m.getServerSession.mockResolvedValue({ user: { email: 'laura@gsslatam.com' } });
    m.getCorreoAccess.mockResolvedValue({ idUser: `u-${++n}`, nombre: 'Laura', email: 'laura@gsslatam.com', empresas: [{ idCompany: 1, companyName: 'GSS' }], empresasSolicitud: [] });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const body = await res.json();
    expect(Object.keys(body)).toEqual(['noLeidos']);
    expect(typeof body.noLeidos).toBe('number');
  });

  it('con el módulo apagado: 200 con noLeidos null (icono sin número)', async () => {
    m.correoDeps.mockImplementation(() => ({ cfg: readCorreoConfig({ CORREO_MODO: 'off' }), dominiosGrupo: [] }));
    m.getServerSession.mockResolvedValue({ user: { email: 'laura@gsslatam.com' } });
    m.getCorreoAccess.mockResolvedValue({ idUser: `u-${++n}`, nombre: 'Laura', email: 'laura@gsslatam.com', empresas: [{ idCompany: 1, companyName: 'GSS' }], empresasSolicitud: [] });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ noLeidos: null });
  });
});
