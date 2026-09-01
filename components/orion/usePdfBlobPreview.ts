'use client';

import { useEffect, useState } from 'react';

/** Carga un PDF remoto como blob URL para poder mostrarlo en object/iframe. */
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

    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setFailed(false);

    void (async () => {
      try {
        const res = await fetch(sourceUrl);
        if (!res.ok) throw new Error('fetch failed');
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
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
