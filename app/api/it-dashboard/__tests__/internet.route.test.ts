import { beforeEach, describe, expect, it, vi } from 'vitest';

// Dashboard TI Proveedores → Internet (several channels per company): session, access and DB are mocked.

const m = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  canViewItDashboard: vi.fn(),
  loadInternet: vi.fn(),
  loadAllowedCompanies: vi.fn(),
  findAllowedCompany: vi.fn(),
  createInternet: vi.fn(),
  loadInternetById: vi.fn(),
  updateInternet: vi.fn(),
  deleteInternet: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/it-dashboard/access', () => ({ canViewItDashboard: m.canViewItDashboard }));
vi.mock('../../../../lib/it-dashboard/internetDb', () => ({
  loadInternet: m.loadInternet,
  loadAllowedCompanies: m.loadAllowedCompanies,
  findAllowedCompany: m.findAllowedCompany,
  createInternet: m.createInternet,
  loadInternetById: m.loadInternetById,
  updateInternet: m.updateInternet,
  deleteInternet: m.deleteInternet,
}));

import { GET, POST } from '../internet/route';
import { DELETE, PUT } from '../internet/[id]/route';

const EMAIL = 'cristian.baldion@gsslatam.com';
const req = (method: string, body?: unknown, q = '') =>
  new Request(`http://x/api/it-dashboard/internet${q}`, { method, body: body ? JSON.stringify(body) : undefined });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
  m.canViewItDashboard.mockResolvedValue(true);
  m.loadInternet.mockResolvedValue([{ id: 1, companyId: 8 }]);
  m.loadAllowedCompanies.mockResolvedValue([{ id: 8, name: 'GSS' }]);
  m.findAllowedCompany.mockResolvedValue('GSS');
  m.createInternet.mockResolvedValue({ id: 2, companyId: 8 });
  m.loadInternetById.mockResolvedValue({ id: 1, companyId: 8 });
  m.updateInternet.mockResolvedValue({ id: 1, companyId: 8 });
  m.deleteInternet.mockResolvedValue(true);
});

describe('/api/it-dashboard/internet', () => {
  it('guards: 401 and 403; nothing is written', async () => {
    m.getServerSession.mockResolvedValueOnce(null);
    expect((await GET(req('GET'))).status).toBe(401);
    m.canViewItDashboard.mockResolvedValueOnce(false);
    expect((await POST(req('POST', { companyId: 8, provider: 'ETB' }))).status).toBe(403);
    m.canViewItDashboard.mockResolvedValueOnce(false);
    expect((await DELETE(req('DELETE'), ctx('1'))).status).toBe(403);
    expect(m.createInternet).not.toHaveBeenCalled();
    expect(m.deleteInternet).not.toHaveBeenCalled();
  });

  it('GET returns the channels and the companies', async () => {
    const res = await GET(req('GET', undefined, '?company=8'));
    expect(res.status).toBe(200);
    expect(m.loadInternet).toHaveBeenCalledWith(8);
    const body = await res.json();
    expect(body.companies).toEqual([{ id: 8, name: 'GSS' }]);
  });

  it('POST adds a channel (validates company and fields)', async () => {
    expect((await POST(req('POST', { provider: 'ETB' }))).status).toBe(400);
    expect((await POST(req('POST', { companyId: 8 }))).status).toBe(400);
    const ok = await POST(req('POST', { companyId: 8, provider: 'ETB', bandwidth: '100 Mbps' }));
    expect(ok.status).toBe(201);
    expect(m.createInternet).toHaveBeenCalledWith(8, expect.objectContaining({ provider: 'ETB' }), EMAIL);
  });

  it('PUT and DELETE by record id', async () => {
    expect((await PUT(req('PUT', { provider: 'ETB' }), ctx('x'))).status).toBe(400);
    m.loadInternetById.mockResolvedValueOnce(null);
    expect((await PUT(req('PUT', { provider: 'ETB' }), ctx('9'))).status).toBe(404);
    expect((await PUT(req('PUT', { provider: 'ETB' }), ctx('1'))).status).toBe(200);
    expect(m.updateInternet).toHaveBeenCalledWith(1, expect.objectContaining({ provider: 'ETB' }), EMAIL);

    m.deleteInternet.mockResolvedValueOnce(false);
    expect((await DELETE(req('DELETE'), ctx('9'))).status).toBe(404);
    expect((await DELETE(req('DELETE'), ctx('1'))).status).toBe(200);
  });
});
