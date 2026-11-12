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
 *
 * RN de Nicolás Rivera (2026-11-05), reemplaza el bloqueo «Revisar dirección» del #883:
 *  - El pedido SIEMPRE lleva ShipToCode: el del borrador o, si no lo trae, el resuelto en la
 *    ficha del cliente (dirección de envío con la misma calle y ciudad; si no, ShipToDefault).
 *    Si el cliente no tiene direcciones de envío, el pedido sale sin ShipToCode. Nunca bloquea.
 *  - No se valida código postal, municipio ni UDF U_HBT_*: lo que llegue en AddressExtension
 *    manda, y lo que falte se completa con la dirección de envío del cliente (ver
 *    shipFieldsFromBp; SAP no lo completa solo cuando el POST trae AddressExtension).
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

/** Dirección de la ficha del cliente (BusinessPartners.BPAddresses), solo lo que se usa. */
export type BpAddress = Record<string, unknown> & {
  AddressName?: string | null;
  AddressType?: string | null;
  Street?: string | null;
  City?: string | null;
};

/** Lo que se lee del cliente para resolver la dirección de envío del pedido. */
export type BpShipInfo = { ShipToDefault?: string | null; BPAddresses?: BpAddress[] | null };

/** Mayúsculas, sin tildes y con espacios simples, para comparar calle y ciudad. */
export const normAddr = (v: unknown) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

export type ShipToResolution = {
  code: string | null;
  via: 'borrador' | 'coincidencia' | 'defecto' | 'ninguna';
  address: BpAddress | null;
};

/**
 * ShipToCode del pedido (RN 2026-11-05). PURA.
 *  1. el del borrador, si lo trae;
 *  2. la dirección bo_ShipTo del cliente con la misma calle y ciudad del AddressExtension;
 *  3. la ShipToDefault del cliente (o, si no tiene, su primera dirección de envío);
 *  4. ninguna: el cliente no tiene direcciones de envío y el pedido sale sin ShipToCode.
 */
export function resolveShipTo(draft: Record<string, unknown>, bp: BpShipInfo | null | undefined): ShipToResolution {
  const shipTos = (bp?.BPAddresses ?? []).filter((a) => a?.AddressType === 'bo_ShipTo' && present(a.AddressName));
  const byName = (name: unknown) => shipTos.find((a) => a.AddressName === name) ?? shipTos.find((a) => normAddr(a.AddressName) === normAddr(name)) ?? null;
  if (present(draft.ShipToCode)) {
    return { code: String(draft.ShipToCode), via: 'borrador', address: byName(draft.ShipToCode) };
  }
  if (!shipTos.length) return { code: null, via: 'ninguna', address: null };
  const ext = (draft.AddressExtension ?? {}) as Record<string, unknown>;
  const street = normAddr(ext.ShipToStreet);
  const city = normAddr(ext.ShipToCity);
  if (street && city) {
    const hit = shipTos.find((a) => normAddr(a.Street) === street && normAddr(a.City) === city);
    if (hit) return { code: String(hit.AddressName), via: 'coincidencia', address: hit };
  }
  const def = present(bp?.ShipToDefault) ? byName(bp!.ShipToDefault) : null;
  const chosen = def ?? shipTos[0];
  return { code: String(chosen.AddressName), via: 'defecto', address: chosen };
}

/** Campo de BPAddresses → campo ShipTo* del AddressExtension del documento. */
const BP_TO_SHIP: Record<string, string> = {
  Street: 'ShipToStreet',
  StreetNo: 'ShipToStreetNo',
  Block: 'ShipToBlock',
  BuildingFloorRoom: 'ShipToBuilding',
  City: 'ShipToCity',
  ZipCode: 'ShipToZipCode',
  County: 'ShipToCounty',
  State: 'ShipToState',
  Country: 'ShipToCountry',
  AddressName2: 'ShipToAddress2',
  AddressName3: 'ShipToAddress3',
  GlobalLocationNumber: 'ShipToGlobalLocationNumber',
  U_HBT_MunMed: 'U_HBT_MunMedS',
  U_HBT_DirMM: 'U_HBT_DirMMS',
};

/** Componentes de envío de una dirección de la ficha del cliente, sin vacíos. PURA. */
export function shipFieldsFromBp(addr: BpAddress | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!addr) return out;
  for (const [from, to] of Object.entries(BP_TO_SHIP)) if (present(addr[from])) out[to] = addr[from];
  return out;
}

/**
 * Payload del POST Orders. `today` en AAAA-MM-DD (hora de Bogota). `bp`: dirección de envío
 * del cliente (BusinessPartners) para resolver el ShipToCode y completar lo que no traiga el
 * borrador; sin `bp` se usa solo lo del borrador.
 */
export function buildOrderPayload(draft: SalesDraft, today: string, bp?: BpShipInfo | null) {
  const header: Record<string, unknown> = {};
  for (const f of HEADER_FIELDS) {
    if (draft[f] !== undefined && draft[f] !== null) header[f] = draft[f];
  }
  const ship = resolveShipTo(draft, bp);
  if (ship.code) header.ShipToCode = ship.code;
  else delete header.ShipToCode;
  const received = addressExtensionOf(draft);
  // Lo que llegue manda; lo que falte viene de la ficha del cliente.
  const address = received || ship.address ? { ...shipFieldsFromBp(ship.address), ...(received ?? {}) } : null;
  if (address && Object.keys(address).length) header.AddressExtension = address;
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
    // Descripción (puede venir escrita por el usuario: servicios), precio de lista y cantidad solicitada, como el borrador.
    if (present(l.ItemDescription)) out.ItemDescription = l.ItemDescription;
    if (l.U_SEND_PriceLP != null) out.U_SEND_PriceLP = l.U_SEND_PriceLP;
    if (l.U_HBT_Cantidad != null) out.U_HBT_Cantidad = l.U_HBT_Cantidad;
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
