import { SapError } from './serviceLayer';

/**
 * Escrituras serializadas sobre un mismo documento de SAP (p. ej. un borrador de venta).
 *
 * Problema (regresión 2026-11-04): al aprobar el extracupo, la decisión del autorizador
 * (traza en el borrador) y la Tarea SAP siguiente («Pasar a AEDA») hacían PATCH al mismo
 * `Drafts(n)` a la vez. SAP rechaza una de las dos con −2039 («Another user or another
 * operation modified data») y la autorización comercial no quedaba registrada.
 *
 * Dos defensas:
 *  1. `withDocLock`: dentro del proceso, las escrituras sobre el mismo documento se hacen
 *     una detrás de otra (cola por clave). Cubre la carrera entre la decisión y el motor.
 *  2. `retryOnConflict`: si SAP igual responde −2039 o 412 (otra sesión, SAPSEND, un
 *     usuario en el cliente de SAP), se vuelve a leer y a escribir hasta `attempts` veces.
 */

const queues = new Map<string, Promise<unknown>>();

/** Clave del documento: empresa + entidad + DocEntry. */
export function docKey(companyId: number, entity: string, docEntry: number): string {
  return `${companyId}:${entity}:${docEntry}`;
}

/**
 * Ejecuta `fn` cuando terminen las escrituras anteriores sobre la misma clave.
 * Un error de `fn` se propaga a quien la llamó, pero no bloquea la cola.
 */
export function withDocLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  queues.set(key, tail);
  // Limpieza: si nadie más se encoló detrás, se libera la entrada del mapa.
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
}

/** Cantidad de claves con escrituras en curso (para pruebas y diagnóstico). */
export function pendingDocLocks(): number {
  return queues.size;
}

/** ¿El error es un conflicto de concurrencia de SAP (−2039 o 412 por If-Match)? */
export function isSapConcurrencyConflict(e: unknown): boolean {
  if (!(e instanceof SapError)) return false;
  if (e.status === 412) return true;
  const text = `${e.message} ${e.detail ?? ''}`;
  return /-2039\b/.test(text) || /another user or another operation modified data/i.test(text);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Reintenta `fn` (que debe volver a LEER el documento antes de escribir) cuando SAP
 * responde un conflicto de concurrencia. Cualquier otro error se propaga al instante.
 */
export async function retryOnConflict<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { attempts?: number; delayMs?: number; onRetry?: (attempt: number, e: unknown) => void } = {}
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const delayMs = opts.delayMs ?? 800;
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      last = e;
      if (!isSapConcurrencyConflict(e) || attempt === attempts) throw e;
      opts.onRetry?.(attempt, e);
      await sleep(delayMs * attempt);
    }
  }
  throw last;
}

/** Atajo: serializa por documento y reintenta ante conflicto. */
export function writeDoc<T>(
  key: string,
  fn: (attempt: number) => Promise<T>,
  opts?: Parameters<typeof retryOnConflict>[1]
): Promise<T> {
  return withDocLock(key, () => retryOnConflict(fn, opts));
}
