/**
 * Constantes PURAS (sin dependencias de servidor) del modulo de Compras.
 *
 * Las solicitudes y ordenes de compra de SAPSEND viven como Drafts (borradores)
 * de SAP B1, diferenciados por DocObjectCode (string):
 *   - 'oPurchaseRequest'  -> Solicitud de compra
 *   - 'oPurchaseOrders'   -> Orden de compra (preliminar)
 *
 * El esquema de cabecera es el mismo de cualquier documento de marketing de SAP
 * B1 (DocEntry, DocNum, fechas, CardCode/CardName, DocTotal...) mas la familia
 * de campos personalizados U_SEND_* que escribe SAPSEND (estado, enlaces entre
 * fases, creador, dependencia). Verificado con una muestra real de OLP el
 * 2026-06-28.
 *
 * CAVEAT Service Layer: un Draft completo pesa ~50.000 caracteres -> el listado
 * SIEMPRE usa el $select acotado de abajo; el detalle (item) trae el objeto
 * completo. NO se usa $expand=DocumentLines (no soportado por el wrapper).
 */

/** Los dos tipos de documento de compras del MVP. */
export type PurchaseTipo = 'solicitudes' | 'ordenes';

/** DocObjectCode (string) de SAP B1 por tipo. */
export const DOC_OBJECT_CODE: Record<PurchaseTipo, string> = {
  solicitudes: 'oPurchaseRequest',
  ordenes: 'oPurchaseOrders',
};

/** Tipo de dato de un campo de cabecera, para renderizado/formateo en la UI. */
export type PurchaseFieldType = 'string' | 'int' | 'date' | 'currency' | 'state';

export interface PurchaseColumn {
  /** Etiqueta en espanol para la UI. */
  label: string;
  /** Nombre OData del campo en la entidad Drafts. */
  field: string;
  type: PurchaseFieldType;
}

/**
 * Columnas de cabecera mostradas en el listado consolidado. Comunes a
 * solicitudes y ordenes (mismo esquema de Draft). Definen tambien el $select.
 */
export const HEADER_COLUMNS: PurchaseColumn[] = [
  { label: 'Numero', field: 'DocNum', type: 'int' },
  { label: 'Fecha', field: 'DocDate', type: 'date' },
  { label: 'Proveedor', field: 'CardName', type: 'string' },
  { label: 'Solicitante', field: 'U_SEND_UserName', type: 'string' },
  { label: 'Estado', field: 'U_SEND_State', type: 'state' },
  { label: 'Total', field: 'DocTotal', type: 'currency' },
];

/**
 * Campos del $select acotado del listado. Incluye los de las columnas mas los
 * necesarios para identificar/enlazar el documento (DocEntry es la clave real),
 * filtrar y abrir el detalle.
 */
export const LIST_SELECT_FIELDS: string[] = [
  'DocEntry',
  'DocNum',
  'DocObjectCode',
  'DocDate',
  'DocDueDate',
  'TaxDate',
  'CardCode',
  'CardName',
  'DocTotal',
  'DocCurrency',
  'Comments',
  'RequesterName',
  'CreationDate',
  'UpdateDate',
  'U_SEND_State',
  'U_SEND_SolCom',
  'U_SEND_OrdCom',
  'U_SEND_UserName',
  'U_SEND_UserEmail',
  'U_SEND_Dep',
];

/** El $select acotado, ya unido, listo para la query. */
export const LIST_SELECT = LIST_SELECT_FIELDS.join(',');

/**
 * Campos de cabecera mostrados en el detalle (solo lectura). Se proyectan del
 * Draft completo que devuelve el endpoint item. Etiqueta espanol <-> campo OData.
 */
export const DETAIL_FIELDS: PurchaseColumn[] = [
  { label: 'Numero de documento', field: 'DocNum', type: 'int' },
  { label: 'Estado', field: 'U_SEND_State', type: 'state' },
  { label: 'Fecha del documento', field: 'DocDate', type: 'date' },
  { label: 'Fecha de vencimiento', field: 'DocDueDate', type: 'date' },
  { label: 'Fecha contable', field: 'TaxDate', type: 'date' },
  { label: 'Codigo proveedor', field: 'CardCode', type: 'string' },
  { label: 'Proveedor', field: 'CardName', type: 'string' },
  { label: 'Total', field: 'DocTotal', type: 'currency' },
  { label: 'Moneda', field: 'DocCurrency', type: 'string' },
  { label: 'Solicitante (SAPSEND)', field: 'U_SEND_UserName', type: 'string' },
  { label: 'Correo solicitante', field: 'U_SEND_UserEmail', type: 'string' },
  { label: 'Dependencia', field: 'U_SEND_Dep', type: 'string' },
  { label: 'Solicitante (SAP)', field: 'RequesterName', type: 'string' },
  { label: 'Nro. solicitud (firme)', field: 'U_SEND_SolCom', type: 'string' },
  { label: 'Nro. orden (firme)', field: 'U_SEND_OrdCom', type: 'string' },
  { label: 'Fecha de creacion', field: 'CreationDate', type: 'date' },
  { label: 'Ultima modificacion', field: 'UpdateDate', type: 'date' },
  { label: 'Comentarios', field: 'Comments', type: 'string' },
];

/**
 * Mapa de estados U_SEND_State -> etiqueta legible (flujo de compras).
 * Segun la skill analisis-compras-sapsend y el modelo de la Fase 2:
 *   B   borrador
 *   ENC en cotizacion
 *   LA  autorizacion de lider de area
 *   A   aprobado
 *   NAD rechazado
 * Otros valores nominales documentados (DA, C) se incluyen por robustez.
 */
export const STATE_LABELS: Record<string, string> = {
  B: 'Borrador',
  ENC: 'En cotizacion',
  C: 'En cotizacion',
  DA: 'Autorizacion lider de area',
  LA: 'Autorizacion lider de area',
  A: 'Aprobado',
  NAD: 'Rechazado',
};

/** Color Mantine para el Badge de estado. */
export const STATE_COLOR: Record<string, string> = {
  B: 'gray',
  ENC: 'blue',
  C: 'blue',
  DA: 'yellow',
  LA: 'yellow',
  A: 'green',
  NAD: 'red',
};

/** Etiqueta legible de un estado; devuelve el codigo crudo si no esta mapeado. */
export function stateLabel(state: unknown): string {
  if (state == null || state === '') return 'Sin estado';
  const code = String(state).trim();
  return STATE_LABELS[code] ?? code;
}

/** Color del Badge de estado (gris por defecto). */
export function stateColor(state: unknown): string {
  if (state == null || state === '') return 'gray';
  const code = String(state).trim();
  return STATE_COLOR[code] ?? 'gray';
}
