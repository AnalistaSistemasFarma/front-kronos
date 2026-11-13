import { describe, it, expect } from 'vitest';
import {
  aFila,
  agrupar,
  filtrar,
  finDeMes,
  insights,
  mesesCerrados,
  pedidos,
  porCliente,
  porRecuperar,
  porSemana,
  rangosTablero,
  rutaVistaVentas,
  serieDiaria,
  totales,
  valor,
  variacion,
  FILTROS_VACIOS,
  type Fila,
} from './tablero';

const fila = (over: Partial<Fila>): Fila => ({
  f: '2026-11-04',
  t: 'F',
  d: 1,
  cc: 'C1',
  cn: 'Cliente 1',
  nit: '900-1',
  v: 'Vendedor A',
  pc: 'P1',
  pn: 'Producto 1',
  lt: 'ANESTESICOS',
  q: 10,
  val: 1000,
  cost: 600,
  oc: '100',
  ciu: 'BOGOTÁ',
  ...over,
});

describe('rutaVistaVentas', () => {
  it('consulta la vista con $select explícito y rango por Fecha', () => {
    const r = rutaVistaVentas('2026-11-01', '2026-11-10');
    expect(r).toContain('view.svc/OLP_IND_VentasB1SLQuery');
    expect(r).toContain('$select=Fecha,NDocumento,');
    expect(r).toContain("Fecha ge '2026-11-01' and Fecha le '2026-11-10'");
  });

  it('nunca pide N° Documento ni Documento en el esquema nuevo', () => {
    const sel = rutaVistaVentas('2026-11-01', '2026-11-10', 'nuevo').match(/\$select=([^&]*)/)![1].split(',');
    expect(sel).not.toContain('Documento');
    expect(sel.some((c) => c.includes('°'))).toBe(false);
  });

  it('en el esquema viejo pide los nombres viejos, sin N° Documento ni columnas nuevas', () => {
    const sel = rutaVistaVentas('2026-11-01', '2026-11-10', 'viejo').match(/\$select=([^&]*)/)![1].split(',');
    expect(sel).toContain('Documento');
    expect(sel).not.toContain('NDocumento');
    expect(sel.some((c) => c.includes('°'))).toBe(false);
    expect(sel).not.toContain('U_IT_LineaTerapeutica');
    expect(sel).not.toContain('Municipio_Factura');
  });
});

describe('aFila', () => {
  it('normaliza factura y nota crédito con costo firmado', () => {
    const f = aFila({ NDocumento: 'Facturas ', Fecha: '2026-11-10', Codigo: 'C1', Nombre: 'X', Documento: 5, Referencia: 'R', Descripcion_Articulo: 'Prod', Cantidad: 4, Total: 400, Costo: 50, Orden_Compra: 7 });
    expect(f.t).toBe('F');
    expect(f.cost).toBe(200);
    expect(f.oc).toBe('7');
    const n = aFila({ NDocumento: 'Notas Credito', Fecha: '2026-11-10', Cantidad: -2, Total: -200, Costo: 50, Orden_Compra: null });
    expect(n.t).toBe('N');
    expect(n.cost).toBe(-100);
    expect(n.oc).toBe('');
    expect(n.lt).toBe('Sin línea terapéutica');
  });

  it('en el esquema viejo marca línea terapéutica y ciudad como No disponible', () => {
    const f = aFila({ NDocumento: 'Facturas', Fecha: '2026-11-10', Cantidad: 1, Total: 10, U_IT_LineaTerapeutica: 'X', Municipio_Factura: 'Y' }, 'viejo');
    expect(f.lt).toBe('No disponible');
    expect(f.ciu).toBe('No disponible');
  });
});

describe('rangosTablero', () => {
  it('arma mes actual, mismo lapso mes anterior y año anterior', () => {
    const r = rangosTablero(new Date('2026-03-31T00:00:00Z'));
    expect(r.actual).toEqual({ desde: '2026-03-01', hasta: '2026-03-31' });
    expect(r.anterior).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' });
    expect(r.anioAnterior).toEqual({ desde: '2025-03-01', hasta: '2025-03-31' });
  });
});

describe('totales y medidas', () => {
  const filas = [fila({}), fila({ t: 'N', d: 2, val: -300, q: -3, cost: -180 })];
  it('calcula neta, bruta, notas y margen', () => {
    const t = totales(filas);
    expect(t.neta).toBe(700);
    expect(t.bruta).toBe(1000);
    expect(t.notas).toBe(-300);
    expect(t.margen).toBe(700 - 420);
    expect(t.facturas).toBe(1);
  });
  it('valor por medida', () => {
    expect(valor(filas[1], 'bruta')).toBe(0);
    expect(valor(filas[1], 'notas')).toBe(-300);
    expect(valor(filas[0], 'neta')).toBe(1000);
  });
});

describe('filtrar y agrupar', () => {
  const filas = [fila({}), fila({ cc: 'C2', cn: 'Cliente 2', v: 'Vendedor B', val: 3000 })];
  it('filtra por vendedor', () => {
    expect(filtrar(filas, { ...FILTROS_VACIOS, vendedor: 'Vendedor B' })).toHaveLength(1);
  });
  it('agrupa por cliente ordenado por venta', () => {
    const g = agrupar(filas, porCliente);
    expect(g[0].clave).toBe('C2');
    expect(g[0].participacion).toBeCloseTo(0.75);
  });
});

describe('serie y semanas', () => {
  it('acumula por día en las tres ventanas', () => {
    const datos = {
      actual: { desde: '2026-11-01', hasta: '2026-11-03' },
      anterior: { desde: '2026-10-01', hasta: '2026-10-03' },
      anioAnterior: { desde: '2025-11-01', hasta: '2025-11-03' },
    };
    const s = serieDiaria(
      [fila({ f: '2026-11-01', val: 100 }), fila({ f: '2026-11-03', val: 50 })],
      [fila({ f: '2026-10-02', val: 70 })],
      [],
      datos
    );
    expect(s).toHaveLength(3);
    expect(s[2].acumActual).toBe(150);
    expect(s[2].acumAnterior).toBe(70);
    expect(s[2].acumAnio).toBe(0);
  });
  it('reparte por semana', () => {
    const w = porSemana([fila({ f: '2026-11-01', val: 10 }), fila({ f: '2026-11-08', val: 20 }), fila({ f: '2026-11-30', val: 5 })]);
    expect(w).toEqual([10, 20, 0, 0, 5]);
  });
});

describe('clientes por recuperar y pedidos', () => {
  it('detecta clientes que compraron antes y no ahora', () => {
    const r = porRecuperar([fila({ cc: 'C1' })], [fila({ cc: 'C1' }), fila({ cc: 'C9', cn: 'Perdido' })]);
    expect(r.map((g) => g.clave)).toEqual(['C9']);
  });
  it('agrupa pedidos con sus facturas', () => {
    const p = pedidos([fila({ d: 1 }), fila({ d: 2, f: '2026-11-05' }), fila({ oc: '' })]);
    expect(p).toHaveLength(1);
    expect(p[0].facturas).toEqual([1, 2]);
    expect(p[0].ultima).toBe('2026-11-05');
  });
});

describe('utilidades', () => {
  it('variación con base cero es null', () => {
    expect(variacion(10, 0)).toBeNull();
    expect(variacion(110, 100)).toBeCloseTo(0.1);
  });
  it('fin de mes y meses cerrados', () => {
    expect(finDeMes('2026-02')).toBe('2026-02-28');
    expect(mesesCerrados('2026-11-12', 2)).toEqual(['2026-10', '2026-09']);
  });
  it('insights compara contra mes anterior', () => {
    const h = insights([fila({ val: 2000 })], [fila({ val: 1000 })], []);
    expect(h[0].titulo).toBe('Por encima del mes anterior');
  });
});
