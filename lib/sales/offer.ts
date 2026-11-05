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
  /** Dirección de facturación (la del cliente por defecto, como SAPSEND). */
  PayToCode?: string;
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
    // El IVA no lo elige el usuario: SAP aplica el parametrizado del artículo / socio de negocio.
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
  if (h.PayToCode) out.PayToCode = txt(h.PayToCode, 50);
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

/** Asunto de la solicitud: «OV - NOMBRE DEL CLIENTE - NIT - primera línea» (Nicolás Rivera, 2026-11-03). PURA. */
export function offerSubject(cardName: unknown, cardCode: unknown, firstLine: unknown): string {
  const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
  return ['OV', clean(cardName), clean(cardCode), clean(firstLine)].filter(Boolean).join(' - ').slice(0, 250);
}

/** Línea editada de una oferta en borrador: BaseLine = línea de la cotización (null si es nueva). */
export type EditLine = OfferLine & { BaseLine?: number | null };

/**
 * Actualización de una oferta en borrador (como useEditQuotationLines de SAPSEND, corregido):
 * 1) PATCH Quotations con TODAS las líneas (las existentes con su LineNum, las nuevas sin él) y
 *    B1S-ReplaceCollectionsOnPatch; 2) se relee la cotización para saber el LineNum de las nuevas;
 * 3) PATCH Drafts con todas las líneas enlazadas a su línea real (BaseType 23 / BaseLine).
 * El cliente no cambia (como SAPSEND). PURO.
 */
export function buildQuotationUpdate(h: OfferHeader, lines: EditLine[]) {
  const head = header(h);
  delete (head as Record<string, unknown>).CardCode;
  return {
    ...head,
    DocumentLines: lines.map((l) => (l.BaseLine != null ? { LineNum: l.BaseLine, ...line(l) } : line(l))),
  };
}

/** LineNum de cada línea editada tras actualizar la cotización: las existentes conservan el suyo y
 *  las nuevas toman, en orden, los LineNum que no existían antes. */
export function mapQuotationLines(lines: EditLine[], before: number[], after: number[]): number[] {
  const prev = new Set(before);
  const fresh = after.filter((n) => !prev.has(n)).sort((a, b) => a - b);
  let k = 0;
  return lines.map((l) => (l.BaseLine != null ? l.BaseLine : (fresh[k++] ?? -1)));
}

export function buildDraftUpdate(h: OfferHeader, lines: EditLine[], quotationDocEntry: number, baseLines: number[]) {
  const head = header(h);
  delete (head as Record<string, unknown>).CardCode;
  return {
    ...head,
    DocumentLines: lines.map((l, i) => ({ ...line(l), BaseType: 23, BaseEntry: quotationDocEntry, BaseLine: baseLines[i] })),
  };
}
