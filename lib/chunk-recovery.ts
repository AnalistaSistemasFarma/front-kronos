/**
 * Recuperación de errores de "chunks" tras un despliegue (2026-10-10, Nicolás:
 * "el usuario NO debe ver un error").
 *
 * Quien tiene SynerLink abierto mientras se despliega conserva el HTML viejo, que
 * apunta a chunks de /_next/static/ que el build nuevo ya borró. Al navegar, la
 * importación dinámica falla y Next mostraba "Application error: a client-side
 * exception has occurred". Aquí detectamos ese caso y recargamos la página UNA
 * vez (marca en sessionStorage para no entrar en bucle).
 */

const PATRONES_CHUNK = [
  /ChunkLoadError/i,
  /Loading (CSS )?chunk [^\s]+ failed/i,
  /Failed to load chunk/i,
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS/i,
];

export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: unknown; message?: unknown };
  const texto = typeof err === 'string' ? err : `${String(e.name ?? '')} ${String(e.message ?? '')}`;
  return PATRONES_CHUNK.some((re) => re.test(texto));
}

export const CLAVE_RECARGA = 'synerlink:recarga-por-actualizacion';
/** Si ya recargamos hace menos de esto, no volvemos a recargar (evita bucles). */
export const VENTANA_SIN_RECARGA_MS = 60_000;

type Almacen = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Decide si se puede recargar y deja la marca. Devuelve false si ya se recargó
 * hace poco (entonces hay que mostrar la pantalla amable con botón "Recargar").
 */
export function marcarRecargaSiPermitida(almacen: Almacen | null | undefined, ahora = Date.now()): boolean {
  try {
    if (!almacen) return false;
    const previa = Number(almacen.getItem(CLAVE_RECARGA) ?? 0);
    if (previa && ahora - previa < VENTANA_SIN_RECARGA_MS) return false;
    almacen.setItem(CLAVE_RECARGA, String(ahora));
    return true;
  } catch {
    return false;
  }
}

/** Recarga una sola vez si es seguro hacerlo. Devuelve true si va a recargar. */
export function recargarUnaVez(): boolean {
  if (typeof window === 'undefined') return false;
  let almacen: Storage | null = null;
  try {
    almacen = window.sessionStorage;
  } catch {
    almacen = null;
  }
  if (!marcarRecargaSiPermitida(almacen)) return false;
  window.location.reload();
  return true;
}
