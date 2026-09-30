import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSession = vi.hoisted(() => vi.fn());
const getCompanies = vi.hoisted(() => vi.fn());
const query = vi.hoisted(() => vi.fn());
const input = vi.hoisted(() => vi.fn());

vi.mock('next-auth', () => ({ getServerSession: getSession }));
vi.mock('../../../app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../paymentSchedulingAccess', () => ({ getPaymentSchedulingCompanies: getCompanies }));
vi.mock('../../../dbconfig', () => ({ default: {} }));
vi.mock('mssql', () => {
  const request = () => ({ input, query });
  return { default: { connect: vi.fn(async () => ({ request })), Int: 'Int', NVarChar: 'NVarChar', DateTime: 'DateTime' } };
});

import { GET } from '../../../app/api/payment-scheduling/route';

const call = (qs = '') => GET(new Request(`https://test.example/api/payment-scheduling${qs}`));

describe('GET /api/payment-scheduling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    query.mockResolvedValue({ recordset: [{ id_tarea: 1, id_empresa: 3 }] });
  });

  it('responde 401 sin sesión y no consulta la base', async () => {
    getSession.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(getCompanies).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('responde 403 si el usuario no tiene el subproceso Programador de Pagos', async () => {
    getSession.mockResolvedValue({ user: { email: 'sin.permiso@example.com' } });
    getCompanies.mockResolvedValue([]);
    const res = await call();
    expect(res.status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('responde 403 si pide una empresa fuera de su alcance', async () => {
    getSession.mockResolvedValue({ user: { email: 'tesoreria@example.com' } });
    getCompanies.mockResolvedValue([3]);
    const res = await call('?company=1');
    expect(res.status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('responde 200 con permiso y filtra por las empresas del usuario', async () => {
    getSession.mockResolvedValue({ user: { email: 'tesoreria@example.com' } });
    getCompanies.mockResolvedValue([1, 3]);
    const res = await call('?company=0');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id_tarea: 1, id_empresa: 3 }]);
    expect(getCompanies).toHaveBeenCalledWith('tesoreria@example.com');
    expect(query.mock.calls[0][0]).toContain('rg.id_company IN (@allowed_company_0, @allowed_company_1)');
    expect(input).toHaveBeenCalledWith('allowed_company_0', 'Int', 1);
    expect(input).toHaveBeenCalledWith('allowed_company_1', 'Int', 3);
  });
});
