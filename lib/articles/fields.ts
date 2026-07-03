/**
 * Constantes PURAS (sin dependencias de servidor) del modulo de Articulos
 * (entidad estandar Items / OITM de SAP B1). Las usan tanto la UI (formularios,
 * plantilla y lectura del Excel) como las validaciones del servidor.
 *
 * Los campos estandar son identicos entre las 5 empresas (mismo esquema OITM).
 * Lo que varia es el bloque de campos personalizados U_*: cada empresa tiene su
 * propia familia. Por eso COMPANY_CUSTOM_FIELDS mapea los custom POR empresa.
 */

/** Tipo de dato de un campo estandar de Items, para renderizado en la UI. */
export type ArticleFieldType = 'string' | 'int' | 'itemType' | 'flag';

export interface StandardField {
  /** Etiqueta en espanol para la UI. */
  label: string;
  /** Nombre OData del campo en la entidad Items. */
  field: string;
  type: ArticleFieldType;
  /** Editable tras la creacion (en EditModal). */
  editable: boolean;
  /** Obligatorio en la creacion (set minimo). */
  requiredOnCreate?: boolean;
  /** Aparece como columna en el Excel de cargue masivo. */
  inExcel?: boolean;
}

/**
 * Campos estandar de OITM gestionados por el modulo.
 * Set minimo de creacion = ItemCode + ItemName + ItemsGroupCode.
 */
export const STANDARD_FIELDS: StandardField[] = [
  { label: 'Codigo', field: 'ItemCode', type: 'string', editable: false, requiredOnCreate: true, inExcel: true },
  // RN: la descripcion NO es editable en la actualizacion (solo se captura al crear).
  { label: 'Descripcion', field: 'ItemName', type: 'string', editable: false, requiredOnCreate: true, inExcel: true },
  // RN: en la ACTUALIZACIÓN se permite editar el Código de barras (BarCode) y el
  // Proveedor principal (Mainsupplier = CardCode del proveedor). El resto queda de
  // solo lectura (SAP solo admite esos cambios por ahora).
  { label: 'Grupo de articulos', field: 'ItemsGroupCode', type: 'int', editable: false, requiredOnCreate: true, inExcel: true },
  { label: 'Nombre extranjero', field: 'ForeignName', type: 'string', editable: false, inExcel: true },
  { label: 'Tipo de articulo', field: 'ItemType', type: 'itemType', editable: false, inExcel: true },
  { label: 'Codigo de barras / GTIN', field: 'BarCode', type: 'string', editable: true, inExcel: true },
  { label: 'Es de ventas', field: 'SalesItem', type: 'flag', editable: false, inExcel: true },
  { label: 'Es de compras', field: 'PurchaseItem', type: 'flag', editable: false, inExcel: true },
  { label: 'Es de inventario', field: 'InventoryItem', type: 'flag', editable: false, inExcel: true },
  { label: 'Activo (valido)', field: 'Valid', type: 'flag', editable: false },
  { label: 'Inactivo (congelado)', field: 'Frozen', type: 'flag', editable: false },
  { label: 'Proveedor principal (CardCode)', field: 'Mainsupplier', type: 'string', editable: true, inExcel: true },
  { label: 'Unidad de venta', field: 'SalesUnit', type: 'string', editable: false, inExcel: true },
  { label: 'Unidad de compra', field: 'PurchaseUnit', type: 'string', editable: false, inExcel: true },
  { label: 'Unidad de inventario', field: 'InventoryUOM', type: 'string', editable: false, inExcel: true },
];

/** Campos permitidos en la ACTUALIZACIÓN (solo estos se envían/aceptan al editar). */
export const EDITABLE_ON_UPDATE = STANDARD_FIELDS.filter((f) => f.editable).map((f) => f.field);

/** Nombres de los campos estandar (para whitelist en el servidor). */
export const STANDARD_FIELD_NAMES = STANDARD_FIELDS.map((f) => f.field);

/** Campos del set minimo de creacion. */
export const REQUIRED_ON_CREATE = STANDARD_FIELDS.filter((f) => f.requiredOnCreate).map((f) => f.field);

/** Tipos de articulo de SAP B1 (enum ItemTypeEnum). */
export const ITEM_TYPES: { value: string; label: string }[] = [
  { value: 'itItems', label: 'Articulo' },
  { value: 'itFixedAssets', label: 'Activo fijo' },
  { value: 'itLabor', label: 'Mano de obra' },
  { value: 'itTravel', label: 'Viaje' },
];

/** Banderas booleanas de SAP B1 (BoYesNoEnum). */
export const FLAG_YES = 'tYES';
export const FLAG_NO = 'tNO';

/** Campos estandar que son banderas tYES/tNO. */
export const FLAG_FIELDS = ['SalesItem', 'PurchaseItem', 'InventoryItem', 'Valid', 'Frozen'];

/** Campos cuyo cambio (activar/inactivar) exige confirmacion explicita en la UI. */
export const CONFIRM_FIELDS = ['Valid', 'Frozen'];

/** Campos estandar enteros. */
export const INT_FIELDS = ['ItemsGroupCode'];

export interface CustomField {
  /** Etiqueta en espanol para la UI. */
  label: string;
  /** Nombre OData del campo U_* en la base SAP de la empresa. */
  field: string;
  /**
   * Editable tras la creacion (en EditModal). Por defecto los custom son de
   * solo lectura; solo los marcados con editable:true se pueden modificar y
   * enviar en la actualizacion. Editar VALORES de UDF por Service Layer esta
   * permitido (es dato, no estructura).
   */
  editable?: boolean;
}

/**
 * Mapa de campos personalizados U_* por empresa.
 *
 * La clave es el NOMBRE de la empresa (columna company.company en BD), tal como
 * lo devuelve el endpoint de acceso. El mismo dato de negocio (CUM, ATC,
 * principio activo, fabricante) vive en campos con nombres distintos segun la
 * empresa, por eso el mapeo es por empresa y no global.
 *
 * COMO ANADIR UNA EMPRESA NUEVA:
 *   1. Agregue una entrada `'<NombreEmpresa>': [ ... ]` a este objeto.
 *   2. Liste sus campos U_* como { label, field }. Eso es todo: la UI los
 *      renderiza dinamicamente, el servidor los acepta en la whitelist por
 *      empresa (ver sanitizeItem) y el $select del listado los incluye.
 *   No hace falta tocar rutas ni componentes.
 *
 * El emparejamiento se hace por nombre normalizado (mayusculas/minusculas y
 * espacios no importan) via getCompanyCustomFields().
 */
export const COMPANY_CUSTOM_FIELDS: Record<string, CustomField[]> = {
  // ONELATAMPHARMA — familia U_IT_* (la mas rica). La clave DEBE coincidir con
  // el nombre real de la empresa en BD (company.company = 'ONELATAMPHARMA', sin
  // espacios); si no coincide, getCompanyCustomFields() no aplica y los campos
  // caen al modo humanizado de solo lectura.
  'ONELATAMPHARMA': [
    { label: 'CUM', field: 'U_IT_CUM' },
    { label: 'ATC', field: 'U_IT_ATC' },
    { label: 'Descripcion ATC', field: 'U_IT_DescAtc' },
    { label: 'Principio activo', field: 'U_IT_Principio_Activo' },
    { label: 'Forma farmaceutica', field: 'U_IT_FormFar' },
    { label: 'Regulado', field: 'U_IT_Regulado' },
    { label: 'Via de administracion', field: 'U_IT_Via_Adm' },
    { label: 'IUM', field: 'U_IT_IUM' },
    { label: 'Temperatura', field: 'U_IT_Temperatura', editable: true },
    { label: 'Agotado', field: 'U_IT_Agotado', editable: true },
    { label: 'Clasificación de producto', field: 'U_ClasificacionProducto', editable: true },
    { label: 'Condición de almacenamiento', field: 'U_IT_Condicion_Almacenamiento', editable: true },
    { label: 'SKU proveedor', field: 'U_IT_SKU_Proveedor' },
    { label: 'Registro sanitario', field: 'U_IT_Registro_Sanitario' },
    { label: 'Vida util', field: 'U_IT_Vida_Util' },
    { label: 'Presentacion comercial', field: 'U_IT_Presentacion_Comercial' },
    { label: 'Concentracion', field: 'U_IT_Concentracion' },
    { label: 'Importador', field: 'U_IT_Importador' },
    { label: 'Fabricante', field: 'U_IT_Fabricante' },
    { label: 'Titular', field: 'U_IT_Titular' },
    { label: 'Linea terapeutica', field: 'U_IT_LineaTerapeutica' },
  ],

  // LABORATORIOS RYAN — familia U_Lab_*.
  'LABORATORIOS RYAN': [
    { label: 'Fabricante', field: 'U_Lab_Fabricante' },
    { label: 'UNSPSC', field: 'U_Lab_UNSPSC' },
    { label: 'IUM', field: 'U_Lab_IUM' },
    { label: 'CUM', field: 'U_Lab_CUM' },
    { label: 'ATC', field: 'U_Lab_ATC' },
    { label: 'Registro sanitario', field: 'U_Lab_RS' },
  ],

  // FARMALOGICA — familia U_* legado.
  FARMALOGICA: [
    { label: 'CUM', field: 'U_Cum' },
    { label: 'Registro sanitario', field: 'U_RegSani' },
    { label: 'Fecha registro sanitario', field: 'U_FecRegSan' },
    { label: 'Titular del registro', field: 'U_TituReg' },
    { label: 'Composicion', field: 'U_Compos' },
    { label: 'Presentacion comercial', field: 'U_PresComer' },
    { label: 'Vida util', field: 'U_VidaUtil' },
    { label: 'Principio activo', field: 'U_principio_activo' },
    { label: 'Forma farmaceutica', field: 'U_Forma_Far' },
    { label: 'IUM', field: 'U_IUM' },
    { label: 'ATC', field: 'U_ATC' },
    { label: 'Linea', field: 'U_Linea' },
  ],

  // MEDITRACK — misma familia U_* legado que Farmalogica.
  MEDITRACK: [
    { label: 'CUM', field: 'U_Cum' },
    { label: 'Registro sanitario', field: 'U_RegSani' },
    { label: 'Fecha registro sanitario', field: 'U_FecRegSan' },
    { label: 'Titular del registro', field: 'U_TituReg' },
    { label: 'Composicion', field: 'U_Compos' },
    { label: 'Presentacion comercial', field: 'U_PresComer' },
    { label: 'Vida util', field: 'U_VidaUtil' },
    { label: 'Principio activo', field: 'U_principio_activo' },
    { label: 'Forma farmaceutica', field: 'U_Forma_Far' },
    { label: 'IUM', field: 'U_IUM' },
    { label: 'ATC', field: 'U_ATC' },
    { label: 'Linea', field: 'U_Linea' },
  ],

  // KELAB — TODO: aun no se conocen sus campos U_* (el MCP devolvio 401 durante
  // el scoping). Por ahora SOLO estandar. Cuando se confirmen, agreguelos aqui.
  KELAB: [],
};

/** Normaliza un nombre de empresa para emparejar con las claves del mapa. */
function normalizeCompanyName(name: string): string {
  return name.trim().toUpperCase().replace(/\s+/g, ' ');
}

/**
 * Devuelve los campos custom de una empresa por su nombre (tolerante a
 * mayusculas/minusculas y espacios). [] si la empresa no esta mapeada.
 */
export function getCompanyCustomFields(companyName: string): CustomField[] {
  const target = normalizeCompanyName(companyName);
  for (const [key, fields] of Object.entries(COMPANY_CUSTOM_FIELDS)) {
    if (normalizeCompanyName(key) === target) return fields;
  }
  return [];
}

/**
 * Nombres de los campos custom EDITABLES de una empresa (editable === true).
 * Se usa como whitelist en la actualizacion: solo estos UDF se aceptan/envian
 * al editar, ademas de los estandar editables (EDITABLE_ON_UPDATE).
 */
export function getEditableCustomFields(companyName: string): string[] {
  return getCompanyCustomFields(companyName)
    .filter((c) => c.editable === true)
    .map((c) => c.field);
}

/**
 * Etiqueta legible para un campo de usuario U_* que NO esta en el mapa curado:
 * quita el prefijo `U_` (o `U_IT_`, `U_Lab_`) y reemplaza guiones bajos por
 * espacios. Ej. "U_IT_Principio_Activo" -> "IT Principio Activo".
 */
export function humanizeCustomField(field: string): string {
  return field
    .replace(/^U_/, '')
    .replace(/_/g, ' ')
    .trim();
}

export interface TemplateColumn {
  header: string;
  field: string;
  required?: boolean;
}

/**
 * Columnas del Excel de cargue masivo: campos estandar marcados "en Excel".
 * El header exacto (con tildes) mapea al nombre OData del campo.
 */
export const TEMPLATE_COLUMNS: TemplateColumn[] = [
  { header: 'Codigo', field: 'ItemCode', required: true },
  { header: 'Descripcion', field: 'ItemName', required: true },
  { header: 'Grupo de articulos', field: 'ItemsGroupCode', required: true },
  { header: 'Nombre extranjero', field: 'ForeignName' },
  { header: 'Tipo de articulo', field: 'ItemType' },
  { header: 'Codigo de barras', field: 'BarCode' },
  { header: 'Es de ventas (tYES/tNO)', field: 'SalesItem' },
  { header: 'Es de compras (tYES/tNO)', field: 'PurchaseItem' },
  { header: 'Es de inventario (tYES/tNO)', field: 'InventoryItem' },
  { header: 'Proveedor principal', field: 'Mainsupplier' },
  { header: 'Unidad de venta', field: 'SalesUnit' },
  { header: 'Unidad de compra', field: 'PurchaseUnit' },
  { header: 'Unidad de inventario', field: 'InventoryUOM' },
];
