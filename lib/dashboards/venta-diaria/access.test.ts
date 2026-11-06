import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findMany, findFirst } = vi.hoisted(() => ({ findMany: vi.fn(), findFirst: vi.fn() }));
vi.mock('../../prisma', () => ({ prisma: { subprocessUserCompany: { findMany, findFirst } } }));

import { accesoVentaDiaria, endpointListo, getVentaDiariaEmpresas, VENTA_DIARIA_URL } from './access';
import { getDashboardsPermitidos } from '../acceso';
import { dashboardsPermitidos } from '../registro';

const ep = (over: Partial<Record<string, unknown>> = {}) => ({
  base_url: 'https://sl.example:50000',
  username: 'u',
  password: 'p',
  client: 'DB',
  is_active: true,
  ...over,
});

beforeEach(() => {
  findMany.mockReset();
  findFirst.mockReset();
});

describe('accesoVentaDiaria', () => {
  it('sin fila de permiso en la empresa → no permitido (fail-closed)', async () => {
    findFirst.mockResolvedValue(null);
    expect(await accesoVentaDiaria('a@b.com', 3)).toEqual({ permitido: false });
    const where = findFirst.mock.calls[0][0].where;
    expect(where.subprocess.subprocess_url).toBe(VENTA_DIARIA_URL);
    expect(where.companyUser).toEqual({ user: { email: 'a@b.com' }, id_company: 3 });
  });

  it('empresa fuera de la lista ni consulta la base', async () => {
    expect(await accesoVentaDiaria('a@b.com', 999)).toEqual({ permitido: false });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('con permiso devuelve el endpoint activo', async () => {
    findFirst.mockResolvedValue({ companyUser: { company: { sap_endpoints: [ep({ is_active: false, client: 'X' }), ep()] } } });
    const r = await accesoVentaDiaria('a@b.com', 3);
    expect(r).toEqual({ permitido: true, endpoint: { baseUrl: 'https://sl.example:50000', username: 'u', password: 'p', companyDB: 'DB' } });
  });

  it('con permiso pero sin Service Layer activo → endpoint null', async () => {
    findFirst.mockResolvedValue({ companyUser: { company: { sap_endpoints: [ep({ is_active: false })] } } });
    expect(await accesoVentaDiaria('a@b.com', 3)).toEqual({ permitido: true, endpoint: null });
  });
});

describe('getVentaDiariaEmpresas', () => {
  it('lista solo las empresas asignadas, en orden y sin credenciales', async () => {
    findMany.mockResolvedValue([
      { companyUser: { company: { id_company: 3, company: 'ONELATAMPHARMA ', sap_endpoints: [ep()] } } },
      { companyUser: { company: { id_company: 1, company: 'FARMALOGICA S.A.', sap_endpoints: [ep({ client: null })] } } },
    ]);
    const r = await getVentaDiariaEmpresas('a@b.com');
    expect(r).toEqual([
      { id: 1, nombre: 'FARMALOGICA S.A.', lista: false },
      { id: 3, nombre: 'ONELATAMPHARMA', lista: true },
    ]);
    expect(JSON.stringify(r)).not.toContain('password');
  });

  it('sin asignaciones → lista vacía', async () => {
    findMany.mockResolvedValue([]);
    expect(await getVentaDiariaEmpresas('a@b.com')).toEqual([]);
  });
});

describe('menú: dashboards permitidos', () => {
  it('solo aparece el dashboard cuyo subproceso está otorgado', async () => {
    expect(dashboardsPermitidos(['/process/sales'])).toEqual([]);
    findMany.mockResolvedValue([{ subprocess: { subprocess_url: VENTA_DIARIA_URL } }]);
    expect(await getDashboardsPermitidos('a@b.com')).toEqual(['venta-diaria']);
  });

  it('endpointListo exige activo, URL y CompanyDB', () => {
    expect(endpointListo([])).toBeNull();
    expect(endpointListo([ep({ base_url: '' })])).toBeNull();
  });
});
