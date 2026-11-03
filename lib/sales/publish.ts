/**
 * Creacion PURA del pedido de venta (Orders) a partir del borrador aprobado.
 * Replica el POST Orders de SAPSEND (useSendToApproveQuotation.jsx 4b,
 * priceAuthorization y balanceAuthorizationDA) con dos diferencias deliberadas:
 *
 *  - Idempotencia sin campo nuevo en SAP (Nicolas Rivera, 2026-10-30): el pedido
 *    nace con U_SEND_SolCom = 'V<DocEntry del borrador>'. Ese UDF existe en las 7
 *    bases y no se usa en pedidos de venta. Antes de crear, el servidor busca un
 *    pedido con esa marca; si existe, no crea otro y solo termina de marcar y
 *    cerrar el borrador. (SAPSEND podia duplicar el pedido en un reintento.)
 *  - Lineas con base solo si la tienen: los borradores de Salesforce no nacen de
 *    una cotizacion, asi que no se inventa BaseType/BaseEntry (SAPSEND usaba el
 *    BaseEntry de la primera linea para todas).
 *
 * El pedido queda en U_SEND_State 'A' cuando la oferta fue autorizada.
 */

/** Marca del pedido que enlaza con su borrador. */
export function orderMarker(draftDocEntry: number): string {
  return `V${draftDocEntry}`;
}

/** Lee el DocEntry del borrador desde la marca ('V123' -> 123), o null. */
export function parseOrderMarker(value: unknown): number | null {
  const m = /^V(\d+)$/.exec(String(value ?? '').trim());
  return m ? Number(m[1]) : null;
}

/** Filtro OData para buscar el pedido ya creado de un borrador. */
export function orderLookupFilter(draftDocEntry: number): string {
  return `U_SEND_SolCom eq '${orderMarker(Math.trunc(draftDocEntry))}'`;
}

type Line = Record<string, unknown> & {
  ItemCode?: string;
  Quantity?: number;
  BaseType?: number | null;
  BaseEntry?: number | null;
  BaseLine?: number | null;
};

export type SalesDraft = Record<string, unknown> & {
  DocEntry: number;
  CardCode: string;
  DocumentLines?: Line[];
};

const HEADER_FIELDS = [
  'CardCode',
  'DocDueDate',
  'Comments',
  'PickRemark',
  'Address2',
  'ShipFrom',
  'ShipToCode',
  'PayToCode',
  'NumAtCard',
  'DocCurrency',
  'U_SEND_InterComments',
] as const;

/** Payload del POST Orders. `today` en AAAA-MM-DD (hora de Bogota). */
export function buildOrderPayload(draft: SalesDraft, today: string) {
  const header: Record<string, unknown> = {};
  for (const f of HEADER_FIELDS) {
    if (draft[f] !== undefined && draft[f] !== null) header[f] = draft[f];
  }
  const lines = (draft.DocumentLines ?? []).map((l) => {
    const out: Record<string, unknown> = {
      ItemCode: l.ItemCode,
      Quantity: l.Quantity,
      WarehouseCode: l.WarehouseCode,
      TaxCode: l.TaxCode,
      UnitPrice: l.UnitPrice ?? l.Price,
    };
    if (l.BaseType === 23 && l.BaseEntry != null && l.BaseLine != null) {
      out.BaseType = 23;
      out.BaseEntry = l.BaseEntry;
      out.BaseLine = l.BaseLine;
    }
    return out;
  });
  return {
    ...header,
    DocDate: today,
    DocObjectCode: 'oOrders',
    U_SEND_State: 'A',
    U_SEND_SolCom: orderMarker(draft.DocEntry),
    DocumentLines: lines,
  };
}
