import { beforeEach, describe, expect, it, vi } from 'vitest';

// Prueba de la ruta GET /api/sgc/access con la sesión y la base simuladas.
// La integración contra un SQL Server real vive en tests/integration/sgc.

const { getServerSession, getSgcAccessForUser } = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getSgcAccessForUser: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { marker: 'prisma-de-la-app' } }));
vi.mock('../../../../lib/sgc/access', () => ({ getSgcAccessForUser }));

import { GET } from '../access/route';

describe('GET /api/sgc/access', () => {
  beforeEach(() => {
    getServerSession.mockReset();
    getSgcAccessForUser.mockReset();
  });

  it('[SGC-REQ-007] sin sesión responde 401 y no consulta la base', async () => {
    getServerSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(getSgcAccessForUser).not.toHaveBeenCalled();
  });

  it('[SGC-REQ-007] con sesión resuelve el acceso con el correo de la sesión y no se cachea', async () => {
    getServerSession.mockResolvedValue({ user: { email: 'calidad@onelatampharma.com' } });
    const companies = [
      { idCompany: 3, companyName: 'ONELATAMPHARMA', canRead: true, canManage: false, canQuality: true, canAdminFlows: false },
    ];
    getSgcAccessForUser.mockResolvedValue(companies);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(await res.json()).toEqual({ companies });
    expect(getSgcAccessForUser).toHaveBeenCalledWith({ marker: 'prisma-de-la-app' }, 'calidad@onelatampharma.com');
  });

  it('[SGC-REQ-007] si la base falla responde 500 sin filtrar el detalle del error', async () => {
    getServerSession.mockResolvedValue({ user: { email: 'x@gsslatam.com' } });
    getSgcAccessForUser.mockRejectedValue(new Error('Login failed for user secreto'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('secreto');
    spy.mockRestore();
  });
});
