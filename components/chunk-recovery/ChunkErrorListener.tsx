'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { isNewBuild } from '../../lib/chunk-recovery/buildId';
import { tryAutoReload } from '../../lib/chunk-recovery/chunkError';

const CURRENT_BUILD = process.env.NEXT_PUBLIC_SYNERLINK_BUILD_ID;
const CHECK_EVERY_MS = 60_000;

/**
 * 1) Escucha 'error' y 'unhandledrejection' de la ventana: si es un chunk que
 *    ya no existe (despliegue nuevo), recarga una sola vez.
 * 2) Si el servidor ya tiene un build nuevo, recarga en la siguiente navegación.
 */
export default function ChunkErrorListener() {
  const pathname = usePathname();
  const stale = useRef(false);
  const lastCheck = useRef(0);
  const firstPath = useRef(pathname);

  useEffect(() => {
    const onError = (ev: ErrorEvent) => {
      const target = ev.target as HTMLScriptElement | HTMLLinkElement | null;
      const src = target && 'src' in target ? target.src : target && 'href' in target ? target.href : '';
      const err = ev.error ?? ev.message ?? (src && src.includes('/_next/static/') ? 'ChunkLoadError ' + src : '');
      tryAutoReload(err);
    };
    const onRejection = (ev: PromiseRejectionEvent) => {
      tryAutoReload(ev.reason);
    };
    window.addEventListener('error', onError, true);
    window.addEventListener('unhandledrejection', onRejection);

    const check = async () => {
      if (!CURRENT_BUILD || stale.current) return;
      const now = Date.now();
      if (now - lastCheck.current < CHECK_EVERY_MS) return;
      lastCheck.current = now;
      try {
        const res = await fetch('/api/build-id', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { buildId?: string };
        if (isNewBuild(CURRENT_BUILD, data.buildId)) stale.current = true;
      } catch {
        /* sin red o en despliegue: se reintenta luego */
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    void check();
    return () => {
      window.removeEventListener('error', onError, true);
      window.removeEventListener('unhandledrejection', onRejection);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, []);

  // Navegación con build viejo detectado: recarga completa a la ruta nueva.
  useEffect(() => {
    if (pathname === firstPath.current) return;
    firstPath.current = pathname;
    if (stale.current) window.location.reload();
  }, [pathname]);

  return null;
}
