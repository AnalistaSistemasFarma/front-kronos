'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  NOMBRE_TIPO,
  cumpleanosComoEventos,
  fechaLarga,
  hoyEnBogota,
  type EventoDia,
  type PersonaCumple,
} from '../../lib/portal/calendario';
import { IMAGEN_CUMPLEANOS, SEGUNDOS_VENTANA_HOY, claveVentanaHoy, eventosDelDia, hayCumpleanos } from '../../lib/portal/ventana-hoy';

/**
 * VENTANA EMERGENTE «HOY» (Cristian Baldión, 2026-10-15): al entrar al portal muestra los eventos del día, de los MISMOS datos del
 * calendario (festivos, fechas importantes, eventos de la empresa y cumpleaños). Con cumpleaños lleva una imagen alusiva. Se cierra
 * sola a los ${SEGUNDOS_VENTANA_HOY} segundos —con una barra que lo muestra— o antes con ✕, con Escape o haciendo clic afuera.
 * Si hoy no hay nada que mostrar, NO se abre. Una vez por día y por navegador. Si alguna fuente falla, se muestra lo que sí llegó
 * (el calendario ya avisa de los errores; esta ventana no debe estorbar con ellos).
 */

const lectura = async (res: Response): Promise<Record<string, unknown>> => {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
};

export default function VentanaEventosHoy() {
  const [hoy, setHoy] = useState<string | null>(null);
  const [eventos, setEventos] = useState<EventoDia[]>([]);
  const [abierta, setAbierta] = useState(false);
  const botonCerrar = useRef<HTMLButtonElement | null>(null);

  const cerrar = useCallback(() => setAbierta(false), []);

  // 1) Qué hay hoy (una sola vez al entrar).
  useEffect(() => {
    const fecha = hoyEnBogota();
    setHoy(fecha);
    try {
      if (window.localStorage.getItem(claveVentanaHoy(fecha))) return; // ya se mostró hoy en este navegador
    } catch {
      // sin almacenamiento (modo privado estricto): se muestra igual
    }
    const control = new AbortController();
    (async () => {
      const pedir = async (ruta: string): Promise<Record<string, unknown>> => {
        try {
          const res = await fetch(`${ruta}?desde=${fecha}&hasta=${fecha}`, { cache: 'no-store', signal: control.signal });
          return res.ok ? await lectura(res) : {};
        } catch {
          return {};
        }
      };
      const [emp, cum] = await Promise.all([pedir('/api/portal/eventos'), pedir('/api/portal/cumpleanos')]);
      if (control.signal.aborted) return;
      const empresa = Array.isArray(emp.eventos) ? (emp.eventos as EventoDia[]) : [];
      const cumples = cumpleanosComoEventos(Array.isArray(cum.cumpleanos) ? (cum.cumpleanos as { fecha: string; personas: PersonaCumple[] }[]) : []);
      const lista = eventosDelDia(fecha, empresa, cumples);
      if (lista.length === 0) return;
      setEventos(lista);
      setAbierta(true);
      try {
        window.localStorage.setItem(claveVentanaHoy(fecha), '1');
      } catch {
        // idem
      }
    })();
    return () => control.abort();
  }, []);

  // 2) Mientras está abierta: se cierra sola a los 15 s, con Escape, y el fondo no se desplaza.
  useEffect(() => {
    if (!abierta) return;
    const temporizador = window.setTimeout(cerrar, SEGUNDOS_VENTANA_HOY * 1000);
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cerrar();
    };
    window.addEventListener('keydown', alTeclear);
    botonCerrar.current?.focus({ preventScroll: true });
    return () => {
      window.clearTimeout(temporizador);
      window.removeEventListener('keydown', alTeclear);
    };
  }, [abierta, cerrar]);

  if (!abierta || !hoy) return null;
  const cumple = hayCumpleanos(eventos);

  return (
    <div
      className='portal-th__hoy'
      role='dialog'
      aria-modal='true'
      aria-label='Eventos de hoy'
      data-testid='ventana-hoy'
      onClick={(e) => {
        if (e.target === e.currentTarget) cerrar();
      }}
    >
      <div className={`portal-th__hoy-caja${cumple ? ' portal-th__hoy-caja--cumple' : ''}`}>
        <header className='portal-th__hoy-barra'>
          <div>
            <strong>Hoy</strong>
            <small data-testid='ventana-hoy-fecha'>{fechaLarga(hoy)}</small>
          </div>
          <button ref={botonCerrar} type='button' onClick={cerrar} aria-label='Cerrar' data-testid='ventana-hoy-cerrar'>
            ✕
          </button>
        </header>

        <div className='portal-th__hoy-cuerpo'>
          {cumple && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className='portal-th__hoy-imagen' src={IMAGEN_CUMPLEANOS} alt='' data-testid='ventana-hoy-imagen' />
          )}
          <ul className='portal-th__hoy-eventos'>
            {eventos.map((e, i) => (
              <li key={`${e.tipo}-${e.id ?? i}-${e.titulo}`} data-testid='ventana-hoy-evento'>
                <i className={`portal-th__cal-punto portal-th__cal-punto--${e.tipo}`} aria-hidden='true' />
                <div>
                  <strong>{e.titulo}</strong>
                  <small>
                    {NOMBRE_TIPO[e.tipo]}
                    {e.descripcion ? ` · ${e.descripcion}` : ''}
                  </small>
                  {e.personas && e.personas.length > 0 && (
                    <ul className='portal-th__cal-cumples' data-testid='ventana-hoy-personas'>
                      {e.personas.map((p, k) => (
                        <li key={`${p.nombre}-${k}`}>
                          <strong>{p.nombre}</strong>
                          <small>{[p.empresa, p.area].filter(Boolean).join(' · ')}</small>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* La barra se vacía en SEGUNDOS_VENTANA_HOY segundos: muestra cuánto falta para que se cierre sola. */}
        <div className='portal-th__hoy-tiempo' aria-hidden='true'>
          <span style={{ animationDuration: `${SEGUNDOS_VENTANA_HOY}s` }} data-testid='ventana-hoy-barra' />
        </div>
      </div>
    </div>
  );
}
