/**
 * Prefetch del detalle de Autorizaciones (Acciones → Ver detalle).
 * Al pasar el mouse se piden view-request + form-values (+ notas si aplica);
 * al abrir el modal suele estar listo y se evita la espera larga.
 */

const TTL_MS = 45_000;

export type PrefetchedAuthDetail = {
  detail: Record<string, unknown> | null;
  detailOk: boolean;
  detailError?: string;
  formValues: unknown[];
  notes: unknown[];
};

type Entry = {
  at: number;
  data?: PrefetchedAuthDetail;
  error?: string;
  promise?: Promise<PrefetchedAuthDetail>;
};

const cache = new Map<string, Entry>();

function keyOf(requestId: number, withNotes: boolean): string {
  return `${requestId}:${withNotes ? 'notes' : 'firma'}`;
}

/** La entrada si todavía está vigente; si no, null (así `fresh(e)?.data` sí lee el caché). */
function fresh(entry: Entry | undefined): Entry | null {
  return entry && Date.now() - entry.at < TTL_MS ? entry : null;
}

async function fetchDetail(requestId: number, withNotes: boolean): Promise<PrefetchedAuthDetail> {
  const fetches: Promise<Response>[] = [
    fetch(`/api/requests-general/view-request?id=${requestId}`),
    fetch(`/api/requests-general/request-form-values?id_request=${requestId}`),
  ];
  if (withNotes) {
    fetches.push(fetch(`/api/requests-general/notes?id_request=${requestId}`));
  }
  const responses = await Promise.all(fetches);
  const detailRes = responses[0];
  const valuesRes = responses[1];
  const notesRes = responses[2];
  const detailJson = (await detailRes.json().catch(() => null)) as Record<string, unknown> | null;
  const valuesJson = await valuesRes.json().catch(() => []);
  const notesJson = notesRes ? await notesRes.json().catch(() => []) : [];
  return {
    detail: detailRes.ok ? detailJson : null,
    detailOk: detailRes.ok,
    detailError:
      !detailRes.ok
        ? String((detailJson as { error?: string } | null)?.error || 'No se pudo cargar el detalle de la solicitud.')
        : undefined,
    formValues: Array.isArray(valuesJson) ? valuesJson : [],
    notes: Array.isArray(notesJson) ? notesJson : [],
  };
}

/** Arranca la carga al hover/focus de Acciones (Ver detalle / ojo). */
export function prefetchAuthorizationDetail(requestId: number, withNotes: boolean): void {
  if (!Number.isInteger(requestId) || requestId <= 0) return;
  const key = keyOf(requestId, withNotes);
  const existing = fresh(cache.get(key));
  if (existing && (existing.data || existing.promise)) return;

  const promise = fetchDetail(requestId, withNotes)
    .then((data) => {
      cache.set(key, { at: Date.now(), data });
      return data;
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'No se pudo cargar el detalle de la solicitud.';
      cache.set(key, { at: Date.now(), error: message });
      throw err;
    });

  // Si nadie abre el detalle, el error de una precarga no debe quedar como rechazo sin manejar.
  promise.catch(() => {});
  cache.set(key, { at: Date.now(), promise });
}

export function peekAuthorizationDetail(
  requestId: number,
  withNotes: boolean
): PrefetchedAuthDetail | null {
  const entry = cache.get(keyOf(requestId, withNotes));
  return fresh(entry)?.data ?? null;
}

export async function loadAuthorizationDetail(
  requestId: number,
  withNotes: boolean,
  signal?: AbortSignal
): Promise<PrefetchedAuthDetail> {
  const key = keyOf(requestId, withNotes);
  const existing = fresh(cache.get(key));

  if (existing?.data) return existing.data;
  // Un error anterior no se reutiliza: al volver a abrir se intenta de nuevo.
  const pending = existing?.promise;
  if (pending) {
    if (!signal) return pending;
    return new Promise<PrefetchedAuthDetail>((resolve, reject) => {
      const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      pending.then(
        (data) => {
          signal.removeEventListener('abort', onAbort);
          resolve(data);
        },
        (err) => {
          signal.removeEventListener('abort', onAbort);
          reject(err);
        }
      );
    });
  }

  const promise = fetchDetail(requestId, withNotes)
    .then((data) => {
      cache.set(key, { at: Date.now(), data });
      return data;
    })
    .catch((err: unknown) => {
      if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) throw err;
      const message = err instanceof Error ? err.message : 'No se pudo cargar el detalle de la solicitud.';
      cache.set(key, { at: Date.now(), error: message });
      throw err;
    });

  cache.set(key, { at: Date.now(), promise });
  return promise;
}
