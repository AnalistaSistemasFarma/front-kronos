/**
 * Construccion y validacion PURA de la oferta de venta creada desde «Mis solicitudes».
 * Espeja SAPSEND (ModalConfirmQuotation): 1) POST Quotations en ER; 2) POST Drafts
 * (oOrders) en B con cada linea enlazada a SU linea de la cotizacion (BaseType 23,
 * BaseEntry = DocEntry de la cotizacion, BaseLine = LineNum real; SAPSEND usaba el
 * indice del arreglo). U_SEND_PriceLP lleva el precio de lista para la regla de precio.
 */

export interface OfferHeader {
  CardCode: string;
  DocDueDate: string;
  NumAtCard?: string;
  Comments?: string;
  U_SEND_InterComments?: string;
  ShipToCode?: string;
}

export interface OfferLine {
  ItemCode: string;
  ItemDescription?: string;
  Quantity: number;
  UnitPrice: number;
  /** Precio de lista del cliente (U_SEND_PriceLP). */
  ListPrice?: number | null;
  WarehouseCode?: string;
  TaxCode?: string;
}

export interface OfferError {
  field: string;
  error: string;
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.')));
const txt = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

export function sanitizeOfferLine(raw: Record<string, unknown>): OfferLine {
  const lp = raw.ListPrice;
  return {
    ItemCode: txt(raw.ItemCode, 50),
    ItemDescription: txt(raw.ItemDescription, 200) || undefined,
    Quantity: num(raw.Quantity),
    UnitPrice: num(raw.UnitPrice),
    ListPrice: lp == null || lp === '' ? null : num(lp),
    WarehouseCode: txt(raw.WarehouseCode, 8) || undefined,
    TaxCode: txt(raw.TaxCode, 8) || undefined,
  };
}

export function validateOffer(h: OfferHeader, lines: OfferLine[], today: string): OfferError[] {
  const e: OfferError[] = [];
  if (!txt(h.CardCode, 50)) e.push({ field: 'CardCode', error: 'Elija el cliente.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(h.DocDueDate ?? ''))) e.push({ field: 'DocDueDate', error: 'Indique la fecha de entrega.' });
  else if (h.DocDueDate < today) e.push({ field: 'DocDueDate', error: 'La fecha de entrega no puede ser anterior a hoy.' });
  if (!lines.length) e.push({ field: 'DocumentLines', error: 'La oferta no tiene líneas.' });
  lines.forEach((l, i) => {
    if (!l.ItemCode) e.push({ field: `DocumentLines[${i}].ItemCode`, error: 'Falta el artículo.' });
    if (!Number.isFinite(l.Quantity) || l.Quantity <= 0) e.push({ field: `DocumentLines[${i}].Quantity`, error: 'La cantidad debe ser mayor que 0.' });
    if (!Number.isFinite(l.UnitPrice) || l.UnitPrice < 0) e.push({ field: `DocumentLines[${i}].UnitPrice`, error: 'El precio no puede ser negativo.' });
    if (!l.WarehouseCode) e.push({ field: `DocumentLines[${i}].WarehouseCode`, error: 'Falta la bodega.' });
  });
  return e;
}

function header(h: OfferHeader) {
  const out: Record<string, unknown> = { CardCode: h.CardCode.trim(), DocDueDate: h.DocDueDate };
  if (h.NumAtCard) out.NumAtCard = txt(h.NumAtCard, 100);
  if (h.Comments) out.Comments = txt(h.Comments, 254);
  if (h.U_SEND_InterComments) out.U_SEND_InterComments = txt(h.U_SEND_InterComments, 254);
  if (h.ShipToCode) out.ShipToCode = txt(h.ShipToCode, 50);
  return out;
}

function line(l: OfferLine) {
  const out: Record<string, unknown> = {
    ItemCode: l.ItemCode,
    Quantity: l.Quantity,
    UnitPrice: l.UnitPrice,
    U_SEND_PriceLP: l.ListPrice ?? l.UnitPrice,
  };
  if (l.WarehouseCode) out.WarehouseCode = l.WarehouseCode;
  if (l.TaxCode) out.TaxCode = l.TaxCode;
  return out;
}

/** 1) Cotizacion (documento origen) en ER. */
export function buildQuotationPayload(h: OfferHeader, lines: OfferLine[], today: string, trace: string) {
  return { ...header(h), DocDate: today, U_SEND_State: 'ER', U_SEND_TraCreatedBy: trace, DocumentLines: lines.map(line) };
}

/** 2) Borrador de pedido en B, enlazado linea a linea a la cotizacion creada. */
export function buildOfferDraftPayload(
  h: OfferHeader,
  lines: OfferLine[],
  quotation: { DocEntry: number; DocumentLines?: { LineNum: number }[] },
  today: string,
  trace: string
) {
  const qLines = quotation.DocumentLines ?? [];
  return {
    ...header(h),
    DocDate: today,
    DocObjectCode: 'oOrders',
    U_SEND_State: 'B',
    U_SEND_TraCreatedBy: trace,
    DocumentLines: lines.map((l, i) => ({
      ...line(l),
      BaseType: 23,
      BaseEntry: quotation.DocEntry,
      BaseLine: qLines[i]?.LineNum ?? i,
    })),
  };
}
