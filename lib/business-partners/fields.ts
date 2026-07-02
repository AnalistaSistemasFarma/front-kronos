/**
 * Constantes PURAS (sin dependencias de servidor) del modulo de Socios de
 * Negocio (entidad estandar BusinessPartners / OCRD de SAP B1). Las usa la UI
 * (tabla, filtros, formulario de detalle/edicion) y el servidor ($select del
 * listado y whitelist de actualizacion).
 *
 * El esquema OCRD es identico entre empresas. La ficha de detalle trae la
 * entidad COMPLETA (sin $select restrictivo) mas las colecciones hijas clave
 * (direcciones, contactos, cuentas bancarias). La edicion trabaja sobre el
 * ENCABEZADO del socio (campos escalares) y cualquier campo de usuario U_*.
 */

/** Tipo de dato de un campo estandar, para renderizado en la UI. */
export type PartnerFieldType = 'string' | 'int' | 'cardType' | 'flag' | 'currency';

export interface StandardField {
  /** Etiqueta en espanol para la UI. */
  label: string;
  /** Nombre OData del campo en la entidad BusinessPartners. */
  field: string;
  type: PartnerFieldType;
  /** Editable tras la creacion (en EditModal). false = solo lectura. */
  editable?: boolean;
}

/**
 * Campos estandar de OCRD gestionados por el modulo (listado + detalle).
 * El orden refleja las columnas de la tabla y las secciones del detalle.
 *
 * `editable: true` = campo del encabezado que se puede actualizar (PATCH).
 * La clave del socio (CardCode) NUNCA es editable.
 */
export const STANDARD_FIELDS: StandardField[] = [
  { label: 'Codigo', field: 'CardCode', type: 'string', editable: false },
  { label: 'Nombre', field: 'CardName', type: 'string', editable: true },
  { label: 'Tipo', field: 'CardType', type: 'cardType', editable: true },
  { label: 'Grupo', field: 'GroupCode', type: 'int', editable: true },
  { label: 'Telefono', field: 'Phone1', type: 'string', editable: true },
  { label: 'Correo', field: 'EmailAddress', type: 'string', editable: true },
  { label: 'NIT', field: 'FederalTaxID', type: 'string', editable: true },
  { label: 'Saldo', field: 'CurrentAccountBalance', type: 'currency', editable: false },
  { label: 'Moneda', field: 'Currency', type: 'string', editable: true },
  { label: 'Activo (valido)', field: 'Valid', type: 'flag', editable: true },
  { label: 'Inactivo (congelado)', field: 'Frozen', type: 'flag', editable: true },
  { label: 'Ciudad', field: 'City', type: 'string', editable: false },
  { label: 'Direccion', field: 'Address', type: 'string', editable: false },
  { label: 'Contacto', field: 'ContactPerson', type: 'string', editable: true },
];

/** Nombres de los campos estandar (para el $select del listado). */
export const STANDARD_FIELD_NAMES = STANDARD_FIELDS.map((f) => f.field);

/**
 * Campos estandar del ENCABEZADO editables en la actualizacion (PATCH). Estos y
 * SOLO estos (mas los campos de usuario U_*) se aceptan al guardar. Son los
 * campos escalares seguros del socio; NO se editan colecciones hijas aqui.
 */
export const EDITABLE_STANDARD_FIELDS: StandardField[] = [
  { label: 'Nombre', field: 'CardName', type: 'string', editable: true },
  { label: 'Tipo', field: 'CardType', type: 'cardType', editable: true },
  { label: 'Grupo', field: 'GroupCode', type: 'int', editable: true },
  { label: 'Telefono 1', field: 'Phone1', type: 'string', editable: true },
  { label: 'Telefono 2', field: 'Phone2', type: 'string', editable: true },
  { label: 'Celular', field: 'Cellular', type: 'string', editable: true },
  { label: 'Fax', field: 'Fax', type: 'string', editable: true },
  { label: 'Correo', field: 'EmailAddress', type: 'string', editable: true },
  { label: 'Sitio web', field: 'Website', type: 'string', editable: true },
  { label: 'Persona de contacto', field: 'ContactPerson', type: 'string', editable: true },
  { label: 'Notas', field: 'Notes', type: 'string', editable: true },
  { label: 'NIT', field: 'FederalTaxID', type: 'string', editable: true },
  { label: 'Moneda', field: 'Currency', type: 'string', editable: true },
  { label: 'Grupo de condiciones de pago', field: 'PayTermsGrpCode', type: 'int', editable: true },
  { label: 'Congelado (inactivo)', field: 'Frozen', type: 'flag', editable: true },
  { label: 'Activo (valido)', field: 'Valid', type: 'flag', editable: true },
  { label: 'Congelado desde', field: 'FrozenFrom', type: 'string', editable: true },
  { label: 'Congelado hasta', field: 'FrozenTo', type: 'string', editable: true },
];

/** Nombres de los campos editables en la actualizacion (whitelist del PATCH). */
export const EDITABLE_ON_UPDATE = EDITABLE_STANDARD_FIELDS.map((f) => f.field);

/** Campos escalares que se muestran en la seccion "Generales" del detalle. */
export const GENERAL_FIELDS: StandardField[] = [
  { label: 'Codigo', field: 'CardCode', type: 'string', editable: false },
  { label: 'Nombre', field: 'CardName', type: 'string', editable: true },
  { label: 'Tipo', field: 'CardType', type: 'cardType', editable: true },
  { label: 'Grupo', field: 'GroupCode', type: 'int', editable: true },
  { label: 'NIT', field: 'FederalTaxID', type: 'string', editable: true },
  { label: 'Moneda', field: 'Currency', type: 'string', editable: true },
  { label: 'Saldo', field: 'CurrentAccountBalance', type: 'currency', editable: false },
  { label: 'Telefono 1', field: 'Phone1', type: 'string', editable: true },
  { label: 'Telefono 2', field: 'Phone2', type: 'string', editable: true },
  { label: 'Celular', field: 'Cellular', type: 'string', editable: true },
  { label: 'Fax', field: 'Fax', type: 'string', editable: true },
  { label: 'Correo', field: 'EmailAddress', type: 'string', editable: true },
  { label: 'Sitio web', field: 'Website', type: 'string', editable: true },
  { label: 'Persona de contacto', field: 'ContactPerson', type: 'string', editable: true },
  { label: 'Grupo de condiciones de pago', field: 'PayTermsGrpCode', type: 'int', editable: true },
  { label: 'Activo (valido)', field: 'Valid', type: 'flag', editable: true },
  { label: 'Congelado (inactivo)', field: 'Frozen', type: 'flag', editable: true },
  { label: 'Notas', field: 'Notes', type: 'string', editable: true },
];

/** Nombres de todos los campos del encabezado gestionados (estandar + editables + generales). */
export const MANAGED_FIELD_NAMES = Array.from(
  new Set([
    ...STANDARD_FIELDS.map((f) => f.field),
    ...EDITABLE_STANDARD_FIELDS.map((f) => f.field),
    ...GENERAL_FIELDS.map((f) => f.field),
  ])
);

/** Campos estandar enteros (se envian como numero, no cadena). */
export const INT_FIELDS = ['GroupCode', 'PayTermsGrpCode'];

/** Banderas booleanas de SAP B1 (BoYesNoEnum). */
export const FLAG_YES = 'tYES';
export const FLAG_NO = 'tNO';

/** Campos estandar que son banderas tYES/tNO. */
export const FLAG_FIELDS = ['Valid', 'Frozen'];

/** Campos cuyo cambio (activar/inactivar) exige confirmacion explicita en la UI. */
export const CONFIRM_FIELDS = ['Valid', 'Frozen'];

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

/**
 * Etiqueta legible para un campo de usuario U_* que NO esta mapeado: quita el
 * prefijo `U_` y reemplaza guiones bajos por espacios.
 * Ej. "U_Regimen_Trib" -> "Regimen Trib".
 */
export function humanizeCustomField(field: string): string {
  return field
    .replace(/^U_/, '')
    .replace(/_/g, ' ')
    .trim();
}

/**
 * Columnas de las colecciones hijas que se muestran en el detalle. Se muestran
 * en tablas de solo lectura; SAP puede devolver muchos mas campos por fila pero
 * estos son los relevantes para la ficha.
 */
export const ADDRESS_COLUMNS: { label: string; field: string }[] = [
  { label: 'Nombre', field: 'AddressName' },
  { label: 'Tipo', field: 'AddressType' },
  { label: 'Calle', field: 'Street' },
  { label: 'Ciudad', field: 'City' },
  { label: 'Departamento', field: 'State' },
  { label: 'Pais', field: 'Country' },
  { label: 'Codigo postal', field: 'ZipCode' },
];

export const CONTACT_COLUMNS: { label: string; field: string }[] = [
  { label: 'Nombre', field: 'Name' },
  { label: 'Cargo', field: 'Position' },
  { label: 'Telefono', field: 'Phone1' },
  { label: 'Celular', field: 'MobilePhone' },
  { label: 'Correo', field: 'E_Mail' },
];

export const BANK_ACCOUNT_COLUMNS: { label: string; field: string }[] = [
  { label: 'Banco', field: 'BankCode' },
  { label: 'Cuenta', field: 'AccountNo' },
  { label: 'Titular', field: 'AccountName' },
  { label: 'Sucursal', field: 'Branch' },
];

/** Etiqueta legible para el tipo de direccion de SAP (BoAddressType). */
export function addressTypeLabel(value: unknown): string {
  if (value === 'bo_BillTo') return 'Facturacion';
  if (value === 'bo_ShipTo') return 'Envio';
  return String(value ?? '-');
}
