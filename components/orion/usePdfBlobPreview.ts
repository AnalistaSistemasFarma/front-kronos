'use client';

import { useEffect, useState } from 'react';
import { fetchPdfArrayBuffer } from './pdfFetchCache';

/** Carga un PDF remoto como blob URL para mostrarlo embebido (sin forzar descarga). */
export function usePdfBlobPreview(sourceUrl: string | null | undefined, enabled = true) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled || !sourceUrl) {
      setBlobUrl(null);
      setFailed(false);
      setLoading(false);
      return;
    }

    if (sourceUrl.startsWith('blob:') || sourceUrl.startsWith('data:application/pdf')) {
      setBlobUrl(sourceUrl);
      setFailed(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setFailed(false);

    void (async () => {
      try {
        const buffer = await fetchPdfArrayBuffer(sourceUrl);
        if (cancelled) return;

        // Forzar application/pdf para que el iframe muestre y no descargue.
        const pdfBlob = new Blob([buffer], { type: 'application/pdf' });
        objectUrl = URL.createObjectURL(pdfBlob);
        setBlobUrl(objectUrl);
        setFailed(false);
      } catch {
        if (!cancelled) {
          setBlobUrl(null);
          setFailed(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [enabled, sourceUrl]);

  return { blobUrl, loading, failed };
}
