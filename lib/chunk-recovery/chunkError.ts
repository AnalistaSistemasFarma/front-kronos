// Recuperación ante despliegues (duo): cuando SynerLink se actualiza, quien ya
// tenía la app abierta pide chunks JS que ya no existen. En vez de mostrar
// "Application error", recargamos UNA sola vez; si vuelve a fallar, se muestra
// la pantalla amable con el botón "Recargar".

export const RELOAD_KEY = 'synerlink:chunk-reload-at';
/** Ventana en la que no se repite la recarga automática (evita bucles). */
export const RELOAD_WINDOW_MS = 60_000;

const CHUNK_PATTERNS: RegExp[] = [
  /ChunkLoadError/i,
  /Loading chunk [^\s]+ failed/i,
  /Loading CSS chunk [^\s]+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Failed to load chunk/i,
  /\/_next\/static\/chunks\/.*(failed|404)/i,
];

function describe(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    const e = err as { name?: unknown; message?: unknown; reason?: unknown };
    const parts = [e.name, e.message].filter((p) => typeof p === 'string') as string[];
    if (e.reason && e.reason !== err) parts.push(describe(e.reason));
    return parts.join(': ');
  }
  return String(err);
}

/** ¿El error corresponde a un chunk/módulo que ya no existe tras un despliegue? */
export function isChunkLoadError(err: unknown): boolean {
  const text = describe(err);
  if (!text) return false;
  return CHUNK_PATTERNS.some((re) => re.test(text));
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function safeStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

/**
 * Decide si se puede hacer la recarga automática y, si sí, deja la marca con
 * la fecha. Solo permite UNA recarga por ventana de RELOAD_WINDOW_MS.
 */
export function claimAutoReload(storage?: StorageLike | null, now: number = Date.now()): boolean {
  const s = safeStorage(storage);
  if (!s) return false; // sin sessionStorage no arriesgamos un bucle
  try {
    const last = Number(s.getItem(RELOAD_KEY) ?? 0);
    if (Number.isFinite(last) && last > 0 && now - last < RELOAD_WINDOW_MS) return false;
    s.setItem(RELOAD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

/** Intenta la recarga automática. Devuelve true si va a recargar. */
export function tryAutoReload(
  err: unknown,
  opts: { storage?: StorageLike | null; now?: number; reload?: () => void } = {},
): boolean {
  if (!isChunkLoadError(err)) return false;
  if (!claimAutoReload(opts.storage, opts.now)) return false;
  const reload = opts.reload ?? (() => window.location.reload());
  reload();
  return true;
}
