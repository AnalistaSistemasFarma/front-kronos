/**
 * Constantes PURAS (sin dependencias de servidor) del modulo de Socios de
 * Negocio (entidad estandar BusinessPartners / OCRD de SAP B1). Las usa la UI
 * (tabla, filtros) y el $select del servidor.
 *
 * Modulo SOLO LECTURA: aqui solo se definen los campos estandar que se traen y
 * las utilidades de presentacion. No hay campos personalizados U_* mapeados
 * (a diferencia de Articulos) porque el listado consolidado solo muestra el
 * nucleo comercial del socio; el esquema OCRD es identico entre empresas.
 */

/** Tipo de dato de un campo estandar, para renderizado en la UI. */
export type PartnerFieldType = 'string' | 'int' | 'cardType' | 'flag' | 'currency';

export interface StandardField {
  /** Etiqueta en espanol para la UI. */
  label: string;
  /** Nombre OData del campo en la entidad BusinessPartners. */
  field: string;
  type: PartnerFieldType;
}

/**
 * Campos estandar de OCRD que trae el listado consolidado (con $select).
 * El orden refleja las columnas de la tabla.
 */
export const STANDARD_FIELDS: StandardField[] = [
  { label: 'Codigo', field: 'CardCode', type: 'string' },
  { label: 'Nombre', field: 'CardName', type: 'string' },
  { label: 'Tipo', field: 'CardType', type: 'cardType' },
  { label: 'Grupo', field: 'GroupCode', type: 'int' },
  { label: 'Telefono', field: 'Phone1', type: 'string' },
  { label: 'Correo', field: 'EmailAddress', type: 'string' },
  { label: 'NIT', field: 'FederalTaxID', type: 'string' },
  { label: 'Saldo', field: 'CurrentAccountBalance', type: 'currency' },
  { label: 'Moneda', field: 'Currency', type: 'string' },
  { label: 'Activo (valido)', field: 'Valid', type: 'flag' },
  { label: 'Inactivo (congelado)', field: 'Frozen', type: 'flag' },
  { label: 'Ciudad', field: 'City', type: 'string' },
  { label: 'Direccion', field: 'Address', type: 'string' },
  { label: 'Contacto', field: 'ContactPerson', type: 'string' },
];

/** Nombres de los campos estandar (para el $select del listado). */
export const STANDARD_FIELD_NAMES = STANDARD_FIELDS.map((f) => f.field);

/** Campos estandar enteros. */
export const INT_FIELDS = ['GroupCode'];

/** Banderas booleanas de SAP B1 (BoYesNoEnum). */
export const FLAG_YES = 'tYES';
export const FLAG_NO = 'tNO';

/** Campos estandar que son banderas tYES/tNO. */
export const FLAG_FIELDS = ['Valid', 'Frozen'];

/** Tipos de socio de SAP B1 (enum BoCardTypes). */
export const CARD_TYPES: { value: string; label: string }[] = [
  { value: 'cCustomer', label: 'Cliente' },
  { value: 'cSupplier', label: 'Proveedor' },
  { value: 'cLid', label: 'Lead' },
];

/** Etiqueta en espanol para un CardType de SAP. */
export function cardTypeLabel(value: unknown): string {
  const match = CARD_TYPES.find((t) => t.value === value);
  return match ? match.label : String(value ?? '-');
}
