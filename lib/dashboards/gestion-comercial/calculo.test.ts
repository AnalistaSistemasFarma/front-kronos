import { describe, expect, it } from 'vitest';
import {
  agruparClientes,
  agruparVendedores,
  calcularGestionComercial,
  clientesPorRecuperar,
  diasHabiles,
  hoyBogota,
  parseCorte,
  rangosMes,
  rutaFacturas,
  rutaNotasCredito,
  rutaVendedores,
} from './calculo';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('rangosMes (mes actual y mismo lapso del mes anterior)', () => {
  it('compara del día 1 al día del corte en ambos meses', () => {
    expect(rangosMes(d('2026-11-06'))).toEqual({
      actual: { desde: '2026-11-01', hasta: '2026-11-06' },
      anterior: { desde: '2026-10-01', hasta: '2026-10-06' },
    });
  });

  it('si el mes anterior es más corto, termina en su último día', () => {
    expect(rangosMes(d('2026-03-31')).anterior).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' });
  });
});

describe('diasHabiles', () => {
  it('cuenta lunes a viernes inclusive', () => {
    // 2026-11-01 (dom) .. 2026-11-06 (vie): hábiles lun 2, mar 3, mié 4, jue 5, vie 6 = 5
    expect(diasHabiles('2026-11-01', '2026-11-06')).toBe(5);
  });
  it('un fin de semana no tiene hábiles', () => {
    expect(diasHabiles('2026-11-07', '2026-11-08')).toBe(0);
  });
});

describe('agruparClientes', () => {
  it('suma venta neta por cliente y resta notas crédito', () => {
    const r = agruparClientes(
      [
        { CardCode: 'A', CardName: 'Cliente A', DocTotal: 100 },
        { CardCode: 'A', CardName: 'Cliente A', DocTotal: 50 },
        { CardCode: 'B', CardName: 'Cliente B', DocTotal: 200 },
        { CardCode: 'X', DocTotal: 999, Cancelled: 'tYES' },
      ],
      [{ CardCode: 'A', CardName: 'Cliente A', DocTotal: 30 }]
    );
    expect(r[0]).toMatchObject({ codigo: 'B', venta: 200 });
    expect(r[1]).toMatchObject({ codigo: 'A', venta: 120, documentos: 2 });
    expect(r[0].participacion).toBeCloseTo(200 / 320);
  });
});

describe('agruparVendedores', () => {
  it('usa el catálogo para el nombre y cuenta clientes distintos', () => {
    const r = agruparVendedores(
      [
        { SalesPersonCode: 2, CardCode: 'A', DocTotal: 100, DocDate: '2026-11-04' },
        { SalesPersonCode: 2, CardCode: 'B', DocTotal: 50, DocDate: '2026-11-05' },
        { SalesPersonCode: 7, CardCode: 'C', DocTotal: 300, DocDate: '2026-11-04' },
      ],
      [],
      [
        { SalesEmployeeCode: 2, SalesEmployeeName: 'Lilian Duarte' },
        { SalesEmployeeCode: 7, SalesEmployeeName: 'Carlos Pérez' },
      ]
    );
    expect(r[0]).toMatchObject({ codigo: 7, nombre: 'Carlos Pérez', venta: 300, clientes: 1 });
    expect(r[1]).toMatchObject({ codigo: 2, nombre: 'Lilian Duarte', venta: 150, clientes: 2, ultimaVenta: '2026-11-05' });
  });
  it('vendedor sin catálogo recibe etiqueta genérica', () => {
    const r = agruparVendedores([{ SalesPersonCode: 99, CardCode: 'A', DocTotal: 10 }], [], []);
    expect(r[0].nombre).toBe('Vendedor 99');
  });
});

describe('clientesPorRecuperar', () => {
  it('lista los que compraron el mes anterior y no en el actual', () => {
    const actual = [{ codigo: 'A', nombre: 'A', venta: 100, participacion: 1, documentos: 1 }];
    const anterior = [
      { codigo: 'A', nombre: 'A', venta: 80, participacion: 0.5, documentos: 1 },
      { codigo: 'B', nombre: 'B', venta: 60, participacion: 0.5, documentos: 1 },
    ];
    const r = clientesPorRecuperar(actual, anterior);
    expect(r.map((c) => c.codigo)).toEqual(['B']);
  });
});

describe('calcularGestionComercial', () => {
  it('calcula KPIs netos, acumulados diarios y proyección', () => {
    const r = calcularGestionComercial(
      d('2026-11-03'),
      [
        { DocDate: '2026-11-02', DocTotal: 100, CardCode: 'A', CardName: 'A', SalesPersonCode: 1 },
        { DocDate: '2026-11-03', DocTotal: 200, CardCode: 'B', CardName: 'B', SalesPersonCode: 2 },
      ],
      [{ DocDate: '2026-11-03', DocTotal: 20, CardCode: 'A', CardName: 'A', SalesPersonCode: 1 }],
      [{ DocDate: '2026-10-02', DocTotal: 150, CardCode: 'A', CardName: 'A', SalesPersonCode: 1 }],
      [],
      [{ SalesEmployeeCode: 1, SalesEmployeeName: 'Uno' }, { SalesEmployeeCode: 2, SalesEmployeeName: 'Dos' }]
    );
    expect(r.kpis.ventaBruta).toBe(300);
    expect(r.kpis.notasCredito).toBe(20);
    expect(r.kpis.ventaNeta).toBe(280);
    expect(r.kpis.ventaNetaAnterior).toBe(150);
    expect(r.kpis.diferencia).toBe(130);
    expect(r.kpis.clientes).toBe(2);
    expect(r.dias).toHaveLength(3);
    expect(r.dias[2]).toMatchObject({ dia: 3, actual: 180, acumActual: 280 });
    expect(r.topClientes[0].codigo).toBe('B');
  });
});

describe('rutas OData (solo lectura, con rango de fechas)', () => {
  it('facturas, notas crédito y vendedores', () => {
    expect(rutaFacturas('2026-11-01', '2026-11-06')).toContain("DocDate ge '2026-11-01' and DocDate le '2026-11-06'");
    expect(rutaFacturas('2026-11-01', '2026-11-06')).toContain('Invoices?$select=');
    expect(rutaNotasCredito('2026-11-01', '2026-11-06')).toContain('CreditNotes?$select=');
    expect(rutaVendedores()).toBe("SalesPersons?$select=SalesEmployeeCode,SalesEmployeeName&$filter=Active eq 'tYES'");
  });

  it('parseCorte valida fechas reales y usa hoy de Colombia por defecto', () => {
    expect(parseCorte('2026-11-06')?.toISOString().slice(0, 10)).toBe('2026-11-06');
    expect(parseCorte('2026-02-31')).toBeNull();
    const ahora = new Date('2026-11-07T02:00:00Z'); // 6 nov 9 p. m. en Bogotá
    expect(hoyBogota(ahora)).toBe('2026-11-06');
  });
});
