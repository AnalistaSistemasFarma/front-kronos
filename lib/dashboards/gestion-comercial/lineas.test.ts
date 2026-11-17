import { describe, it, expect } from 'vitest';
import {
  rutaLineasVenta,
  agruparProductos,
  agruparLineasTerapeuticas,
  agruparPedidos,
  construirDetalle,
  calcularLineas,
  type LineaVenta,
} from './lineas';

const factura = (over: Partial<LineaVenta>): LineaVenta => ({
  NDocumento: 'Facturas ',
  Tipo: 'Articulos',
  Fecha: '2026-11-10',
  Codigo: '900149596',
  Nombre: 'ASISFARMA S.A.S.',
  Documento: 4112,
  Referencia: '10195',
  Descripcion_Articulo: 'AGUA ESTERILIZADA 3000ML',
  Precio_Unitario: 18360,
  Cantidad: 10,
  Descuento: 0,
  Total: 183600,
  Costo: 11454,
  Vendedor: 'Lilian Mireya Duarte',
  U_IT_LineaTerapeutica: 'TODO EL RESTO',
  Orden_Compra: 3425,
  Bodega: 'B1101',
  ...over,
});

const nota = (over: Partial<LineaVenta>): LineaVenta =>
  factura({ NDocumento: 'Notas Credito', Cantidad: -5, Total: -91800, ...over });

describe('rutaLineasVenta', () => {
  it('usa la vista y el campo Fecha con rango acotado', () => {
    const ruta = rutaLineasVenta('2026-11-01', '2026-11-10');
    expect(ruta).toContain('view.svc/OLP_IND_VentasB1SLQuery');
    expect(ruta).toContain("Fecha ge '2026-11-01'");
    expect(ruta).toContain("Fecha le '2026-11-10'");
    expect(ruta).not.toContain('DocDate');
  });
});

describe('agruparProductos', () => {
  it('suma venta y unidades, resta notas crédito y calcula margen', () => {
    const lineas = [
      factura({ Referencia: 'A', Total: 1000, Cantidad: 10, Costo: 60 }),
      factura({ Referencia: 'A', Total: 500, Cantidad: 5, Costo: 60 }),
      nota({ Referencia: 'A', Total: -200, Cantidad: -2, Costo: 60 }),
    ];
    const prod = agruparProductos(lineas);
    expect(prod).toHaveLength(1);
    expect(prod[0].codigo).toBe('A');
    expect(prod[0].venta).toBe(1300); // 1000 + 500 - 200
    expect(prod[0].unidades).toBe(13); // 10 + 5 - 2
    // costo = 60*10 + 60*5 - 60*2 = 780 ; margen = 1300 - 780 = 520
    expect(prod[0].costo).toBe(780);
    expect(prod[0].margen).toBe(520);
  });

  it('ordena por venta descendente', () => {
    const prod = agruparProductos([
      factura({ Referencia: 'A', Total: 100 }),
      factura({ Referencia: 'B', Total: 900 }),
    ]);
    expect(prod.map((p) => p.codigo)).toEqual(['B', 'A']);
  });
});

describe('agruparLineasTerapeuticas', () => {
  it('agrupa por línea terapéutica y marca las vacías', () => {
    const filas = agruparLineasTerapeuticas([
      factura({ U_IT_LineaTerapeutica: 'PSICOLEPTICOS', Total: 500 }),
      factura({ U_IT_LineaTerapeutica: 'PSICOLEPTICOS', Total: 500 }),
      factura({ U_IT_LineaTerapeutica: undefined, Total: 200 }),
    ]);
    const psico = filas.find((f) => f.nombre === 'PSICOLEPTICOS');
    const sin = filas.find((f) => f.nombre === 'Sin línea terapéutica');
    expect(psico?.venta).toBe(1000);
    expect(sin?.venta).toBe(200);
  });
});

describe('agruparPedidos', () => {
  it('agrupa por orden de compra e ignora las nulas o cero', () => {
    const pedidos = agruparPedidos([
      factura({ Orden_Compra: 3425, Total: 1000 }),
      factura({ Orden_Compra: 3425, Total: 500 }),
      factura({ Orden_Compra: null, Total: 999 }),
      factura({ Orden_Compra: 0, Total: 888 }),
    ]);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].ordenCompra).toBe('3425');
    expect(pedidos[0].venta).toBe(1500);
    expect(pedidos[0].lineas).toBe(2);
  });
});

describe('construirDetalle', () => {
  it('respeta el tope y ordena por fecha desc', () => {
    const lineas = [
      factura({ Fecha: '2026-11-01', Total: 100 }),
      factura({ Fecha: '2026-11-10', Total: 200 }),
    ];
    const det = construirDetalle(lineas, 1);
    expect(det).toHaveLength(1);
    expect(det[0].fecha).toBe('2026-11-10');
  });
});

describe('calcularLineas', () => {
  it('entrega KPIs netos con facturas y notas crédito', () => {
    const res = calcularLineas('2026-11-01', '2026-11-10', [
      factura({ Total: 1000, Cantidad: 10, Costo: 50 }),
      nota({ Total: -300, Cantidad: -3, Costo: 50 }),
    ]);
    expect(res.kpis.ventaNetaLineas).toBe(700); // 1000 - 300
    expect(res.kpis.unidades).toBe(7); // 10 - 3
    // costo = 50*10 - 50*3 = 350 ; margen = 700 - 350 = 350
    expect(res.kpis.costo).toBe(350);
    expect(res.kpis.margen).toBe(350);
    expect(res.kpis.totalLineas).toBe(2);
  });
});
