/**
 * Bitácora de Proceso (registro de intervenciones en planta) — constantes del módulo.
 *
 * Archivo PURO (sin BD ni `server-only`): lo usan los componentes cliente, las
 * rutas y las pruebas. Plan: proyectos/bitacora-proceso-synerlink.md (vault de horus).
 *
 * Nombre: nació como «Órdenes de Trabajo» (2026-10-13); el mismo día Farmalógica
 * envió la especificación oficial «Bitácora de Proceso Plantas Farmalógica» y
 * Nicolás pidió el cambio. Las tablas internas conservan el prefijo `ot_` (y los
 * tipos `Ot*`) para no mover el esquema: es solo un nombre interno.
 */

/** Raíz de las páginas del módulo. */
export const OT_BASE_URL = '/process/bitacora-proceso';

/** Nombre del proceso contenedor (grupo del menú) sembrado en `process`. */
export const OT_PROCESS_NAME = 'Producción';

/**
 * Subprocesos-permiso del módulo. `operario` es la entrada visible del menú;
 * `gestion` es un marcador de permiso (supervisor) que no se lista en el hub.
 */
export const OT_SUBPROCESS_URLS = {
  operario: '/process/bitacora-proceso',
  gestion: '/process/bitacora-proceso/gestion',
} as const;

export type OtPermission = keyof typeof OT_SUBPROCESS_URLS;

/** Nombres visibles de los subprocesos (los mismos del script de siembra). */
export const OT_SUBPROCESS_NAMES: Record<OtPermission, string> = {
  operario: 'Bitácora de Proceso',
  gestion: 'Bitácora de Proceso: Gestión',
};

export const OT_TURNOS = ['MANANA', 'TARDE', 'NOCHE'] as const;
export type OtTurno = (typeof OT_TURNOS)[number];

export const OT_TURNO_LABEL: Record<OtTurno, string> = {
  MANANA: 'Mañana',
  TARDE: 'Tarde',
  NOCHE: 'Noche',
};

export const OT_ESTADOS = ['ABIERTA', 'CERRADA'] as const;
export type OtEstado = (typeof OT_ESTADOS)[number];

/** Límites de texto (iguales a las columnas de la base). */
export const OT_LIMITS = {
  producto: 200,
  itemCode: 50,
  lote: 50,
  area: 100,
  observacion: 500,
  observacionCierre: 1000,
  actividadNombre: 120,
  maxOperarios: 50,
} as const;

/** Días de bitácoras cerradas que muestra el listado (P0). */
export const OT_DIAS_CERRADAS = 30;

function normalizeUrl(url: string | null | undefined): string {
  return (url ?? '').trim().toLowerCase().replace(/\/+$/, '');
}

const URL_TO_PERMISSION = new Map<string, OtPermission>(
  (Object.entries(OT_SUBPROCESS_URLS) as [OtPermission, string][]).map(([perm, url]) => [url, perm])
);

/** Permiso del módulo que representa una URL de subproceso, o null. */
export function otPermissionFromUrl(url: string | null | undefined): OtPermission | null {
  return URL_TO_PERMISSION.get(normalizeUrl(url)) ?? null;
}

/** true si el subproceso es el marcador de Gestión: otorga el permiso, pero no es tarjeta del menú. */
export function isOtPermissionMarkerSubprocess(subprocess: { subprocess_url?: string | null }): boolean {
  return otPermissionFromUrl(subprocess.subprocess_url) === 'gestion';
}

/** Texto del distintivo del marcador en Administración → Usuarios. */
export function describeOtPermissionMarker(url: string | null | undefined): string | null {
  return otPermissionFromUrl(url) === 'gestion'
    ? 'Permiso Bitácora de Proceso: supervisor (abrir, cerrar y catálogo)'
    : null;
}

/** Nombre visible del módulo. */
export const OT_MODULE_NAME = 'Bitácora de Proceso';

/** Nombre completo para el encabezado y el informe (Farmalógica lo llama «Plantas Farmalógica»). */
export function otNombreCompleto(companyName: string | null | undefined): string {
  const c = (companyName ?? '').trim();
  if (/farmal[oó]gica/i.test(c)) return 'Bitácora de Proceso – Plantas Farmalógica';
  return c ? `Bitácora de Proceso – ${c}` : 'Bitácora de Proceso';
}

/**
 * Íconos opcionales de las actividades (lista cerrada: la base guarda solo la
 * clave). Son íconos de Tabler elegidos por afinidad; NO son los pictogramas
 * del documento de Farmalógica (origen y licencia desconocidos). Más adelante
 * la empresa podrá cargar los suyos.
 */
export const OT_ICONOS = {
  tapon: 'Tapón',
  'materia-prima': 'Materia prima',
  agrafe: 'Agrafe',
  control: 'Control en proceso',
  autoclave: 'Autoclave',
  uv: 'Luz UV',
  pesaje: 'Pesaje',
  viables: 'Monitoreo viable',
  'no-viables': 'Monitoreo no viable',
  'ajuste-operario': 'Ajuste (operario)',
  'ajuste-mantenimiento': 'Ajuste (mantenimiento)',
  formato: 'Cambio de formato',
  refrigerio: 'Alimentación del personal',
  frasco: 'Frasco o vial',
  laboratorio: 'Laboratorio',
  equipo: 'Equipo',
  otra: 'Otra',
} as const;

export type OtIcono = keyof typeof OT_ICONOS;

export function isOtIcono(v: unknown): v is OtIcono {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(OT_ICONOS, v);
}

/**
 * Catálogo inicial de Farmalógica según su especificación oficial (2026-10-13):
 * 3 alimentaciones con pictograma + 11 intervenciones («Descargue autoclave»
 * venía repetido) + «Otra» (observación obligatoria). Debe coincidir con
 * prisma/manual/2026-10-13-bitacora-proceso-p0-farmalogica.sql.
 */
export const OT_CATALOGO_FARMALOGICA: ReadonlyArray<{ nombre: string; icono: OtIcono; orden: number; exigeObservacion: boolean }> = [
  { nombre: 'Alimentación Tapón', icono: 'tapon', orden: 10, exigeObservacion: false },
  { nombre: 'Alimentación MPrima', icono: 'materia-prima', orden: 20, exigeObservacion: false },
  { nombre: 'Alimentación Agrafe', icono: 'agrafe', orden: 30, exigeObservacion: false },
  { nombre: 'Controles en proceso', icono: 'control', orden: 40, exigeObservacion: false },
  { nombre: 'Descargue Autoclave', icono: 'autoclave', orden: 50, exigeObservacion: false },
  { nombre: 'Descargue de UV', icono: 'uv', orden: 60, exigeObservacion: false },
  { nombre: 'Pesaje de bidones', icono: 'pesaje', orden: 70, exigeObservacion: false },
  { nombre: 'Monitoreos Viables', icono: 'viables', orden: 80, exigeObservacion: false },
  { nombre: 'Monitoreos no Viables', icono: 'no-viables', orden: 90, exigeObservacion: false },
  { nombre: 'Ajuste de equipo Operario', icono: 'ajuste-operario', orden: 100, exigeObservacion: false },
  { nombre: 'Ajuste de equipo por Mantenimiento', icono: 'ajuste-mantenimiento', orden: 110, exigeObservacion: false },
  { nombre: 'Cambio de Formato', icono: 'formato', orden: 120, exigeObservacion: false },
  { nombre: 'Refrigerio/almuerzo/cena', icono: 'refrigerio', orden: 130, exigeObservacion: false },
  { nombre: 'Otra', icono: 'otra', orden: 990, exigeObservacion: true },
];
