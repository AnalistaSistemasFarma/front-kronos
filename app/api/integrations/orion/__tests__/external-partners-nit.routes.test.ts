import { beforeEach, describe, expect, it, vi } from 'vitest';

// Partner search by NIT (FederalTaxID, PR #1083) on top of the company-membership check (#1104):
// the NIT filter only ever runs against the SAP endpoint of a company the session user belongs to.

const {
  getServerSession,
  companyUserCount,
  sapEndpointsFindMany,
  sapLogin,
  sapGet,
  sapLogout,
  withMssqlPool,
} = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  companyUserCount: vi.fn(),
  sapEndpointsFindMany: vi.fn(),
  sapLogin: vi.fn(),
  sapGet: vi.fn(),
  sapLogout: vi.fn(),
  withMssqlPool: vi.fn(),
}));

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
  return { sapLogin, sapGet, sapLogout, SapError };
});

import { NextRequest } from 'next/server';
import { GET } from '../external-partners/route';
import { SapError } from '@/lib/sap/serviceLayer';

const EMAIL = 'preparador@gsslatam.com';
const NIT = '900123456';

function get(query: string) {
  return GET(new NextRequest(`http://localhost/api/integrations/orion/external-partners?${query}`));
}

function decodedFilter(path: string): string {
  const raw = path.split('$filter=')[1]!.split('&$select=')[0]!;
  return decodeURIComponent(raw);
}

beforeEach(() => {
  vi.clearAllMocks();
  getServerSession.mockResolvedValue({ user: { email: EMAIL } });
  withMssqlPool.mockResolvedValue([]);
  sapEndpointsFindMany.mockResolvedValue([
    { id_company: 7, is_active: true, base_url: 'https://sap-7', username: 'u', password: 'p', client: 'DB7' },
  ]);
  sapLogin.mockResolvedValue({ sessionId: 's' });
});

describe('GET /api/integrations/orion/external-partners — NIT search', () => {
  it('a NIT query for a company the user does not belong to returns 403 without touching SAP', async () => {
    companyUserCount.mockResolvedValue(0);
    const res = await get(`companyId=99&q=${NIT}`);
    expect(res.status).toBe(403);
    expect(sapEndpointsFindMany).not.toHaveBeenCalled();
    expect(sapLogin).not.toHaveBeenCalled();
    expect(sapGet).not.toHaveBeenCalled();
  });

  it('a member searches by NIT only in the SAP endpoint of that company', async () => {
    companyUserCount.mockResolvedValue(1);
    sapGet.mockResolvedValue({
      value: [
        {
          CardCode: 'P001',
          CardName: 'ACME SAS',
          CardType: 'cSupplier',
          EmailAddress: 'firmas@acme.com',
          FederalTaxID: NIT,
          ContactEmployees: [],
        },
      ],
    });
    const res = await get(`companyId=7&q=${NIT}`);
    expect(res.status).toBe(200);
    expect(sapEndpointsFindMany).toHaveBeenCalledWith({ where: { id_company: 7 } });
    expect(sapLogin).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: 'https://sap-7', companyDB: 'DB7' }));
    const path = String(sapGet.mock.calls[0]![1]);
    expect(decodedFilter(path)).toContain(`contains(FederalTaxID,'${NIT}')`);
    expect(path).toContain('FederalTaxID');
    const body = await res.json();
    expect(body.options).toEqual([
      expect.objectContaining({ cardCode: 'P001', email: 'firmas@acme.com', source: 'sap' }),
    ]);
    expect(sapLogout).toHaveBeenCalled();
  });

  it('falls back without the FE mail field and then without FederalTaxID when SAP answers 400', async () => {
    companyUserCount.mockResolvedValue(1);
    sapGet
      .mockRejectedValueOnce(new SapError('bad field', 400))
      .mockRejectedValueOnce(new SapError('bad field', 400))
      .mockResolvedValueOnce({ value: [] });
    const res = await get(`companyId=7&q=${NIT}`);
    expect(res.status).toBe(200);
    expect(sapGet).toHaveBeenCalledTimes(3);
    const [first, second, third] = sapGet.mock.calls.map((c) => decodedFilter(String(c[1])));
    expect(first).toContain('FederalTaxID');
    expect(first).toContain('U_HBT_MailRecep_FE');
    expect(second).toContain('FederalTaxID');
    expect(second).not.toContain('U_HBT_MailRecep_FE');
    expect(third).not.toContain('FederalTaxID');
    expect(third).not.toContain('U_HBT_MailRecep_FE');
  });

  it('a non-400 SAP error is reported as sapError and is not retried', async () => {
    companyUserCount.mockResolvedValue(1);
    sapGet.mockRejectedValueOnce(new SapError('SAP down', 503));
    const res = await get(`companyId=7&q=${NIT}`);
    expect(res.status).toBe(200);
    expect(sapGet).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.sapError).toContain('SAP down');
  });
});
