/**
 * Cargue de líneas de la oferta desde Excel (reunión del 2026-11-06; como el «cargar artículos» de SAPSEND, pero
 * el precio de lista sale SIEMPRE de SAP: SAPSEND copiaba el precio del Excel como precio de lista y así se
 * saltaba la autorización de precio). PURO: encabezados, lectura de filas y validación básica.
 */

export const LINE_HEADERS = ['Codigo articulo', 'Cantidad', 'Precio', 'Bodega', 'Descripcion'] as const;
export const MAX_IMPORT_LINES = 200;

export interface ImportLine {
  row: number;
  ItemCode: string;
  Quantity: number;
  UnitPrice: number | null;
  WarehouseCode: string;
  ItemDescription: string;
}

const norm = (v: unknown) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

/** Campo de la plantilla al que corresponde un encabezado (acepta variantes: «Código», «ItemCode», «Precio unitario»...). */
export function headerField(h: unknown): keyof Omit<ImportLine, 'row'> | null {
  const n = norm(h);
  if (!n) return null;
  if (['codigoarticulo', 'codigo', 'articulo', 'itemcode', 'referencia', 'codigosap'].includes(n)) return 'ItemCode';
  if (['cantidad', 'quantity', 'cant'].includes(n)) return 'Quantity';
  if (['precio', 'preciounitario', 'unitprice', 'valorunitario', 'price'].includes(n)) return 'UnitPrice';
  if (['bodega', 'warehouse', 'warehousecode', 'almacen'].includes(n)) return 'WarehouseCode';
  if (['descripcion', 'description', 'itemdescription', 'nombre'].includes(n)) return 'ItemDescription';
  return null;
}

const toNum = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim().replace(/\s/g, '').replace(/\$/g, '');
  // «1.234,5» (es-CO) o «1234.5».
  const n = /,\d{1,6}$/.test(s) ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

/** Filas crudas {encabezado: valor} → líneas + errores de forma (sin tocar SAP). */
export function rowsToLines(rows: { row: number; values: Record<string, unknown> }[]): { lines: ImportLine[]; errors: { row: number; error: string }[] } {
  const lines: ImportLine[] = [];
  const errors: { row: number; error: string }[] = [];
  for (const { row, values } of rows) {
    const get = (f: keyof Omit<ImportLine, 'row'>) => {
      for (const [k, v] of Object.entries(values)) if (headerField(k) === f) return v;
      return undefined;
    };
    const code = String(get('ItemCode') ?? '').trim().slice(0, 50);
    const qty = toNum(get('Quantity'));
    const price = toNum(get('UnitPrice'));
    if (!code && qty == null) continue;
    if (!code) { errors.push({ row, error: 'Falta el código del artículo.' }); continue; }
    if (qty == null || Number.isNaN(qty) || qty <= 0) { errors.push({ row, error: `${code}: la cantidad debe ser mayor que 0.` }); continue; }
    if (price != null && (Number.isNaN(price) || price < 0)) { errors.push({ row, error: `${code}: el precio no es válido.` }); continue; }
    lines.push({
      row, ItemCode: code, Quantity: qty, UnitPrice: price,
      WarehouseCode: String(get('WarehouseCode') ?? '').trim().slice(0, 8),
      ItemDescription: String(get('ItemDescription') ?? '').trim().slice(0, 200),
    });
  }
  return { lines, errors };
}
