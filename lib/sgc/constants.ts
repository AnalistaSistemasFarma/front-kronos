/**
 * SGC documental (Sistema de Gestión de Calidad) — constantes del módulo.
 *
 * Módulo AISLADO de SynerLink general: ruta, APIs, tablas (esquema SQL `sgc`)
 * y permisos propios. Este archivo es puro (sin BD ni `server-only`) para
 * poder usarse desde componentes cliente y desde las pruebas.
 *
 * Plan: proyectos/sgc-olp-gestion-documental.md (vault de horus).
 */

/** Raíz de las páginas del módulo. */
export const SGC_BASE_URL = '/process/sgc-documental';

/** Nombre del proceso contenedor (grupo del menú) sembrado en `process`. */
export const SGC_PROCESS_NAME = 'Sistema de Gestión de Calidad';

/**
 * Subprocesos-permiso del módulo. El de `lectura` es la entrada visible del
 * menú; los demás son solo marcadores de permiso (no se listan en el hub).
 */
export const SGC_SUBPROCESS_URLS = {
  lectura: '/process/sgc-documental',
  gestion: '/process/sgc-documental/gestion',
  calidad: '/process/sgc-documental/calidad',
  flujos: '/process/sgc-documental/flujos',
} as const;

export type SgcPermission = keyof typeof SGC_SUBPROCESS_URLS;

/** Nombres visibles de los subprocesos (los mismos del script de siembra). */
export const SGC_SUBPROCESS_NAMES: Record<SgcPermission, string> = {
  lectura: 'SGC documental',
  gestion: 'SGC documental · gestionar documentos',
  calidad: 'SGC documental · Aseguramiento de Calidad',
  flujos: 'SGC documental · administración de flujos validados',
};

/** Descripción corta de cada permiso marcador (para administración de usuarios). */
export const SGC_PERMISSION_DESCRIPTIONS: Record<Exclude<SgcPermission, 'lectura'>, string> = {
  gestion: 'Permiso SGC: elaborar, revisar y aprobar documentos',
  calidad: 'Permiso SGC: Aseguramiento de Calidad (dueña del módulo)',
  flujos: 'Permiso SGC: administrar los flujos validados',
};

const URL_TO_PERMISSION = new Map<string, SgcPermission>(
  (Object.entries(SGC_SUBPROCESS_URLS) as [SgcPermission, string][]).map(([perm, url]) => [
    url,
    perm,
  ])
);

/** Normaliza una URL de subproceso para compararla (minúsculas, sin "/" final). */
function normalizeUrl(url: string | null | undefined): string {
  return (url ?? '').trim().toLowerCase().replace(/\/+$/, '');
}

/** Devuelve el permiso SGC que representa una URL de subproceso, o null. */
export function sgcPermissionFromUrl(url: string | null | undefined): SgcPermission | null {
  return URL_TO_PERMISSION.get(normalizeUrl(url)) ?? null;
}

/**
 * true si el subproceso es un marcador de permiso del SGC (gestión, calidad,
 * flujos): existe para otorgar el permiso, pero no es una tarjeta del menú.
 */
export function isSgcPermissionMarkerSubprocess(subprocess: {
  subprocess_url?: string | null;
}): boolean {
  const perm = sgcPermissionFromUrl(subprocess.subprocess_url);
  return perm !== null && perm !== 'lectura';
}

/** Texto del distintivo de un marcador de permiso SGC en administración de usuarios. */
export function describeSgcPermissionMarker(url: string | null | undefined): string | null {
  const perm = sgcPermissionFromUrl(url);
  if (!perm || perm === 'lectura') return null;
  return SGC_PERMISSION_DESCRIPTIONS[perm];
}
