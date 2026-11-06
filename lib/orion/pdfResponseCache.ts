import 'server-only';
import { createHash } from 'crypto';

/**
 * PDF ya armado (descargado de Orion/OneDrive + sello, visto bueno, datos y sellos) guardado en
 * memoria del proceso. La llave incluye el estado de firma del documento: cuando alguien firma,
 * valida o guarda datos, el estado cambia y la llave también, así que nunca se sirve uno viejo.
 * Volver a abrir el mismo documento pasa de varios segundos a casi nada.
 */

type Entry = { body: Buffer; contentType: string; expiresAt: number };

const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_ENTRY_BYTES = 40 * 1024 * 1024;
/** Firmado del todo: no cambia salvo que se agreguen datos (y eso cambia el estado). */
export const PDF_CACHE_TTL_SEALED_MS = 30 * 60 * 1000;
/** En firma: Orion puede tener una firma nueva antes de que llegue al estado de Kronos. */
export const PDF_CACHE_TTL_ACTIVE_MS = 2 * 60 * 1000;

const entries = new Map<string, Entry>();
let totalBytes = 0;

function drop(key: string) {
  const hit = entries.get(key);
  if (!hit) return;
  totalBytes -= hit.body.byteLength;
  entries.delete(key);
}

/** Llave estable: mismos datos → misma llave (el estado puede ser un objeto grande). */
export function pdfCacheKey(parts: Record<string, unknown>): string {
  return createHash('sha1').update(JSON.stringify(parts)).digest('hex');
}

export function getCachedPdf(key: string): { body: Buffer; contentType: string } | null {
  const hit = entries.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    drop(key);
    return null;
  }
  // Más reciente al final (se borra primero lo que nadie ha vuelto a abrir).
  entries.delete(key);
  entries.set(key, hit);
  return { body: hit.body, contentType: hit.contentType };
}

export function setCachedPdf(key: string, body: Buffer, contentType: string, ttlMs: number): void {
  if (body.byteLength === 0 || body.byteLength > MAX_ENTRY_BYTES) return;
  drop(key);
  entries.set(key, { body, contentType, expiresAt: Date.now() + ttlMs });
  totalBytes += body.byteLength;
  for (const oldest of entries.keys()) {
    if (totalBytes <= MAX_TOTAL_BYTES) break;
    drop(oldest);
  }
}

/** Solo para pruebas. */
export function clearPdfCache(): void {
  entries.clear();
  totalBytes = 0;
}
