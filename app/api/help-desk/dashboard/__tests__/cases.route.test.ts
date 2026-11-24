import { beforeEach, describe, expect, it, vi } from 'vitest';

// Dashboard Helpdesk, KPI drill-down (2026-11-24): session, subprocess access and DB are mocked.

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

import { GET } from '../cases/route';

const EMAIL = 'cristian.baldion@gsslatam.com';
const get = (q = '') => new Request(`http://x/api/help-desk/dashboard/cases${q}`);

const base = {
  caseType: 'Solicitud',
  company: 'GSS',
  department: 'GERENCIA',
  technician: 'Rafael Solarte',
  category: 'Hardware',
  subcategory: 'Portátil',
  activity: 'Revisión',
};

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
  m.canViewHelpdeskDashboard.mockResolvedValue(true);
  m.loadHelpdeskCaseRows.mockResolvedValue([
    { ...base, id: 1, subject: 'Impresora', createdAt: new Date('2026-01-10T00:00:00Z'), endDate: null, statusId: 1, status: 'Abierto', companyId: 8 },
    { ...base, id: 2, subject: 'Correo', createdAt: new Date('2026-01-11T00:00:00Z'), endDate: new Date('2026-01-12T00:00:00Z'), statusId: 2, status: 'Resuelto', companyId: 8 },
    { ...base, id: 3, subject: 'Equipo', createdAt: new Date('2026-01-12T00:00:00Z'), endDate: null, statusId: 1, status: 'Abierto', companyId: 1 },
  ]);
});

describe('GET /api/help-desk/dashboard/cases', () => {
  it('401 without session, 403 without the subprocess and 400 with an unknown bucket; the DB is not queried', async () => {
    m.getServerSession.mockResolvedValue(null);
    expect((await GET(get('?bucket=all'))).status).toBe(401);

    m.getServerSession.mockResolvedValue({ user: { email: EMAIL } });
    m.canViewHelpdeskDashboard.mockResolvedValue(false);
    expect((await GET(get('?bucket=all'))).status).toBe(403);

    m.canViewHelpdeskDashboard.mockResolvedValue(true);
    expect((await GET(get('?bucket=nope'))).status).toBe(400);
    expect(m.loadHelpdeskCaseRows).not.toHaveBeenCalled();
  });

  it('returns the cases of the bucket with the filters, loading the subject', async () => {
    const res = await GET(get('?bucket=pending&company=8&year=2026&month=1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(m.loadHelpdeskCaseRows).toHaveBeenCalledWith({ withSubject: true });
    const body = await res.json();
    expect(body.bucket).toBe('pending');
    expect(body.total).toBe(1);
    expect(body.cases.map((c: { id: number; subject: string }) => [c.id, c.subject])).toEqual([[1, 'Impresora']]);
  });

  it('500 with a generic message when the query fails', async () => {
    m.loadHelpdeskCaseRows.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await GET(get('?bucket=all'));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/detalle/);
  });
});
