'use client';

import { useEffect, useRef, useState } from 'react';

export type PdfPageImage = {
  page: number;
  dataUrl: string;
  width: number;
  height: number;
};

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

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
        let dataUrl = src!;
        if (!dataUrl.startsWith('data:')) {
          const res = await fetch(dataUrl);
          if (!res.ok) throw new Error('No se pudo cargar el PDF');
          dataUrl = await blobToDataUrl(await res.blob());
        }

        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1]! : dataUrl;
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

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
