'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { isChunkLoadError, recargarUnaVez } from '../../lib/chunk-recovery';

const BUILD_CLIENTE = process.env.APP_BUILD_ID ?? '';
const INTERVALO_MS = 5 * 60_000;

/**
 * 1) Atrapa fallos de carga de chunks que no pasan por los límites de error
 *    (scripts que no cargan, promesas de import() sin manejar) y recarga una vez.
 * 2) Consulta /api/health/version: si el servidor ya tiene otro build, muestra un
 *    aviso discreto y recarga la página completa en el próximo cambio de ruta,
 *    antes de que el usuario pida un chunk que ya no existe.
 */
export default function RecuperacionActualizacion() {
  const pathname = usePathname();
  const [hayVersionNueva, setHayVersionNueva] = useState(false);
  const rutaInicial = useRef(pathname);

  useEffect(() => {
    const alError = (ev: Event) => {
      const err = (ev as ErrorEvent).error ?? (ev as ErrorEvent).message;
      const destino = ev.target as HTMLScriptElement | HTMLLinkElement | null;
      const src = destino && 'src' in destino ? destino.src : destino && 'href' in destino ? destino.href : '';
      const recursoNext = typeof src === 'string' && src.includes('/_next/static/');
      if (recursoNext || isChunkLoadError(err)) recargarUnaVez();
    };
    const alRechazo = (ev: PromiseRejectionEvent) => {
      if (isChunkLoadError(ev.reason)) recargarUnaVez();
    };
    window.addEventListener('error', alError, true);
    window.addEventListener('unhandledrejection', alRechazo);
    return () => {
      window.removeEventListener('error', alError, true);
      window.removeEventListener('unhandledrejection', alRechazo);
    };
  }, []);

  useEffect(() => {
    if (!BUILD_CLIENTE) return;
    let vivo = true;
    const revisar = async () => {
      try {
        const r = await fetch('/api/health/version', { cache: 'no-store' });
        if (!r.ok) return;
        const { buildId } = (await r.json()) as { buildId?: string | null };
        if (vivo && buildId && buildId !== BUILD_CLIENTE) setHayVersionNueva(true);
      } catch {
        // Servidor reiniciando o sin red: se revisa en el siguiente intento.
      }
    };
    const alVolver = () => document.visibilityState === 'visible' && revisar();
    revisar();
    const id = window.setInterval(revisar, INTERVALO_MS);
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('focus', alVolver);
    return () => {
      vivo = false;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('focus', alVolver);
    };
  }, []);

  // Versión nueva + cambio de ruta: carga completa de la ruta nueva (HTML y
  // chunks del build actual) en vez de una navegación de cliente con chunks viejos.
  useEffect(() => {
    if (pathname === rutaInicial.current) return;
    rutaInicial.current = pathname;
    if (hayVersionNueva) window.location.reload();
  }, [pathname, hayVersionNueva]);

  if (!hayVersionNueva) return null;
  return (
    <div
      role='status'
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 16,
        transform: 'translateX(-50%)',
        zIndex: 2147483000,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        maxWidth: 'calc(100vw - 32px)',
        background: '#1a3c6e',
        color: '#fff',
        borderRadius: 10,
        padding: '8px 8px 8px 16px',
        boxShadow: '0 4px 16px rgba(15,26,44,.2)',
        fontSize: 14,
        fontFamily: '"Source Sans 3", "Segoe UI", system-ui, sans-serif',
      }}
    >
      <span>Hay una versión nueva de SynerLink.</span>
      <button
        type='button'
        onClick={() => window.location.reload()}
        style={{
          font: 'inherit',
          fontWeight: 600,
          color: '#1a3c6e',
          background: '#fff',
          border: 0,
          borderRadius: 6,
          padding: '6px 12px',
          cursor: 'pointer',
        }}
      >
        Actualizar
      </button>
    </div>
  );
}
