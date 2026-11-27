import { beforeEach, describe, expect, it, vi } from 'vitest';

// Dashboard TI «Internet» card (2026-11-26): session, access and DB are mocked.

const m = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  canViewItDashboard: vi.fn(),
  loadCompanyInternet: vi.fn(),
  findAllowedCompany: vi.fn(),
  saveCompanyInternet: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/it-dashboard/access', () => ({ canViewItDashboard: m.canViewItDashboard }));
vi.mock('../../../../lib/it-dashboard/internetDb', () => ({
  loadCompanyInternet: m.loadCompanyInternet,
  findAllowedCompany: m.findAllowedCompany,
  saveCompanyInternet: m.saveCompanyInternet,
}));

import { GET } from '../internet/route';
import { PUT } from '../internet/[companyId]/route';

const EMAIL = 'cristian.baldion@gsslatam.com';
const ctx = (companyId: string) => ({ params: Promise.resolve({ companyId }) });
const put = (body: unknown) =>
  new Request('http://x/api/it-dashboard/internet/8', { method: 'PUT', body: JSON.stringify(body) });

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
  m.canViewItDashboard.mockResolvedValue(true);
  m.loadCompanyInternet.mockResolvedValue([{ companyId: 8, company: 'GSS', registered: false }]);
  m.findAllowedCompany.mockResolvedValue('GSS');
  m.saveCompanyInternet.mockResolvedValue({ companyId: 8, company: 'GSS', registered: true });
});

describe('/api/it-dashboard/internet', () => {
  it('GET: 401 / 403 and the list', async () => {
    m.getServerSession.mockResolvedValueOnce(null);
    expect((await GET()).status).toBe(401);
    m.canViewItDashboard.mockResolvedValueOnce(false);
    expect((await GET()).status).toBe(403);

    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).companies).toHaveLength(1);
  });

  it('PUT: guards, validation and save with the user email', async () => {
    m.canViewItDashboard.mockResolvedValueOnce(false);
    expect((await PUT(put({}), ctx('8'))).status).toBe(403);
    expect((await PUT(put({}), ctx('x'))).status).toBe(400);
    m.findAllowedCompany.mockResolvedValueOnce(null);
    expect((await PUT(put({}), ctx('4'))).status).toBe(404);

    const bad = await PUT(put({ channelType: 'satelital' }), ctx('8'));
    expect(bad.status).toBe(400);
    expect((await bad.json()).fields.channelType).toBeTruthy();
    expect(m.saveCompanyInternet).not.toHaveBeenCalled();

    const ok = await PUT(put({ provider: 'Claro', channelType: 'dedicado', connectionType: 'fibra' }), ctx('8'));
    expect(ok.status).toBe(200);
    expect(m.saveCompanyInternet).toHaveBeenCalledWith(
      8,
      expect.objectContaining({ provider: 'Claro', channelType: 'dedicado', connectionType: 'fibra' }),
      EMAIL
    );
  });
});
