import { describe, expect, it, vi } from 'vitest';
import { armarCatalogo, catalogoCreacionEmpresa, SQL_CATEGORIAS_CREACION, SQL_PROCESOS_CREACION } from '../catalogoCreacion';

// Regla de «Nueva solicitud» compartida con el módulo Correo.
const cats = [
  { id: 44, category: 'Gerencia Tecnica' },
  { id: 52, category: 'Tesoreria' },
  { id: 60, category: 'FIRMA' },
];
const procs = [
  { id_process: 87, process: 'Gestión de Artes', id_category_request: 44, category: 'Gerencia Tecnica', description: null, active: 0 },
  { id_process: 102, process: 'Solicitud de Pago', id_category_request: 52, category: 'Tesoreria', description: 'Pagos a terceros', active: 1 },
  { id_process: 103, process: 'Anticipos', id_category_request: 52, category: 'Tesoreria', description: null, active: true },
  { id_process: 104, process: 'Pago inactivo', id_category_request: 52, category: 'Tesoreria', description: null, active: null },
  { id_process: 200, process: 'Contratos', id_category_request: 70, category: 'Jurídica', description: null, active: 1 },
  { id_process: 300, process: 'Firma digital', id_category_request: 60, category: 'FIRMA', description: null, active: 1 },
];

describe('catálogo de creación de solicitudes', () => {
  it('categorías de la empresa y solo procesos activos de esas categorías; oculta el leftover FIRMA', () => {
    const c = armarCatalogo(cats, procs);
    expect(c.categorias).toEqual([
      { id: 44, categoria: 'Gerencia Tecnica' },
      { id: 52, categoria: 'Tesoreria' },
    ]);
    expect(c.procesos.map((p) => p.id)).toEqual([103, 102]);
    expect(c.procesos[1]).toEqual({ id: 102, nombre: 'Solicitud de Pago', descripcion: 'Pagos a terceros', idCategoria: 52, categoria: 'Tesoreria' });
  });

  it('una categoría sin procesos activos se lista igual (como en la pantalla normal)', () => {
    const c = armarCatalogo([{ id: 44, category: 'Gerencia Tecnica' }], procs);
    expect(c.categorias).toHaveLength(1);
    expect(c.procesos).toEqual([]);
  });

  it('usa las MISMAS consultas que /api/requests-general/consult-request, filtrando la empresa', async () => {
    const queries: string[] = [];
    const inputs: unknown[] = [];
    const request = () => {
      const r = {
        input: (n: string, _t: unknown, v: unknown) => {
          inputs.push([n, v]);
          return r;
        },
        query: vi.fn(async (q: string) => {
          queries.push(q);
          return { recordset: q === SQL_PROCESOS_CREACION ? procs : cats };
        }),
      };
      return r;
    };
    const c = await catalogoCreacionEmpresa({ request } as never, 8);
    expect(queries[0].startsWith(SQL_CATEGORIAS_CREACION)).toBe(true);
    expect(queries[0]).toContain('AND c.id_company = @companyId');
    expect(queries[1]).toBe(SQL_PROCESOS_CREACION);
    expect(inputs).toEqual([['companyId', 8]]);
    expect(c.procesos).toHaveLength(2);
  });
});
