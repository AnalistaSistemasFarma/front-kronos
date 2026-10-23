/**
 * Vitrina Comercial — constantes del módulo (sprint V2, 2026-10-22).
 *
 * Archivo PURO (sin BD ni `server-only`): lo usan los componentes cliente, las
 * rutas y las pruebas. Brief: «brief-desarrollo-vitrina-v2.md» del hilo del
 * proyecto «Vitrina Virtual Synerlink».
 *
 * El V2 construye el catálogo (tablas vitrina_*), la lectura de SAP por empresa
 * (SOLO LECTURA) y el submódulo «Vitrina Comercial · Gestión». Las pantallas de
 * los comerciales van en el V3/V4.
 */

/** Raíz de las páginas del módulo. */
export const VITRINA_BASE_URL = '/process/vitrina';
export const VITRINA_GESTION_URL = '/process/vitrina/gestion';

/** Proceso contenedor del menú (Ventas, id 4 en KRONOSDB y KRONOSDB_PRUEBAS). */
export const VITRINA_PROCESS_NAME = 'Ventas';

/** Subprocesos-permiso (subprocess × company_user). Ambos son tarjetas del menú. */
export const VITRINA_SUBPROCESS_URLS = {
  consulta: VITRINA_BASE_URL,
  gestion: VITRINA_GESTION_URL,
} as const;

export const VITRINA_SUBPROCESS_NAMES = {
  consulta: 'Vitrina Comercial',
  gestion: 'Vitrina Comercial · Gestión',
} as const;

export const VITRINA_MODULE_NAME = 'Vitrina Comercial';
export const VITRINA_GESTION_NAME = 'Vitrina Comercial · Gestión';

// ---------------------------------------------------------------------------
// Dominios cerrados (iguales a los CHECK de la migración 20261022200000_vitrina_comercial)
// ---------------------------------------------------------------------------

export const VITRINA_ESTADOS = ['PENDIENTE', 'VALIDADA', 'RETIRADA'] as const;
export type VitrinaEstado = (typeof VITRINA_ESTADOS)[number];

export const VITRINA_VISIBILIDADES = ['INTERNA', 'CLIENTE', 'OFERTABLE'] as const;
export type VitrinaVisibilidad = (typeof VITRINA_VISIBILIDADES)[number];

export const VITRINA_CANALES = ['INSTITUCIONAL', 'COMERCIAL', 'SIN_DATO'] as const;
export type VitrinaCanal = (typeof VITRINA_CANALES)[number];

export const VITRINA_REGISTRO_ESTADOS = ['VIGENTE', 'POR_VENCER', 'VENCIDO', 'SIN_REGISTRO', 'SIN_FECHA'] as const;
export type VitrinaRegistroEstado = (typeof VITRINA_REGISTRO_ESTADOS)[number];

export const VITRINA_ALCANCES = ['EXHIBIR', 'OFERTAR'] as const;
export type VitrinaAlcance = (typeof VITRINA_ALCANCES)[number];

export const VITRINA_IMAGEN_TIPOS = ['VIAL', 'ETIQUETA', 'PLEGADIZA'] as const;
export const VITRINA_DOCUMENTO_TIPOS = ['FICHA', 'INSERTO', 'PROSPECTO'] as const;

/** Formas farmacéuticas sugeridas (texto libre en la base; la lista ayuda a no escribir variantes). */
export const VITRINA_FORMAS = ['Vial', 'Ampolla', 'Bolsa', 'Botella', 'Blíster', 'Jeringa prellenada', 'Frasco'] as const;

/** Familias sugeridas (texto libre en la base). */
export const VITRINA_FAMILIAS = ['Carbapenémicos', 'Cefalosporinas', 'Monobactámicos', 'Penicilinas', 'Vitaminas', 'Cuidado crítico'] as const;

/** Etiquetas visibles. */
export const ESTADO_LABEL: Record<VitrinaEstado, string> = {
  PENDIENTE: 'Pendiente de validar',
  VALIDADA: 'Validada',
  RETIRADA: 'Retirada',
};

export const VISIBILIDAD_LABEL: Record<VitrinaVisibilidad, string> = {
  INTERNA: 'Interna',
  CLIENTE: 'Vista al cliente',
  OFERTABLE: 'Ofertable',
};

export const CANAL_LABEL: Record<VitrinaCanal, string> = {
  INSTITUCIONAL: 'Institucional',
  COMERCIAL: 'Comercial',
  SIN_DATO: 'Sin dato',
};

export const REGISTRO_LABEL: Record<VitrinaRegistroEstado, string> = {
  VIGENTE: 'Registro vigente',
  POR_VENCER: 'Registro por vencer',
  VENCIDO: 'Registro vencido',
  SIN_REGISTRO: 'Sin registro',
  SIN_FECHA: 'Registro sin fecha',
};

export const ALCANCE_LABEL: Record<VitrinaAlcance, string> = {
  EXHIBIR: 'Exhibir',
  OFERTAR: 'Ofertar',
};

/** Colores de Mantine (tema activo) para las etiquetas de estado. Nada de colores fijos. */
export const REGISTRO_COLOR: Record<VitrinaRegistroEstado, string> = {
  VIGENTE: 'green',
  POR_VENCER: 'yellow',
  VENCIDO: 'red',
  SIN_REGISTRO: 'red',
  SIN_FECHA: 'gray',
};

export const ESTADO_COLOR: Record<VitrinaEstado, string> = {
  PENDIENTE: 'yellow',
  VALIDADA: 'green',
  RETIRADA: 'gray',
};

export const VISIBILIDAD_COLOR: Record<VitrinaVisibilidad, string> = {
  INTERNA: 'gray',
  CLIENTE: 'blue',
  OFERTABLE: 'violet',
};

/** Días de anticipación del aviso «por vencer» del registro sanitario (decisión 8.1-3). */
export const VITRINA_DIAS_POR_VENCER = 90;

/** Días de anticipación del aviso de exclusividad por vencer. */
export const VITRINA_DIAS_EXCLUSIVIDAD_POR_VENCER = 30;

/** El valor 9999-01-01 de U_Fecha_Vencimiento significa «sin dato», no «vigente». */
export const VITRINA_FECHA_SIN_DATO = '9999-01-01';

/** Límites de texto (iguales a las columnas de la base). */
export const VITRINA_LIMITS = {
  molecula: 200,
  concentracion: 100,
  forma: 60,
  nombreComercial: 200,
  tallMan: 200,
  familia: 100,
  pais: 60,
  clienteMarca: 100,
  cliente: 150,
  observacion: 500,
  areaNombre: 80,
  semillaBytes: 2_000_000,
  semillaFilas: 5000,
} as const;

/** Entidades y acciones del historial (vitrina_historial). */
export const VITRINA_ENTIDADES = ['presentacion', 'codigo_sap', 'exclusividad', 'area', 'empresa'] as const;
export type VitrinaEntidad = (typeof VITRINA_ENTIDADES)[number];

export const VITRINA_ACCIONES = [
  'CREAR',
  'EDITAR',
  'AGRUPAR',
  'DESAGRUPAR',
  'ACTIVAR',
  'DESACTIVAR',
  'VALIDAR',
  'RETIRAR',
  'ELIMINAR',
  'SINCRONIZAR',
  'ALERTA_SAP',
  'REGISTRO',
  'SEMILLA',
] as const;
export type VitrinaAccion = (typeof VITRINA_ACCIONES)[number];

export const ACCION_LABEL: Record<VitrinaAccion, string> = {
  CREAR: 'Creación',
  EDITAR: 'Edición',
  AGRUPAR: 'Agrupación',
  DESAGRUPAR: 'Devuelto a la bandeja',
  ACTIVAR: 'Activación',
  DESACTIVAR: 'Desactivación',
  VALIDAR: 'Validación',
  RETIRAR: 'Retiro',
  ELIMINAR: 'Eliminación',
  SINCRONIZAR: 'Lectura de SAP',
  ALERTA_SAP: 'Alerta de SAP',
  REGISTRO: 'Cambio de registro sanitario',
  SEMILLA: 'Carga de sugerencias',
};

export const ENTIDAD_LABEL: Record<VitrinaEntidad, string> = {
  presentacion: 'Presentación',
  codigo_sap: 'Código SAP',
  exclusividad: 'Exclusividad',
  area: 'Área asistencial',
  empresa: 'Empresa',
};

/** Tipo de job del programador central (lib/scheduler/handlers.js). */
export const VITRINA_JOB_TYPE = 'vitrina_sincronizar_sap';

function normalizeUrl(url: string | null | undefined): string {
  return (url ?? '').trim().toLowerCase().replace(/\/+$/, '');
}

export type VitrinaPermission = keyof typeof VITRINA_SUBPROCESS_URLS;

/** Permiso del módulo que representa una URL de subproceso, o null. */
export function vitrinaPermissionFromUrl(url: string | null | undefined): VitrinaPermission | null {
  const u = normalizeUrl(url);
  if (u === VITRINA_SUBPROCESS_URLS.gestion) return 'gestion';
  if (u === VITRINA_SUBPROCESS_URLS.consulta) return 'consulta';
  return null;
}

export function vitrinaHref(path: string, idCompany: number | null | undefined): string {
  return idCompany ? `${path}?empresa=${idCompany}` : path;
}
