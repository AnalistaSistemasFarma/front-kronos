import { beforeEach, describe, expect, it, vi } from 'vitest';

// Dashboard TI «Software» (2026-11-27): session, access and DB are mocked.

const m = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  canViewItDashboard: vi.fn(),
  findAllowedCompany: vi.fn(),
  loadSoftware: vi.fn(),
  loadSoftwareById: vi.fn(),
  createSoftware: vi.fn(),
  updateSoftware: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/it-dashboard/access', () => ({ canViewItDashboard: m.canViewItDashboard }));
vi.mock('../../../../lib/it-dashboard/internetDb', () => ({ findAllowedCompany: m.findAllowedCompany }));
vi.mock('../../../../lib/it-dashboard/softwareDb', () => ({
  loadSoftware: m.loadSoftware,
  loadSoftwareById: m.loadSoftwareById,
  createSoftware: m.createSoftware,
  updateSoftware: m.updateSoftware,
}));

import { GET, POST } from '../software/route';
import { PUT } from '../software/[id]/route';

const EMAIL = 'cristian.baldion@gsslatam.com';
const body = { companyId: 8, kind: 'software', description: 'Microsoft 365', licenseType: 'anual' };
const req = (method: string, data?: unknown, q = '') =>
  new Request(`http://x/api/it-dashboard/software${q}`, { method, body: data ? JSON.stringify(data) : undefined });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
  m.canViewItDashboard.mockResolvedValue(true);
  m.findAllowedCompany.mockResolvedValue('GSS');
  m.loadSoftware.mockResolvedValue([{ id: 1 }]);
  m.loadSoftwareById.mockResolvedValue({ id: 5 });
  m.createSoftware.mockResolvedValue({ id: 6 });
  m.updateSoftware.mockResolvedValue({ id: 5 });
});

describe('/api/it-dashboard/software', () => {
  it('guards: 401 and 403; nothing is written', async () => {
    m.getServerSession.mockResolvedValueOnce(null);
    expect((await GET(req('GET'))).status).toBe(401);
    m.canViewItDashboard.mockResolvedValueOnce(false);
    expect((await POST(req('POST', body))).status).toBe(403);
    m.canViewItDashboard.mockResolvedValueOnce(false);
    expect((await PUT(req('PUT', body), ctx('5'))).status).toBe(403);
    expect(m.createSoftware).not.toHaveBeenCalled();
    expect(m.updateSoftware).not.toHaveBeenCalled();
  });

  it('GET filters by company when given', async () => {
    await GET(req('GET', undefined, '?company=8'));
    expect(m.loadSoftware).toHaveBeenCalledWith(8);
    await GET(req('GET'));
    expect(m.loadSoftware).toHaveBeenLastCalledWith(null);
  });

  it('POST validates, checks the company and creates with the user email', async () => {
    expect((await POST(req('POST', { ...body, description: '' }))).status).toBe(400);
    m.findAllowedCompany.mockResolvedValueOnce(null);
    expect((await POST(req('POST', body))).status).toBe(400);

    const ok = await POST(req('POST', body));
    expect(ok.status).toBe(201);
    expect(m.createSoftware).toHaveBeenCalledWith(expect.objectContaining({ companyId: 8, description: 'Microsoft 365' }), EMAIL);
  });

  it('PUT: 400 bad id, 404 unknown, 200 saves', async () => {
    expect((await PUT(req('PUT', body), ctx('x'))).status).toBe(400);
    m.loadSoftwareById.mockResolvedValueOnce(null);
    expect((await PUT(req('PUT', body), ctx('9'))).status).toBe(404);
    const ok = await PUT(req('PUT', body), ctx('5'));
    expect(ok.status).toBe(200);
    expect(m.updateSoftware).toHaveBeenCalledWith(5, expect.objectContaining({ licenseType: 'anual' }), EMAIL);
  });
});
