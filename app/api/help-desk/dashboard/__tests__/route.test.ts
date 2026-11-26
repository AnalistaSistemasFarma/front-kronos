import { beforeEach, describe, expect, it, vi } from 'vitest';

// Dashboard Helpdesk (2026-11-18): session, subprocess access and DB are mocked.

const m = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  canViewHelpdeskDashboard: vi.fn(),
  loadHelpdeskCaseRows: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../../lib/help-desk/dashboard/access', () => ({
  canViewHelpdeskDashboard: m.canViewHelpdeskDashboard,
}));
vi.mock('../../../../../lib/help-desk/dashboard/db', () => ({
  loadHelpdeskCaseRows: m.loadHelpdeskCaseRows,
}));

import { GET } from '../route';

const EMAIL = 'cristian.baldion@gsslatam.com';
const get = (q = '') => new Request(`http://x/api/help-desk/dashboard${q}`);

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
  m.canViewHelpdeskDashboard.mockResolvedValue(true);
  m.loadHelpdeskCaseRows.mockResolvedValue([
    {
      id: 1,
      createdAt: new Date('2026-01-10T00:00:00.000Z'),
      endDate: null,
      statusId: 1,
      status: 'Abierto',
      caseType: 'Solicitud',
      companyId: 8,
      company: 'GSS',
      department: 'GERENCIA',
      technician: null,
      category: 'Hardware\r\n',
      subcategory: 'Portátil',
      activity: 'Revisión',
    },
  ]);
});

describe('GET /api/help-desk/dashboard', () => {
  it('401 without session and 403 without the subprocess; the DB is not queried', async () => {
    m.getServerSession.mockResolvedValue(null);
    expect((await GET(get())).status).toBe(401);

    m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
    m.canViewHelpdeskDashboard.mockResolvedValue(false);
    const res = await GET(get());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Dashboard Helpdesk/);
    expect(m.loadHelpdeskCaseRows).not.toHaveBeenCalled();
  });

  it('returns aggregates only (no case text) and applies the filters', async () => {
    const res = await GET(get('?company=8&year=2026&month=1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(m.canViewHelpdeskDashboard).toHaveBeenCalledWith(EMAIL);
    expect(body.filters).toEqual({ companyId: 8, year: 2026, month: 1 });
    expect(body.kpis.total).toBe(1);
    expect(body.byCategory).toEqual([{ name: 'Hardware', total: 1 }]);
    expect(JSON.stringify(body)).not.toMatch(/subject|description|resolution"/);
  });

  it('500 with a generic message when the query fails', async () => {
    m.loadHelpdeskCaseRows.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await GET(get());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/indicadores/);
  });
});
