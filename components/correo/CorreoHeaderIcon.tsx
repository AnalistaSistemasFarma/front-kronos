'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ActionIcon, Indicator, Tooltip } from '@mantine/core';
import { IconMail } from '@tabler/icons-react';
import {
  CORREO_HREF,
  ICONO_CORREO_RETRASO_MS,
  ICONO_CORREO_TTL_MS,
  ariaIconoCorreo,
  borrarEstado,
  debeMostrarIconoCorreo,
  estadoDesdeRespuesta,
  estadoVencido,
  etiquetaNoLeidos,
  guardarEstado,
  leerEstadoGuardado,
  type EstadoIconoCorreo,
} from '../../lib/correo/iconoHeader';

/**
 * Acceso directo al módulo Correo en la cabecera, al lado de la campana
 * (2026-10-15, Nicolás Rivera). Mismo aspecto que la campana: ActionIcon «subtle»
 * gris, icono Tabler de 18 px, tooltip y contador rojo.
 *
 * Solo aparece si el servidor confirma el permiso del módulo (ver
 * lib/correo/iconoHeader.ts). La consulta es diferida, con caché de 3 min en la
 * pestaña (y otra de 3 min en el servidor) y nunca bloquea ni muestra errores.
 */

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

// Compartido entre montajes (la cabecera se vuelve a montar al cambiar de layout).
let memoria: EstadoIconoCorreo | null = null;
let enVuelo: Promise<EstadoIconoCorreo | null> | null = null;

async function consultar(email: string): Promise<EstadoIconoCorreo | null> {
  if (enVuelo) return enVuelo;
  enVuelo = (async () => {
    try {
      const res = await fetch('/api/correo/no-leidos', { credentials: 'same-origin', cache: 'no-store' });
      // 429 / 5xx: no se cambia lo que ya se sabía (fallo silencioso).
      if (res.status === 429 || res.status >= 500) return null;
      const body = res.status === 200 ? await res.json().catch(() => null) : null;
      const e = estadoDesdeRespuesta(email, res.status, body, Date.now());
      memoria = e;
      guardarEstado(storage(), e);
      return e;
    } catch {
      return null;
    } finally {
      enVuelo = null;
    }
  })();
  return enVuelo;
}

export default function CorreoHeaderIcon() {
  const { data: session, status } = useSession();
  const email = session?.user?.email ?? null;
  const pathname = usePathname();
  const [estado, setEstado] = useState<EstadoIconoCorreo | null>(null);
  const emailRef = useRef(email);
  emailRef.current = email;

  // Estado guardado (instantáneo) y primera consulta diferida.
  useEffect(() => {
    if (status !== 'authenticated' || !email) {
      if (status === 'unauthenticated') {
        memoria = null;
        borrarEstado(storage());
      }
      setEstado(null);
      return;
    }
    const guardado = memoria ?? leerEstadoGuardado(storage());
    if (guardado && guardado.email.toLowerCase() === email.toLowerCase()) setEstado(guardado);
    if (!estadoVencido(guardado, email, Date.now())) return;
    let cancelado = false;
    const t = setTimeout(() => {
      void consultar(email).then((e) => {
        if (!cancelado && e && emailRef.current === email) setEstado(e);
      });
    }, ICONO_CORREO_RETRASO_MS);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [status, email]);

  // Refresco: al volver a la pestaña o al navegar, solo si la caché venció; y cada TTL si está visible.
  useEffect(() => {
    if (status !== 'authenticated' || !email) return;
    const refrescar = () => {
      if (document.visibilityState !== 'visible') return;
      if (!estadoVencido(memoria, email, Date.now())) return;
      void consultar(email).then((e) => {
        if (e && emailRef.current === email) setEstado(e);
      });
    };
    document.addEventListener('visibilitychange', refrescar);
    const intervalo = setInterval(refrescar, ICONO_CORREO_TTL_MS);
    return () => {
      document.removeEventListener('visibilitychange', refrescar);
      clearInterval(intervalo);
    };
  }, [status, email]);

  useEffect(() => {
    if (status !== 'authenticated' || !email || !memoria) return;
    if (!estadoVencido(memoria, email, Date.now())) return;
    void consultar(email).then((e) => {
      if (e && emailRef.current === email) setEstado(e);
    });
  }, [pathname, status, email]);

  if (!debeMostrarIconoCorreo(email, estado)) return null;

  const noLeidos = estado?.noLeidos ?? null;
  const etiqueta = etiquetaNoLeidos(noLeidos);
  const activo = pathname?.startsWith(CORREO_HREF) ?? false;

  return (
    <Indicator label={etiqueta ?? undefined} size={16} disabled={!etiqueta} color='red' offset={4}>
      <Tooltip label='Correo' withArrow>
        <ActionIcon
          component={Link}
          href={CORREO_HREF}
          prefetch={false}
          variant='subtle'
          color='gray'
          aria-label={ariaIconoCorreo(noLeidos)}
          aria-current={activo ? 'page' : undefined}
          data-testid='header-correo'
        >
          <IconMail size={18} />
        </ActionIcon>
      </Tooltip>
    </Indicator>
  );
}
