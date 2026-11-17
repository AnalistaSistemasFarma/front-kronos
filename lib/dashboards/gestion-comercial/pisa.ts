/**
 * Base de ventas de Pisa (ERP de Pisa) para el tablero comercial.
 *
 * Origen: «Historico Ventas Pisa.xlsx», hoja «Ventas_Pisa» (foto al
 * 2026-11-13 entregada por Neider Navarrete). Reglas acordadas en el hilo del
 * proyecto (2026-11-17):
 *  - Se EXCLUYE lo que Pisa le factura a ONE LATAM PHARMA (NIT 901713605): esa
 *    venta ya aparece en SAP de OLP cuando OLP le vende al cliente final.
 *  - Se EXCLUYEN las filas de presupuesto (cliente / producto «PRESUPUESTO …»).
 *  - El resto (venta directa de Pisa a clientes con vendedor de OLP) se suma a la
 *    venta de SAP, marcada con origen 'P' para el tooltip OLP / Pisa.
 *
 * Funciones puras (sin fs, sin exceljs): las usa el cargador y las pruebas.
 */
import type { Fila } from './tablero';

/** NIT (sin dígito de verificación) de ONE LATAM PHARMA, que se excluye. */
export const NIT_OLP = '901713605';

/** Columnas de la hoja que se usan (encabezado de la fila 1). */
export const COLUMNAS_PISA = [
  'Fecha',
  'Nit',
  'Cliente',
  'Documento',
  'Vendedor',
  'Cod Pto Sap',
  'Producto',
  'Nombre Homologaod',
  'Linea',
  'CANT.',
  'TOT.VENTA',
  'COSTO',
  'Pedido cliente',
  'Folio Sap',
  'Ciudad Validacion',
  'CIUDAD',
  'Validacion',
] as const;

export type ColumnaPisa = (typeof COLUMNAS_PISA)[number];
export type RegistroPisa = Partial<Record<ColumnaPisa, unknown>>;

const txt = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** Fecha de Excel (Date, serial o texto) a AAAA-MM-DD. */
export function fechaIso(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000).toISOString().slice(0, 10);
  }
  const t = txt(v);
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : '';
}

/** «MABEL MARGARITA JULIO OJEDA» → «Mabel Margarita Julio Ojeda» (como en SAP). */
export function nombrePropio(v: unknown): string {
  return txt(v)
    .toLowerCase()
    .split(' ')
    .map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p))
    .join(' ');
}

/** NIT sin dígito de verificación: «900149596-3» → «900149596» (= Codigo de SAP). */
export function nitBase(v: unknown): string {
  return txt(v).split('-')[0].replace(/\D/g, '');
}

/** ¿La fila queda por fuera del tablero? */
export function esExcluida(r: RegistroPisa): boolean {
  if (!fechaIso(r.Fecha)) return true;
  if (nitBase(r.Nit) === NIT_OLP) return true;
  const cliente = txt(r.Cliente).toUpperCase();
  const producto = txt(r.Producto).toUpperCase();
  if (cliente.startsWith('PRESUPUESTO') || producto.startsWith('PRESUPUESTO')) return true;
  if (cliente.includes('ONE LATAM PHARMA')) return true;
  return false;
}

/** Convierte una fila válida de la base Pisa a la fila compacta del tablero. */
export function filaDesdePisa(r: RegistroPisa): Fila {
  const val = num(r['TOT.VENTA']);
  const nota = txt(r.Validacion).toLowerCase().startsWith('nota') || val < 0;
  const folio = num(r['Folio Sap']);
  const pedido = num(r['Pedido cliente']);
  const codigo = txt(r['Cod Pto Sap']);
  const nombreProducto = txt(r['Nombre Homologaod']) || txt(r.Producto) || codigo;
  const nit = txt(r.Nit);
  return {
    f: fechaIso(r.Fecha),
    t: nota ? 'N' : 'F',
    d: folio > 0 ? folio : null,
    cc: nitBase(nit) || txt(r.Cliente),
    cn: txt(r.Cliente) || nit,
    nit,
    v: nombrePropio(r.Vendedor) || 'Sin vendedor',
    pc: codigo ? `PISA-${codigo}` : `PISA-${nombreProducto}`,
    pn: nombreProducto || 'Sin descripción',
    lt: txt(r.Linea) || 'Sin línea terapéutica',
    q: num(r['CANT.']),
    val,
    cost: num(r.COSTO),
    oc: pedido > 0 ? String(pedido) : '',
    ciu: txt(r['Ciudad Validacion']) || txt(r.CIUDAD) || 'Sin ciudad',
    o: 'P',
  };
}

/** Filas de la base Pisa dentro de un rango de fechas (inclusive). */
export function pisaEnRango(filas: Fila[], desde: string, hasta: string): Fila[] {
  return filas.filter((r) => r.f >= desde && r.f <= hasta);
}
