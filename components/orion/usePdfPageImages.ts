'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchPdfArrayBuffer } from './pdfFetchCache';

export type PdfPageImage = {
  page: number;
  /** URL de la imagen de la página; null mientras se dibuja (la caja ya tiene su tamaño). */
  dataUrl: string | null;
  width: number;
  height: number;
};

/**
 * Páginas ya dibujadas, por contenido del PDF (no por URL: la de un documento en firma no
 * cambia cuando alguien firma). Volver a abrir el mismo PDF no lo vuelve a dibujar.
 */
const renderedCache = new Map<string, PdfPageImage[]>();
const RENDERED_CACHE_MAX = 6;

/** Huella rápida del PDF: tamaño + FNV-1a de una muestra de bytes repartida por todo el archivo. */
export function pdfFingerprint(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  const step = Math.max(1, Math.floor(bytes.length / 65536));
  for (let i = 0; i < bytes.length; i += step) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, 0x01000193);
  }
  // El final del PDF (xref/trailer) cambia con cada guardado: va completo.
  for (let i = Math.max(0, bytes.length - 2048); i < bytes.length; i++) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${bytes.length}:${(hash >>> 0).toString(16)}`;
}

function remember(key: string, pages: PdfPageImage[]) {
  renderedCache.delete(key);
  renderedCache.set(key, pages);
  while (renderedCache.size > RENDERED_CACHE_MAX) {
    const oldest = renderedCache.keys().next().value as string;
    for (const p of renderedCache.get(oldest) ?? []) if (p.dataUrl) URL.revokeObjectURL(p.dataUrl);
    renderedCache.delete(oldest);
  }
}

function canvasToObjectUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error('No se pudo dibujar la página'))),
      'image/png'
    );
  });
}

async function readPdfBytes(src: string): Promise<Uint8Array> {
  if (src.startsWith('data:') || src.startsWith('blob:')) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`No se pudo leer el PDF (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }
  return new Uint8Array(await fetchPdfArrayBuffer(src));
}

/**
 * Dibuja el PDF como imágenes, una por página. Todas las páginas salen de una vez con su
 * tamaño (para ubicar cajas y saber cuál es la última) y se van llenando en orden: la primera
 * se ve enseguida en lugar de esperar a que estén todas.
 */
export function usePdfPageImages(src: string | null | undefined, scale = 1.2) {
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
    const isCurrent = () => !cancelled && requestId.current === id;
    // Imágenes que no quedan en la caché se liberan al cerrar o cambiar de documento.
    const created: string[] = [];
    let kept = false;

    async function run() {
      setLoading(true);
      setError(null);
      try {
        const bytes = await readPdfBytes(src!);
        if (!isCurrent()) return;
        const key = `${scale}|${pdfFingerprint(bytes)}`;
        const cached = renderedCache.get(key);
        if (cached) {
          remember(key, cached);
          setPages(cached);
          return;
        }

        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

        const pdf = await pdfjs.getDocument({ data: bytes }).promise;
        try {
          const pdfPages = [];
          let current: PdfPageImage[] = [];
          for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const viewport = page.getViewport({ scale });
            pdfPages.push(page);
            current.push({ page: pageNum, dataUrl: null, width: viewport.width, height: viewport.height });
          }
          if (!isCurrent()) return;
          setPages(current);
          setLoading(false);

          for (let i = 0; i < pdfPages.length; i++) {
            const page = pdfPages[i]!;
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) continue;
            await page.render({ canvasContext: ctx, viewport }).promise;
            const url = await canvasToObjectUrl(canvas);
            created.push(url);
            canvas.width = 0;
            canvas.height = 0;
            if (!isCurrent()) return;
            current = current.map((p, idx) => (idx === i ? { ...p, dataUrl: url } : p));
            setPages(current);
          }
          remember(key, current);
          kept = true;
        } finally {
          void pdf.destroy();
        }
      } catch (e) {
        if (isCurrent()) {
          setError(e instanceof Error ? e.message : 'Error al leer el PDF');
          setPages([]);
        }
      } finally {
        if (isCurrent()) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
      if (!kept) for (const url of created) URL.revokeObjectURL(url);
    };
  }, [src, scale]);

  return { pages, loading, error };
}
