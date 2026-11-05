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
 *
 * Dirección (corrección 2026-11-05, pedidos 2782/2783 de pruebas OLP): antes solo se copiaba
 * el texto Address2 y SAP, al recibir un texto explícito, dejaba vacíos los componentes de
 * envío (calle, ciudad, código postal, departamento, país y U_HBT_MunMedS, el municipio de la
 * factura electrónica). Ahora se copia AddressExtension completo del borrador y SAP arma el
 * texto; Address2 solo se envía si el borrador no trae componentes de envío.
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
  'ShipFrom',
  'ShipToCode',
  'PayToCode',
  'NumAtCard',
  'DocCurrency',
  'U_SEND_InterComments',
] as const;

/** Propiedades de AddressExtension que no son de la dirección de envío/facturación o que SAP no acepta en el POST. */
const ADDRESS_SKIP = /^(DocEntry|GoodsIssuePlace|DeliveryPlace|PlaceOfSupply|PurchasePlaceOfSupply)/;

const present = (v: unknown) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');

/** Componentes de dirección del borrador (ShipTo*, BillTo* y UDF U_*), sin nulos ni campos ajenos. PURA. */
export function addressExtensionOf(draft: Record<string, unknown>): Record<string, unknown> | null {
  const ext = draft.AddressExtension;
  if (!ext || typeof ext !== 'object') return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ext as Record<string, unknown>)) {
    if (ADDRESS_SKIP.test(k) || k.startsWith('odata.')) continue;
    if (!/^(ShipTo|BillTo|U_)/.test(k)) continue;
    if (present(v)) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Motivo para NO crear el pedido por falta de dirección de envío, o null si está completa.
 * Sin ShipToCode, el borrador debe traer al menos código postal y municipio de envío
 * (U_HBT_MunMedS lo exige la factura electrónica). PURA.
 */
export function shipAddressProblem(draft: Record<string, unknown>): string | null {
  if (present(draft.ShipToCode)) return null;
  const ext = (draft.AddressExtension ?? {}) as Record<string, unknown>;
  const faltan = [
    present(ext.ShipToZipCode) ? null : 'código postal',
    present(ext.U_HBT_MunMedS) ? null : 'municipio (U_HBT_MunMedS)',
  ].filter(Boolean);
  if (!faltan.length) return null;
  return `Revisar dirección: el borrador ${String(draft.DocEntry ?? '')} no trae dirección de envío (sin ShipToCode ni ${faltan.join(' ni ')}). Complétela en SAP; no se crea el pedido.`;
}

/** Payload del POST Orders. `today` en AAAA-MM-DD (hora de Bogota). */
export function buildOrderPayload(draft: SalesDraft, today: string) {
  const header: Record<string, unknown> = {};
  for (const f of HEADER_FIELDS) {
    if (draft[f] !== undefined && draft[f] !== null) header[f] = draft[f];
  }
  const address = addressExtensionOf(draft);
  if (address) header.AddressExtension = address;
  // Con componentes de envío, SAP arma el texto «Destino»; mandarle Address2 explícito los deja vacíos.
  const hasShipComponents = !!address && Object.keys(address).some((k) => k.startsWith('ShipTo') || k === 'U_HBT_MunMedS');
  if (!hasShipComponents && present(draft.Address2)) header.Address2 = draft.Address2;
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
