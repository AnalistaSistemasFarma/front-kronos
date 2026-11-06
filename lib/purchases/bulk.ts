/**
 * Carga masiva PURA de solicitudes de compra. Replica ModalBulkPurchaseRequest.jsx
 * de SAPSEND: misma plantilla de 17 columnas, filas sin CardCode/ItemCode/Quantity
 * se descartan con su motivo, un borrador por proveedor (CardCode) con la cabecera
 * de la PRIMERA fila del grupo, y precio vacio -> lista de precios del proveedor.
 *
 * Diferencias deliberadas frente a SAPSEND:
 *  - NO aprueba en firme: cada borrador queda en B y, si se pide, se envia a
 *    autorizar (SAPSEND pasaba de B a A sin autorizacion, l.466-575).
 *  - Las lineas pasan por las mismas validaciones del flujo individual (en
 *    SAPSEND el masivo no validaba cuenta, norma ni IVA contra SAP).
 *  - Moneda y bodega por defecto (COP / MPR01 de Ryan) NO van fijas en el
 *    codigo: llegan como `defaults` de la configuracion por empresa (Fase 10).
 */

import type { DraftHeaderInput, DraftLine } from './drafts';

export const BULK_HEADERS = [
  'CardCode', 'CardName', 'Comments', 'DocDate', 'DocDueDate', 'RequriedDate', 'ItemCode', 'ItemDescription',
  'RequiredDate', 'Quantity', 'UnitPrice', 'TaxCode', 'Currency', 'WarehouseCode', 'AccountCode', 'CostingCode',
  'ProjectCode',
] as const;

export const BULK_REQUIRED = ['CardCode', 'ItemCode', 'Quantity'] as const;

/** Tope por carga: cada grupo es un borrador (y una autorizacion) en SAP. */
export const BULK_MAX_GROUPS = 50;
export const BULK_MAX_ROWS = 1000;

export type BulkRow = Partial<Record<(typeof BULK_HEADERS)[number], unknown>>;

export interface InvalidRow {
  row: number;
  reason: string;
  CardCode: string;
  ItemCode: string;
}

export interface BulkGroup {
  cardCode: string;
  cardName: string;
  /** Filas del Excel (1 = primera fila de datos) que componen el grupo. */
  rows: number[];
  header: DraftHeaderInput;
  lines: DraftLine[];
}

export interface BulkDefaults {
  currency?: string;
  warehouse?: string;
}

const isBlank = (v: unknown) => v === undefined || v === null || String(v).trim() === '';

/** Numero tolerante a separador de miles con coma ("1,500.5"), como SAPSEND. */
export function parseAmount(v: unknown): number {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Fecha de Excel (Date, numero serial o texto) -> YYYY-MM-DD en UTC; '' si no es valida. */
export function toIsoDate(v: unknown): string {
  if (isBlank(v)) return '';
  let d: Date;
  if (v instanceof Date) d = v;
  else if (typeof v === 'number') d = new Date(Math.round((v - 25569) * 86400 * 1000)); // serial de Excel
  else d = new Date(String(v).trim());
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** Valida filas y agrupa por proveedor. */
export function groupBulkRows(
  rows: BulkRow[],
  defaults: BulkDefaults = {}
): { groups: BulkGroup[]; invalid: InvalidRow[] } {
  const invalid: InvalidRow[] = [];
  const byVendor = new Map<string, { row: BulkRow; index: number }[]>();

  rows.forEach((row, i) => {
    const missing = BULK_REQUIRED.filter((f) => isBlank(row[f]));
    if (missing.length > 0) {
      invalid.push({
        row: i + 1,
        reason: `Datos faltantes: ${missing.join(', ')}`,
        CardCode: isBlank(row.CardCode) ? '(sin socio)' : String(row.CardCode).trim(),
        ItemCode: isBlank(row.ItemCode) ? '' : String(row.ItemCode).trim(),
      });
      return;
    }
    const key = String(row.CardCode).trim();
    const list = byVendor.get(key) ?? [];
    list.push({ row, index: i + 1 });
    byVendor.set(key, list);
  });

  const groups: BulkGroup[] = [...byVendor.entries()].map(([cardCode, list]) => {
    const head = list[0].row;
    const cardName = String(head.CardName ?? '').trim();
    const comments = String(head.Comments ?? '').trim().toUpperCase();
    const lines: DraftLine[] = list.map(({ row }) => {
      const line: DraftLine = {
        ItemCode: String(row.ItemCode).trim(),
        Quantity: parseAmount(row.Quantity),
        LineVendor: cardCode,
        U_NombreProveedor: String(row.CardName ?? '').trim() || cardName,
      };
      const text = (f: keyof BulkRow & keyof DraftLine) => {
        if (!isBlank(row[f])) line[f] = String(row[f]).trim();
      };
      text('TaxCode');
      text('AccountCode');
      text('CostingCode');
      text('ProjectCode');
      if (!isBlank(row.ItemDescription)) line.ItemDescription = String(row.ItemDescription).trim().toUpperCase();
      if (!isBlank(row.UnitPrice)) line.UnitPrice = parseAmount(row.UnitPrice);
      const currency = isBlank(row.Currency) ? defaults.currency : String(row.Currency).trim();
      if (currency) line.Currency = currency;
      const warehouse = isBlank(row.WarehouseCode) ? defaults.warehouse : String(row.WarehouseCode).trim();
      if (warehouse) line.WarehouseCode = warehouse;
      const required = toIsoDate(row.RequiredDate);
      if (required) line.RequiredDate = required;
      return line;
    });
    return {
      cardCode,
      cardName,
      rows: list.map((x) => x.index),
      // Sin comentario en el Excel se usa uno fijo: en SynerLink el comentario es obligatorio.
      header: { Comments: comments || 'CARGUE MASIVO', RequriedDate: toIsoDate(head.RequriedDate) || undefined },
      lines,
    };
  });

  return { groups, invalid };
}

/** Accesos a SAP para completar precios. Inyectables para tests. */
export interface PriceLookups {
  priceListOf: (cardCode: string) => Promise<number | null>;
  itemPrices: (itemCode: string) => Promise<Array<{ PriceList: number; Price: number | null }>>;
}

export interface PriceWarning {
  cardCode: string;
  itemCode: string;
  reason: string;
}

/**
 * Completa UnitPrice vacios con la lista de precios del proveedor (como SAPSEND).
 * Si no hay lista o precio, la linea queda en 0 y se avisa. Usa cache por
 * proveedor y articulo para no repetir consultas a SAP.
 */
export async function fillMissingPrices(groups: BulkGroup[], sap: PriceLookups): Promise<PriceWarning[]> {
  const warnings: PriceWarning[] = [];
  const lists = new Map<string, Promise<number | null>>();
  const prices = new Map<string, Promise<Array<{ PriceList: number; Price: number | null }>>>();

  for (const g of groups) {
    for (const line of g.lines) {
      if (line.UnitPrice !== undefined) continue;
      const itemCode = String(line.ItemCode);
      if (!lists.has(g.cardCode)) lists.set(g.cardCode, sap.priceListOf(g.cardCode));
      const listNum = await lists.get(g.cardCode)!;
      if (listNum == null) {
        line.UnitPrice = 0;
        warnings.push({ cardCode: g.cardCode, itemCode, reason: 'El proveedor no tiene lista de precios asignada.' });
        continue;
      }
      if (!prices.has(itemCode)) prices.set(itemCode, sap.itemPrices(itemCode));
      const match = (await prices.get(itemCode)!).find((p) => p.PriceList === listNum);
      if (match?.Price != null && match.Price > 0) {
        line.UnitPrice = match.Price;
      } else {
        line.UnitPrice = 0;
        warnings.push({ cardCode: g.cardCode, itemCode, reason: `Sin precio en la lista ${listNum}; quedo en 0.` });
      }
    }
  }
  return warnings;
}
