import { beforeEach, describe, expect, it, vi } from 'vitest';

// Búsqueda de socios para firmantes Orion con sesión, base y SAP simulados.
// Hueco cerrado (PR #1083): el usuario solo puede consultar socios de una empresa a la que
// pertenece (company_user); si cambia `companyId` por otra empresa recibe 403 y no se toca SAP.

const { getServerSession, companyUserCount, sapEndpointsFindMany, sapLogin, withMssqlPool } = vi.hoisted(
  () => ({
    getServerSession: vi.fn(),
    companyUserCount: vi.fn(),
    sapEndpointsFindMany: vi.fn(),
    sapLogin: vi.fn(),
    withMssqlPool: vi.fn(),
  })
);

vi.mock('next-auth', () => ({ getServerSession }));
vi.mock('../../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    companyUser: { count: companyUserCount },
    sap_endpoints: { findMany: sapEndpointsFindMany },
  },
}));
vi.mock('@/lib/mssqlPool', () => ({ withMssqlPool, sql: { NVarChar: () => 'NVarChar' } }));
vi.mock('@/lib/sap/serviceLayer', () => {
  class SapError extends Error {
    constructor(
      message: string,
      public status: number
    ) {
      super(message);
    }
  }
  return { sapLogin, sapGet: vi.fn(), sapLogout: vi.fn(), SapError };
});

import { NextRequest } from 'next/server';
import { GET } from '../external-partners/route';

const EMAIL = 'preparador@gsslatam.com';

function get(query: string) {
  return GET(new NextRequest(`http://localhost/api/integrations/orion/external-partners?${query}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  getServerSession.mockResolvedValue({ user: { email: EMAIL } });
  withMssqlPool.mockResolvedValue([]);
  sapEndpointsFindMany.mockResolvedValue([]);
});

describe('GET /api/integrations/orion/external-partners', () => {
  it('sin sesión responde 401', async () => {
    getServerSession.mockResolvedValue(null);
    const res = await get('companyId=1&q=acme');
    expect(res.status).toBe(401);
    expect(companyUserCount).not.toHaveBeenCalled();
  });

  it('companyId inválido responde 400', async () => {
    for (const query of ['q=acme', 'companyId=abc&q=acme', 'companyId=-3&q=acme', 'companyId=1.5&q=acme']) {
      const res = await get(query);
      expect(res.status).toBe(400);
    }
    expect(companyUserCount).not.toHaveBeenCalled();
  });

  it('usuario que no pertenece a la empresa recibe 403 y no se consulta SAP ni usuarios', async () => {
    companyUserCount.mockResolvedValue(0);
    const res = await get('companyId=99&q=acme');
    expect(res.status).toBe(403);
    expect(companyUserCount).toHaveBeenCalledWith({
      where: { id_company: 99, user: { email: EMAIL, isActive: true, NOT: { role: 'supplier' } } },
    });
    expect(sapEndpointsFindMany).not.toHaveBeenCalled();
    expect(sapLogin).not.toHaveBeenCalled();
    expect(withMssqlPool).not.toHaveBeenCalled();
  });

  it('usuario de la empresa puede buscar (la pertenencia sale de la sesión, no del cliente)', async () => {
    companyUserCount.mockResolvedValue(1);
    const res = await get('companyId=7&q=acme');
    expect(res.status).toBe(200);
    expect(companyUserCount).toHaveBeenCalledWith({
      where: { id_company: 7, user: { email: EMAIL, isActive: true, NOT: { role: 'supplier' } } },
    });
    expect(sapEndpointsFindMany).toHaveBeenCalledWith({ where: { id_company: 7 } });
    const body = await res.json();
    expect(body.options).toEqual([]);
  });

  it('usuario proveedor (rol supplier) de la empresa recibe 403: el conteo lo excluye', async () => {
    // Prisma aplica NOT role 'supplier' en el where; simulamos que no queda ninguna fila.
    companyUserCount.mockResolvedValue(0);
    const res = await get('companyId=7&q=acme');
    expect(res.status).toBe(403);
    const where = companyUserCount.mock.calls[0]![0].where;
    expect(where.user.NOT).toEqual({ role: 'supplier' });
    expect(sapLogin).not.toHaveBeenCalled();
  });
});
