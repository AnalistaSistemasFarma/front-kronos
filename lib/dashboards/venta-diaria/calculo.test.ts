import { describe, expect, it } from 'vitest';
import { calcularVentaDiaria, hoyBogota, parseCorte, rangosVentaDiaria, rutaFacturas, sumarPorDia } from './calculo';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('rangosVentaDiaria (mismo lapso del mes anterior)', () => {
  it('compara del día 1 al día del corte en ambos meses', () => {
    expect(rangosVentaDiaria(d('2026-11-06'))).toEqual({
      actual: { desde: '2026-11-01', hasta: '2026-11-06' },
      anterior: { desde: '2026-10-01', hasta: '2026-10-06' },
    });
  });

  it('si el mes anterior es más corto, termina en su último día', () => {
    expect(rangosVentaDiaria(d('2026-03-31')).anterior).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' });
  });

  it('en enero el mes anterior es diciembre del año previo', () => {
    expect(rangosVentaDiaria(d('2026-01-15')).anterior).toEqual({ desde: '2025-12-01', hasta: '2025-12-15' });
  });
});

describe('sumarPorDia', () => {
  it('suma DocTotal por fecha e ignora cancelados y filas sin fecha', () => {
    const m = sumarPorDia([
      { DocDate: '2026-11-02T00:00:00Z', DocTotal: 100 },
      { DocDate: '2026-11-02', DocTotal: 50 },
      { DocDate: '2026-11-02', DocTotal: 999, Cancelled: 'tYES' },
      { DocTotal: 7 },
    ]);
    expect(m.get('2026-11-02')).toBe(150);
    expect(m.size).toBe(1);
  });
});

describe('calcularVentaDiaria', () => {
  it('alinea por día del mes y calcula totales, variación y promedio', () => {
    const r = calcularVentaDiaria(
      d('2026-11-03'),
      [
        { DocDate: '2026-11-01', DocTotal: 100 },
        { DocDate: '2026-11-03', DocTotal: 200 },
      ],
      [
        { DocDate: '2026-10-01', DocTotal: 50 },
        { DocDate: '2026-10-02', DocTotal: 150 },
        { DocDate: '2026-10-03', DocTotal: 50 },
      ]
    );
    expect(r.dias.map((x) => [x.dia, x.actual, x.anterior])).toEqual([
      [1, 100, 50],
      [2, 0, 150],
      [3, 200, 50],
    ]);
    expect(r.kpis.totalActual).toBe(300);
    expect(r.kpis.totalAnterior).toBe(250);
    expect(r.kpis.diferencia).toBe(50);
    expect(r.kpis.variacion).toBeCloseTo(0.2);
    expect(r.kpis.diasConVenta).toBe(2);
    expect(r.kpis.promedioDiarioActual).toBe(150);
    expect(r.anterior).toEqual({ desde: '2026-10-01', hasta: '2026-10-03', total: 250 });
  });

  it('días que no existen en el mes anterior quedan sin comparación', () => {
    const r = calcularVentaDiaria(d('2026-03-30'), [], [{ DocDate: '2026-02-28', DocTotal: 10 }]);
    expect(r.dias).toHaveLength(30);
    expect(r.dias[28]).toMatchObject({ dia: 29, fechaAnterior: null, anterior: null });
    expect(r.kpis.totalAnterior).toBe(10);
    expect(r.kpis.variacion).toBe(-1);
  });

  it('sin venta anterior la variación es null', () => {
    const r = calcularVentaDiaria(d('2026-11-01'), [{ DocDate: '2026-11-01', DocTotal: 5 }], []);
    expect(r.kpis.variacion).toBeNull();
  });
});

describe('parseCorte y filtro OData', () => {
  it('acepta fechas reales y rechaza inválidas', () => {
    expect(parseCorte('2026-11-06')?.toISOString().slice(0, 10)).toBe('2026-11-06');
    expect(parseCorte('2026-02-31')).toBeNull();
    expect(parseCorte('06/11/2026')).toBeNull();
  });

  it('sin parámetro usa la fecha de hoy en Colombia', () => {
    const ahora = new Date('2026-11-07T02:00:00Z'); // 6 nov, 9 p. m. en Bogotá
    expect(hoyBogota(ahora)).toBe('2026-11-06');
    expect(parseCorte(null, ahora)?.toISOString().slice(0, 10)).toBe('2026-11-06');
  });

  it('la ruta solo lee facturas con $select y rango de fechas', () => {
    expect(rutaFacturas('2026-11-01', '2026-11-06')).toBe(
      "Invoices?$select=DocDate,DocTotal,Cancelled&$filter=DocDate ge '2026-11-01' and DocDate le '2026-11-06'"
    );
  });
});
