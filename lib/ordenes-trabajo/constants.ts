/**
 * Órdenes de Trabajo (bitácora de proceso de planta) — constantes del módulo.
 *
 * Archivo PURO (sin BD ni `server-only`): lo usan los componentes cliente, las
 * rutas y las pruebas. Plan: proyectos/ordenes-trabajo-synerlink.md (vault de horus).
 */

/** Raíz de las páginas del módulo. */
export const OT_BASE_URL = '/process/ordenes-trabajo';

/** Nombre del proceso contenedor (grupo del menú) sembrado en `process`. */
export const OT_PROCESS_NAME = 'Producción';

/**
 * Subprocesos-permiso del módulo. `operario` es la entrada visible del menú;
 * `gestion` es un marcador de permiso (supervisor) que no se lista en el hub.
 */
export const OT_SUBPROCESS_URLS = {
  operario: '/process/ordenes-trabajo',
  gestion: '/process/ordenes-trabajo/gestion',
} as const;

export type OtPermission = keyof typeof OT_SUBPROCESS_URLS;

/** Nombres visibles de los subprocesos (los mismos del script de siembra). */
export const OT_SUBPROCESS_NAMES: Record<OtPermission, string> = {
  operario: 'Órdenes de Trabajo',
  gestion: 'Órdenes de Trabajo: Gestión',
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

/** Días de órdenes cerradas que muestra el listado (P0). */
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
    ? 'Permiso Órdenes de Trabajo: supervisor (abrir, cerrar y catálogo)'
    : null;
}
