/**
 * Fuentes SAP curadas para los "campos condicionales" de Solicitudes Generales.
 *
 * Cada fuente es, a la vez, un `field_type` de `process_form_field` (ej. 'sap_items').
 * Al crear la solicitud, un campo con ese tipo se renderiza como un selector buscable
 * que consulta en vivo la entidad SAP indicada (via /api/requests-general/sap-options) y
 * guarda el valor elegido en `value_text` (misma tuberia que un campo de texto).
 *
 * Este modulo es PURO (sin Prisma ni imports de servidor) para poder importarse desde
 * componentes de cliente (builders y create-request). El resolver del endpoint SAP por
 * empresa vive en la ruta del servidor.
 */

export interface SapSource {
  /** Etiqueta visible en el builder y como badge del tipo. */
  label: string;
  /** Entidad OData del Service Layer (ej. 'Items'). */
  entity: string;
  /** Campo que actua como valor (ej. 'ItemCode'). */
  valueField: string;
  /** Campo que actua como etiqueta legible (ej. 'ItemName'). */
  labelField: string;
  /** Campos sobre los que se hace contains() al buscar. */
  searchFields: string[];
  /** Campos a traer con $select. */
  selectFields: string[];
  /** Filtro OData fijo adicional (opcional), unido con ' and '. */
  fixedFilter?: string;
}

export const SAP_SOURCES: Record<string, SapSource> = {
  sap_items: {
    label: 'Artículo (SAP)',
    entity: 'Items',
    valueField: 'ItemCode',
    labelField: 'ItemName',
    searchFields: ['ItemName', 'ItemCode'],
    selectFields: ['ItemCode', 'ItemName'],
    fixedFilter: "Valid eq 'tYES' and Frozen eq 'tNO'",
  },
  sap_business_partners: {
    label: 'Socio de negocio (SAP)',
    entity: 'BusinessPartners',
    valueField: 'CardCode',
    labelField: 'CardName',
    searchFields: ['CardName', 'CardCode'],
    selectFields: ['CardCode', 'CardName'],
    fixedFilter: "Valid eq 'tYES' and Frozen eq 'tNO'",
  },
};

export const SAP_SOURCE_KEYS = Object.keys(SAP_SOURCES);

/** True si el field_type corresponde a una fuente SAP curada. */
export function isSapField(fieldType: string | null | undefined): boolean {
  return !!fieldType && SAP_SOURCE_KEYS.includes(fieldType);
}
