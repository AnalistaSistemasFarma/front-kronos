'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Páginas de un PDF como imágenes para ubicar las firmas — copia CONGELADA
 * (2026-10-03) de components/orion/usePdfPageImages.ts y su caché corta
 * (pdfFetchCache.ts) de SynerLink, dentro del SGC (aislamiento validado). La
 * única diferencia: el PDF del SGC (vista previa del documento) siempre se
 * pide al mismo origen con la sesión y sin caché del navegador.
 */
export type PdfPageImage = {
  page: number;
  dataUrl: string;
  width: number;
  height: number;
};

const inflight = new Map<string, Promise<ArrayBuffer>>();
const resolved = new Map<string, { buffer: ArrayBuffer; expiresAt: number }>();
const TTL_MS = 60_000;

async function fetchPdfArrayBuffer(sourceUrl: string): Promise<ArrayBuffer> {
  const cached = resolved.get(sourceUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.buffer.slice(0);
  }

  const pending = inflight.get(sourceUrl);
  if (pending) return (await pending).slice(0);

  const promise = (async () => {
    const res = await fetch(sourceUrl, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error || `No se pudo cargar el PDF (${res.status})`);
    }
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

export function useSgcPdfPageImages(src: string | null | undefined, scale = 1.2) {
  const [pages, setPages] = useState<PdfPageImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (!src) {
      setPages([]);
      setError(null);
      setLoading(false);
      return;
    }

    const id = ++requestId.current;
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      try {
        const buffer = await fetchPdfArrayBuffer(src!);
        if (cancelled || requestId.current !== id) return;
        const bytes = new Uint8Array(buffer);

        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

        const pdf = await pdfjs.getDocument({ data: bytes }).promise;
        const next: PdfPageImage[] = [];

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          if (cancelled || requestId.current !== id) return;
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport }).promise;
          next.push({
            page: pageNum,
            dataUrl: canvas.toDataURL('image/png'),
            width: viewport.width,
            height: viewport.height,
          });
        }

        if (!cancelled && requestId.current === id) setPages(next);
      } catch (e) {
        if (!cancelled && requestId.current === id) {
          setError(e instanceof Error ? e.message : 'Error al leer el PDF');
          setPages([]);
        }
      } finally {
        if (!cancelled && requestId.current === id) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [src, scale]);

  return { pages, loading, error };
}
