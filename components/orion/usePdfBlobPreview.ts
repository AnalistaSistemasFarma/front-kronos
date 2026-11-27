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

    if (sourceUrl.startsWith('blob:')) {
      setBlobUrl(sourceUrl);
      setFailed(false);
      setLoading(false);
      return;
    }

    // `data:` también pasa a blob: un PDF grande como data URL (~12 MB de texto en el src del
    // iframe) dejaba la vista previa en gris en Firefox; el blob se muestra al instante.
    const isDataUrl = sourceUrl.startsWith('data:application/pdf');

    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setFailed(false);

    void (async () => {
      try {
        const buffer = isDataUrl
          ? await (await fetch(sourceUrl)).arrayBuffer()
          : await fetchPdfArrayBuffer(sourceUrl);
        if (cancelled) return;

        // Forzar application/pdf para que el iframe muestre y no descargue.
        const pdfBlob = new Blob([buffer], { type: 'application/pdf' });
        objectUrl = URL.createObjectURL(pdfBlob);
        setBlobUrl(objectUrl);
        setFailed(false);
      } catch {
        if (!cancelled) {
          // Si el data URL no se pudo convertir, se usa tal cual (comportamiento anterior).
          setBlobUrl(isDataUrl ? sourceUrl : null);
          setFailed(!isDataUrl);
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
