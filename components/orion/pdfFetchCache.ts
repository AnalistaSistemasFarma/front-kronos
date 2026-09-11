/**
 * Cache corta in-flight + TTL para no descargar el mismo PDF dos veces
 * (viewer iframe + canvas de colocación de firmas).
 */
const inflight = new Map<string, Promise<ArrayBuffer>>();
const resolved = new Map<string, { buffer: ArrayBuffer; expiresAt: number }>();
const TTL_MS = 60_000;

function isSameOrigin(url: string): boolean {
  return (
    url.startsWith('/') ||
    (typeof window !== 'undefined' && url.startsWith(window.location.origin))
  );
}

export async function fetchPdfArrayBuffer(sourceUrl: string): Promise<ArrayBuffer> {
  const cached = resolved.get(sourceUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.buffer.slice(0);
  }

  const pending = inflight.get(sourceUrl);
  if (pending) return (await pending).slice(0);

  const promise = (async () => {
    const res = await fetch(sourceUrl, {
      credentials: isSameOrigin(sourceUrl) ? 'include' : 'omit',
      cache: 'force-cache',
    });
    if (!res.ok) throw new Error(`No se pudo cargar el PDF (${res.status})`);
    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json') || contentType.includes('text/html')) {
      throw new Error('La URL no devolvió un PDF');
    }
    const buffer = await res.arrayBuffer();
    const head = new Uint8Array(buffer.slice(0, 5));
    const magic = String.fromCharCode(...head);
    if (!magic.startsWith('%PDF')) {
      throw new Error('La URL no devolvió un PDF');
    }
    resolved.set(sourceUrl, { buffer, expiresAt: Date.now() + TTL_MS });
    return buffer;
  })().finally(() => {
    inflight.delete(sourceUrl);
  });

  inflight.set(sourceUrl, promise);
  return (await promise).slice(0);
}
