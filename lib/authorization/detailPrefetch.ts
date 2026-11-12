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
  promise?: Promise<PrefetchedAuthDetail>;
};

const cache = new Map<string, Entry>();

function keyOf(requestId: number, withNotes: boolean, userKey?: string | null): string {
  const user = String(userKey || '').trim().toLowerCase() || 'anon';
  return `${user}:${requestId}:${withNotes ? 'notes' : 'firma'}`;
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

function rememberOk(key: string, data: PrefetchedAuthDetail): PrefetchedAuthDetail {
  // No cachear errores: al reabrir se reintenta.
  if (!data.detailOk) {
    cache.delete(key);
    return data;
  }
  cache.set(key, { at: Date.now(), data });
  return data;
}

/** Arranca la carga al hover/focus de Acciones (Ver detalle / ojo). */
export function prefetchAuthorizationDetail(
  requestId: number,
  withNotes: boolean,
  userKey?: string | null
): void {
  if (!Number.isInteger(requestId) || requestId <= 0) return;
  const key = keyOf(requestId, withNotes, userKey);
  const existing = fresh(cache.get(key));
  if (existing && (existing.data || existing.promise)) return;

  const promise = fetchDetail(requestId, withNotes)
    .then((data) => rememberOk(key, data))
    .catch((err: unknown) => {
      cache.delete(key);
      throw err;
    });

  // Si nadie abre el detalle, el error de una precarga no debe quedar como rechazo sin manejar.
  promise.catch(() => {});
  cache.set(key, { at: Date.now(), promise });
}

export function peekAuthorizationDetail(
  requestId: number,
  withNotes: boolean,
  userKey?: string | null
): PrefetchedAuthDetail | null {
  const entry = cache.get(keyOf(requestId, withNotes, userKey));
  return fresh(entry)?.data ?? null;
}

export async function loadAuthorizationDetail(
  requestId: number,
  withNotes: boolean,
  signal?: AbortSignal,
  userKey?: string | null
): Promise<PrefetchedAuthDetail> {
  const key = keyOf(requestId, withNotes, userKey);
  const existing = fresh(cache.get(key));

  if (existing?.data) return existing.data;
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
    .then((data) => rememberOk(key, data))
    .catch((err: unknown) => {
      cache.delete(key);
      if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) throw err;
      throw err;
    });

  cache.set(key, { at: Date.now(), promise });
  return promise;
}

/** Tras aprobar/firmar: no reutilizar un detalle viejo. */
export function invalidateAuthorizationDetailCache(
  requestId?: number,
  userKey?: string | null
): void {
  if (!requestId) {
    cache.clear();
    return;
  }
  const user = String(userKey || '').trim().toLowerCase() || 'anon';
  const prefix = `${user}:${requestId}:`;
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix) || key.includes(`:${requestId}:`)) {
      cache.delete(key);
    }
  }
}
