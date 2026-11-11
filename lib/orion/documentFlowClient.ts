/**
 * Caché corta + prefetch del flujo del documento (2026-11-11).
 * Al pasar el mouse por «Ver flujo» ya se pide la API; al abrir el modal suele estar listo.
 */
import type { DocumentFlow } from '@/lib/orion/documentFlow';

const TTL_MS = 45_000;

type Entry = {
  at: number;
  flow?: DocumentFlow;
  error?: string;
  promise?: Promise<DocumentFlow>;
};

const cache = new Map<string, Entry>();

function keyOf(requestId: number, fileId: string): string {
  return `${requestId}:${fileId}`;
}

/** La entrada si todavía está vigente; si no, null (así `fresh(e)?.flow` sí lee el caché). */
function fresh(entry: Entry | undefined): Entry | null {
  return entry && Date.now() - entry.at < TTL_MS ? entry : null;
}

async function fetchFlow(requestId: number, fileId: string, signal?: AbortSignal): Promise<DocumentFlow> {
  const res = await fetch(
    `/api/integrations/orion/document-flow?requestId=${requestId}&fileId=${encodeURIComponent(fileId)}`,
    { cache: 'no-store', signal }
  );
  const body = (await res.json().catch(() => null)) as { flow?: DocumentFlow; error?: string } | null;
  if (!res.ok || !body?.flow) {
    throw new Error(body?.error || 'No se pudo cargar el recorrido del documento');
  }
  return body.flow;
}

/** Flujo ya resuelto en caché (sin red). */
export function peekDocumentFlow(requestId: number, fileId: string): DocumentFlow | null {
  const entry = cache.get(keyOf(requestId, fileId));
  return fresh(entry)?.flow ?? null;
}

/** Arranca la carga sin esperar (hover/focus). Reutiliza petición en curso. */
export function prefetchDocumentFlow(requestId: number, fileId: string): void {
  if (!Number.isInteger(requestId) || requestId <= 0 || !fileId) return;
  const key = keyOf(requestId, fileId);
  const existing = fresh(cache.get(key));
  if (existing && (existing.flow || existing.promise)) return;

  const promise = fetchFlow(requestId, fileId)
    .then((flow) => {
      cache.set(key, { at: Date.now(), flow });
      return flow;
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'No se pudo cargar el recorrido del documento';
      cache.set(key, { at: Date.now(), error: message });
      throw err;
    });

  // Si nadie abre el flujo, el error de una precarga no debe quedar como rechazo sin manejar.
  promise.catch(() => {});
  cache.set(key, { at: Date.now(), promise });
}

/** Lee caché o espera la petición (abortable al desmontar). */
export async function loadDocumentFlow(
  requestId: number,
  fileId: string,
  signal?: AbortSignal
): Promise<DocumentFlow> {
  const key = keyOf(requestId, fileId);
  const existing = fresh(cache.get(key));

  if (existing?.flow) return existing.flow;
  // Un error anterior no se reutiliza: al volver a abrir se intenta de nuevo.
  const pending = existing?.promise;
  if (pending) {
    if (signal) {
      return new Promise<DocumentFlow>((resolve, reject) => {
        const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
        pending.then(
          (flow) => {
            signal.removeEventListener('abort', onAbort);
            resolve(flow);
          },
          (err) => {
            signal.removeEventListener('abort', onAbort);
            reject(err);
          }
        );
      });
    }
    return pending;
  }

  const promise = fetchFlow(requestId, fileId, signal)
    .then((flow) => {
      cache.set(key, { at: Date.now(), flow });
      return flow;
    })
    .catch((err: unknown) => {
      if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        // Cerrado antes de terminar: no dejar una petición cancelada en caché (la carga quedaría colgada).
        if (cache.get(key)?.promise === promise) cache.delete(key);
        throw err;
      }
      const message = err instanceof Error ? err.message : 'No se pudo cargar el recorrido del documento';
      cache.set(key, { at: Date.now(), error: message });
      throw err;
    });

  cache.set(key, { at: Date.now(), promise });
  return promise;
}
