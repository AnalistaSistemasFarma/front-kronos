'use client';

import { useEffect } from 'react';
import { isPushFeatureEnabled } from '../lib/push/client';

export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (!isPushFeatureEnabled()) return;

    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[SW] No se pudo registrar el service worker:', err);
    });
  }, []);

  return null;
}
