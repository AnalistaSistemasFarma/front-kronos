'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchPdfArrayBuffer } from './pdfFetchCache';

export type PdfPageImage = {
  page: number;
  dataUrl: string;
  width: number;
  height: number;
};

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

    async function run() {
      setLoading(true);
      setError(null);
      try {
        let bytes: Uint8Array;
        if (src!.startsWith('data:')) {
          const base64 = src!.includes(',') ? src!.split(',')[1]! : src!;
          const binary = atob(base64);
          bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        } else if (src!.startsWith('blob:')) {
          const res = await fetch(src!);
          if (!res.ok) throw new Error(`No se pudo leer el PDF (${res.status})`);
          bytes = new Uint8Array(await res.arrayBuffer());
        } else {
          const buffer = await fetchPdfArrayBuffer(src!);
          if (cancelled || requestId.current !== id) return;
          bytes = new Uint8Array(buffer);
        }

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
