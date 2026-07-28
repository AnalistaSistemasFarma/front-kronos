/**
 * Constantes puras (sin dependencias de servidor) de registros sanitarios.
 * Las usan tanto la UI (formulario, plantilla y lectura del Excel) como las
 * validaciones. Los headers del Excel y su orden replican los de SAPSEND.
 */

export interface TemplateColumn {
  header: string;
  field: string;
  required?: boolean;
}

/** Columnas del Excel de cargue masivo: header exacto (con tildes) -> campo U_*. */
export const TEMPLATE_COLUMNS: TemplateColumn[] = [
  { header: 'Referencia', field: 'U_Referencia', required: true },
  { header: 'Registro Sanitario', field: 'U_Registro_Sanitario', required: true },
  { header: 'País', field: 'U_Pais' },
  { header: 'Titular', field: 'U_Titular' },
  { header: 'Fabricante', field: 'U_Fabricante' },
  { header: 'Fecha Creación', field: 'U_Fecha_Creacion' },
  { header: 'Fecha Actualización', field: 'U_Fecha_Actualizacion' },
  { header: 'Fecha Vencimiento', field: 'U_Fecha_Vencimiento' },
  { header: 'Código CUM', field: 'U_Codigo_CUM' },
  { header: 'Código IUM', field: 'U_Codigo_IUM' },
  { header: 'Vida Útil (meses)', field: 'U_Vida_Util' },
  { header: 'Estado Entrada', field: 'U_Estado_Entrada' },
  { header: 'Estado Comercialización', field: 'U_Estado_Comercializacion' },
  { header: 'Obsoleto', field: 'U_Obsoleto' },
  { header: 'Enlace Archivo', field: 'U_SEND_Link' },
];

export const PAISES = [
  'COLOMBIA', 'BOLIVIA', 'ECUADOR', 'EL SALVADOR', 'GUATEMALA', 'PERU', 'MEXICO',
  'COSTA RICA', 'HONDURAS', 'INDIA', 'NICARAGUA', 'VENEZUELA', 'CHILE', 'PANAMA', 'URUGUAY',
];

export const ESTADOS = ['Activo', 'Inactivo'];
export const OBSOLETO = ['SI', 'NO'];

/** Fechas que deben normalizarse a YYYY-MM-DD. */
export const DATE_FIELDS = ['U_Fecha_Creacion', 'U_Fecha_Actualizacion', 'U_Fecha_Vencimiento'];
