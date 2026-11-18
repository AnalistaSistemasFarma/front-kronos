import { describe, it, expect } from 'vitest';
import { esExcluida, fechaIso, filaDesdePisa, nitBase, nombrePropio, pisaEnRango } from './pisa';
import { netaPorOrigen, type Fila } from './tablero';

const venta = {
  Fecha: new Date('2026-11-11T00:00:00Z'),
  Nit: '891855847-3',
  Cliente: 'CLINICA CASANARE S.A ',
  Documento: 'FEV87308',
  Vendedor: 'JUAN FELIPE CARDONA RENGIFO',
  'Cod Pto Sap': 4053810,
  Producto: 'X-IS-002K ZPQ EQUIPO INFUSION DESECHABLE',
  'Nombre Homologaod': 'EQUIPO INFUSION X-IS-002K',
  Linea: 'DISPOSITIVOS MEDICOS',
  'CANT.': 1250,
  'TOT.VENTA': 24500000,
  COSTO: 12000000,
  'Pedido cliente': 7600774098,
  'Folio Sap': 64308088,
  'Ciudad Validacion': 'YOPAL',
  Validacion: 'Venta',
};

describe('base Pisa', () => {
  it('excluye ONE LATAM PHARMA y el presupuesto', () => {
    expect(esExcluida({ ...venta, Nit: '901713605-4', Cliente: 'ONE LATAM PHARMA S.A.S.' })).toBe(true);
    expect(esExcluida({ ...venta, Cliente: 'PRESUPUESTO FARMA', Producto: 'PRESUPUESTO HUMANA' })).toBe(true);
    expect(esExcluida({ ...venta, Fecha: null })).toBe(true);
    expect(esExcluida(venta)).toBe(false);
  });

  it('convierte la fila con origen Pisa y cliente unificado por NIT', () => {
    const f = filaDesdePisa(venta);
    expect(f.o).toBe('P');
    expect(f.f).toBe('2026-11-11');
    expect(f.t).toBe('F');
    expect(f.cc).toBe('891855847');
    expect(f.v).toBe('Juan Felipe Cardona Rengifo');
    expect(f.val).toBe(24500000);
    expect(f.cost).toBe(12000000);
    expect(f.oc).toBe('7600774098');
    expect(f.pc).toBe('PISA-4053810');
  });

  it('marca notas crédito por Validacion o valor negativo', () => {
    expect(filaDesdePisa({ ...venta, Validacion: 'Nota_Credito', 'TOT.VENTA': -100 }).t).toBe('N');
    expect(filaDesdePisa({ ...venta, Validacion: 'Revisar', 'TOT.VENTA': -5 }).t).toBe('N');
  });

  it('utilidades de fecha, NIT y nombre', () => {
    expect(fechaIso(45992)).toBe('2025-12-01');
    expect(fechaIso('2026-11-13')).toBe('2026-11-13');
    expect(fechaIso('')).toBe('');
    expect(nitBase('900149596-3')).toBe('900149596');
    expect(nombrePropio('MABEL MARGARITA JULIO OJEDA')).toBe('Mabel Margarita Julio Ojeda');
  });

  it('filtra por rango y separa la venta por origen', () => {
    const p = filaDesdePisa(venta);
    const sap: Fila = { ...p, o: undefined, val: 1000 };
    expect(pisaEnRango([p], '2026-11-01', '2026-11-10')).toHaveLength(0);
    expect(pisaEnRango([p], '2026-11-01', '2026-11-30')).toHaveLength(1);
    expect(netaPorOrigen([p, sap])).toEqual({ olp: 1000, pisa: 24500000 });
  });
});
