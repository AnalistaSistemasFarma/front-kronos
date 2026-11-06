import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearPdfCache, getCachedPdf, pdfCacheKey, setCachedPdf } from '../pdfResponseCache';
import { pdfFingerprint } from '../../../components/orion/usePdfPageImages';

afterEach(() => {
  clearPdfCache();
  vi.useRealTimers();
});

describe('PDF armado en memoria del servidor', () => {
  it('la llave cambia cuando cambia el estado de firma', () => {
    const base = { route: 'signed-file', requestId: 1, fileId: 'f', state: { status: 'EN_PROCESO', signers: [{ status: 'PENDIENTE' }] } };
    const signed = { ...base, state: { status: 'EN_PROCESO', signers: [{ status: 'FIRMADO' }] } };
    expect(pdfCacheKey(base)).toBe(pdfCacheKey({ ...base }));
    expect(pdfCacheKey(base)).not.toBe(pdfCacheKey(signed));
  });

  it('entrega lo guardado hasta que vence', () => {
    vi.useFakeTimers();
    setCachedPdf('k', Buffer.from('%PDF-1'), 'application/pdf', 1000);
    expect(getCachedPdf('k')?.body.toString()).toBe('%PDF-1');
    vi.advanceTimersByTime(1001);
    expect(getCachedPdf('k')).toBeNull();
  });

  it('no guarda archivos vacíos ni enormes, y saca lo más viejo cuando se llena', () => {
    setCachedPdf('vacio', Buffer.alloc(0), 'application/pdf', 60_000);
    expect(getCachedPdf('vacio')).toBeNull();
    setCachedPdf('enorme', Buffer.alloc(41 * 1024 * 1024), 'application/pdf', 60_000);
    expect(getCachedPdf('enorme')).toBeNull();
    for (let i = 0; i < 6; i++) setCachedPdf(`d${i}`, Buffer.alloc(39 * 1024 * 1024), 'application/pdf', 60_000);
    expect(getCachedPdf('d0')).toBeNull();
    expect(getCachedPdf('d5')).not.toBeNull();
  });
});

describe('huella del PDF (páginas ya dibujadas en el navegador)', () => {
  it('mismo contenido → misma huella; un cambio al final (nueva firma) → otra', () => {
    const a = new Uint8Array(300_000).map((_, i) => i % 251);
    const b = a.slice();
    b[b.length - 10] = 7;
    expect(pdfFingerprint(a)).toBe(pdfFingerprint(a.slice()));
    expect(pdfFingerprint(a)).not.toBe(pdfFingerprint(b));
  });
});
