/**
 * Mapa de relaciones de la oferta de venta (como el «Mapa de relaciones» de SAP y la
 * trazabilidad de SAPSEND): cotización → borrador → pedido → entregas → facturas.
 * PURO: arma las rutas OData y ordena el resultado. Los documentos destino se buscan
 * por las líneas que los referencian (BaseType / BaseEntry) con $crossjoin, el mismo
 * recurso que usa SAPSEND en ModalViewRecentOrders.
 */

export type DocKind = 'quotation' | 'draft' | 'order' | 'delivery' | 'invoice';

export interface RelDoc {
  kind: DocKind;
  docEntry: number;
  docNum: number | null;
  docDate: string | null;
  total: number | null;
  status: string | null;
  /** Estado U_SEND (solo cotización / borrador / pedido). */
  sendState?: string | null;
}

/** Tipos de objeto SAP para BaseType. */
export const OBJ = { quotation: 23, order: 17, delivery: 15, invoice: 13 } as const;

const SEL = 'DocEntry,DocNum,DocDate,DocTotal,DocumentStatus,Cancelled';

/** Documentos destino de `entity` cuyas líneas vienen de (baseType, baseEntries). */
export function targetsPath(entity: 'DeliveryNotes' | 'Invoices', baseType: number, baseEntries: number[]): string | null {
  const ids = [...new Set(baseEntries.filter((n) => Number.isInteger(n) && n > 0))].slice(0, 20);
  if (!ids.length) return null;
  const or = ids.map((id) => `${entity}/DocumentLines/BaseEntry eq ${id}`).join(' or ');
  return `$crossjoin(${entity},${entity}/DocumentLines)?$expand=${entity}($select=${SEL})&$filter=${entity}/DocEntry eq ${entity}/DocumentLines/DocEntry and ${entity}/DocumentLines/BaseType eq ${baseType} and (${or})`;
}

/** Filas únicas de un $crossjoin. */
export function uniqueDocs(kind: DocKind, entity: string, rows: Record<string, unknown>[]): RelDoc[] {
  const seen = new Map<number, RelDoc>();
  for (const r of rows) {
    const d = (r[entity] ?? r) as Record<string, unknown>;
    const id = Number(d.DocEntry);
    if (!id || seen.has(id)) continue;
    seen.set(id, toDoc(kind, d));
  }
  return [...seen.values()].sort((a, b) => a.docEntry - b.docEntry);
}

export function toDoc(kind: DocKind, d: Record<string, unknown>): RelDoc {
  const cancelled = String(d.Cancelled ?? '') === 'tYES';
  const st = String(d.DocumentStatus ?? '');
  return {
    kind,
    docEntry: Number(d.DocEntry),
    docNum: d.DocNum == null ? null : Number(d.DocNum),
    docDate: d.DocDate ? String(d.DocDate).slice(0, 10) : null,
    total: d.DocTotal == null ? null : Number(d.DocTotal),
    status: cancelled ? 'Cancelado' : st === 'bost_Open' ? 'Abierto' : st === 'bost_Close' ? 'Cerrado' : st || null,
    sendState: d.U_SEND_State == null ? null : String(d.U_SEND_State),
  };
}

/** Cotización base del borrador (la de sus líneas con BaseType 23). */
export function quotationOf(draft: { DocumentLines?: Record<string, unknown>[] }): number | null {
  const l = (draft.DocumentLines ?? []).find((x) => Number(x.BaseType) === OBJ.quotation && x.BaseEntry != null);
  return l ? Number(l.BaseEntry) : null;
}

export const KIND_LABEL: Record<DocKind, string> = {
  quotation: 'Cotización',
  draft: 'Borrador de pedido',
  order: 'Pedido de venta',
  delivery: 'Entrega',
  invoice: 'Factura',
};
