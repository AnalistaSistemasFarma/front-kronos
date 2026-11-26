import { beforeEach, describe, expect, it, vi } from 'vitest';

// Dashboard TI (2026-11-26): session, subprocess access and DB are mocked.

const m = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  canViewItDashboard: vi.fn(),
  loadItAssetRows: vi.fn(),
  loadItCatalog: vi.fn(),
  loadItAssetList: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/it-dashboard/access', () => ({ canViewItDashboard: m.canViewItDashboard }));
vi.mock('../../../../lib/it-dashboard/db', () => ({
  loadItAssetRows: m.loadItAssetRows,
  loadItCatalog: m.loadItCatalog,
  loadItAssetList: m.loadItAssetList,
}));

import { GET } from '../route';
import { GET as GET_ASSETS } from '../assets/route';

const EMAIL = 'cristian.baldion@gsslatam.com';
const get = (q = '') => new Request(`http://x/api/it-dashboard${q}`);
const getAssets = (q = '') => new Request(`http://x/api/it-dashboard/assets${q}`);

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
  m.canViewItDashboard.mockResolvedValue(true);
  m.loadItAssetRows.mockResolvedValue([
    { id: 1, companyId: 8, company: 'GSS', typeId: 1, type: 'COMPUTADORES', statusId: 1, status: 'En uso', cost: 1500 },
    { id: 2, companyId: 2, company: 'RYAN', typeId: 10, type: 'DVR', statusId: 2, status: 'Baja', cost: 100 },
  ]);
  m.loadItCatalog.mockResolvedValue({
    companies: [
      { id: 2, name: 'RYAN' },
      { id: 8, name: 'GSS' },
    ],
    types: [
      { id: 1, name: 'COMPUTADORES' },
      { id: 10, name: 'DVR' },
    ],
  });
  m.loadItAssetList.mockResolvedValue([{ id: 1, name: 'PC-01' }]);
});

describe('GET /api/it-dashboard', () => {
  it('401 without session and 403 without the subprocess; the DB is not queried', async () => {
    m.getServerSession.mockResolvedValue(null);
    expect((await GET(get())).status).toBe(401);
    expect((await GET_ASSETS(getAssets())).status).toBe(401);

    m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
    m.canViewItDashboard.mockResolvedValue(false);
    const res = await GET(get());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Dashboard TI/);
    expect((await GET_ASSETS(getAssets())).status).toBe(403);
    expect(m.loadItAssetRows).not.toHaveBeenCalled();
    expect(m.loadItAssetList).not.toHaveBeenCalled();
  });

  it('returns counts per company and type, without retired assets by default', async () => {
    const res = await GET(get('?company=8'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(m.canViewItDashboard).toHaveBeenCalledWith(EMAIL);
    expect(body.filters).toEqual({ companyId: 8, includeRetired: false });
    expect(body.kpis.total).toBe(1);
    expect(body.allCompaniesTotal).toBe(1);
    expect(body.types).toEqual([
      { id: 1, name: 'COMPUTADORES', total: 1 },
      { id: 10, name: 'DVR', total: 0 },
    ]);
  });

  it('500 with a generic message when the query fails', async () => {
    m.loadItAssetRows.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await GET(get());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/inventario/);
  });
});

describe('GET /api/it-dashboard/assets', () => {
  it('passes company, type and includeRetired to the list query', async () => {
    const res = await GET_ASSETS(getAssets('?company=8&type=1&includeRetired=1'));
    expect(res.status).toBe(200);
    expect(m.loadItAssetList).toHaveBeenCalledWith({ companyId: 8, typeId: 1, includeRetired: true });
    const body = await res.json();
    expect(body.assets).toEqual([{ id: 1, name: 'PC-01' }]);
    expect(body.truncated).toBe(false);
  });
});
