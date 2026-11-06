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
import {
  IMAGEN_CUMPLEANOS,
  DIAS_PROXIMOS_VENTANA_HOY,
  SEGUNDOS_VENTANA_HOY,
  claveVentanaHoy,
  eventosDelDia,
  finDeProximos,
  hayCumpleanos,
  omitirPorMarca,
  proximosEventos,
} from '../../lib/portal/ventana-hoy';

/**
 * VENTANA EMERGENTE «HOY» (Cristian Baldión, 2026-10-15): al entrar al portal muestra los eventos del día, de los MISMOS datos del
 * calendario (festivos, fechas importantes, eventos de la empresa y cumpleaños). Con cumpleaños lleva una imagen alusiva. Se cierra
 * sola a los ${SEGUNDOS_VENTANA_HOY} segundos —con una barra que lo muestra— o antes con ✕, con Escape o haciendo clic afuera.
 * Sale SIEMPRE, cada vez que se entra al portal (Cristian, 2026-10-16: «cada vez que yo actualice la página»; 2026-10-21: «sí, que
 * salga siempre»): ya nadie guarda la marca de «ya vista». Si hoy no hay nada, dice «Hoy no hay eventos ni cumpleaños» y muestra los
 * próximos de los siguientes 30 días (máximo 5). Esa marca solo se LEE, y únicamente la dejan las pruebas automáticas
 * (playwright.config.ts) para que la ventana no tape las demás pruebas. Si alguna fuente falla, se muestra lo que sí llegó
 * (el calendario ya avisa de los errores; esta ventana no debe estorbar con ellos).
 */

const lectura = async (res: Response): Promise<Record<string, unknown>> => {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
};

/** «jueves, 22 de octubre» (sin el año): la fecha de un evento próximo. */
const fechaSinAño = (iso: string) => fechaLarga(iso).replace(/ de \d{4}$/, '');

/** Un evento de la lista (el del día o uno de los próximos, que además dice su fecha). */
function renderEvento(e: EventoDia, i: number, testId: string, conFecha = false) {
  return (
    <li key={`${e.fecha}-${e.tipo}-${e.id ?? i}-${e.titulo}`} data-testid={testId}>
      <i className={`portal-th__cal-punto portal-th__cal-punto--${e.tipo}`} aria-hidden='true' />
      <div>
        <strong>{e.titulo}</strong>
        <small>
          {conFecha ? `${fechaSinAño(e.fecha)} · ` : ''}
          {NOMBRE_TIPO[e.tipo]}
          {e.descripcion ? ` · ${e.descripcion}` : ''}
        </small>
        {e.personas && e.personas.length > 0 && (
          <ul className='portal-th__cal-cumples' data-testid='ventana-hoy-personas'>
            {e.personas.map((p, k) => (
              <li key={`${p.nombre}-${k}`}>
                <strong>{p.nombre}</strong>
                <small>{[p.empresa, p.cargo].filter(Boolean).join(' · ')}</small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

export default function VentanaEventosHoy() {
  const [hoy, setHoy] = useState<string | null>(null);
  const [eventos, setEventos] = useState<EventoDia[]>([]);
  const [siguientes, setSiguientes] = useState<EventoDia[]>([]);
  const [abierta, setAbierta] = useState(false);
  const botonCerrar = useRef<HTMLButtonElement | null>(null);

  const cerrar = useCallback(() => setAbierta(false), []);

  // 1) Qué hay hoy y, si no hay nada, qué viene (cada vez que se entra al portal).
  useEffect(() => {
    const fecha = hoyEnBogota();
    setHoy(fecha);
    try {
      // Interruptor de las pruebas automáticas: solo cuenta en un navegador automatizado. En uno real se ignora, aunque haya quedado
      // una marca vieja de la versión de «una vez por día»: la ventana sale en cada carga.
      if (omitirPorMarca(!!window.localStorage.getItem(claveVentanaHoy(fecha)), navigator.webdriver === true)) return;
    } catch {
      // sin almacenamiento (modo privado estricto): se muestra igual
    }
    const control = new AbortController();
    const fin = finDeProximos(fecha); // un solo pedido por fuente: hoy y los próximos días
    (async () => {
      const pedir = async (ruta: string): Promise<Record<string, unknown>> => {
        try {
          const res = await fetch(`${ruta}?desde=${fecha}&hasta=${fin}`, { cache: 'no-store', signal: control.signal });
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
      setEventos(lista);
      setSiguientes(lista.length === 0 ? proximosEventos(fecha, empresa, cumples) : []);
      setAbierta(true);
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
          {eventos.length > 0 ? (
            <ul className='portal-th__hoy-eventos'>{eventos.map((e, i) => renderEvento(e, i, 'ventana-hoy-evento'))}</ul>
          ) : (
            <>
              <p className='portal-th__hoy-vacio' data-testid='ventana-hoy-vacio'>
                Hoy no hay eventos ni cumpleaños.
              </p>
              {siguientes.length > 0 ? (
                <>
                  <h3 className='portal-th__hoy-subtitulo'>Próximos</h3>
                  <ul className='portal-th__hoy-eventos'>{siguientes.map((e, i) => renderEvento(e, i, 'ventana-hoy-proximo', true))}</ul>
                </>
              ) : (
                <p className='portal-th__hoy-vacio portal-th__hoy-vacio--pista'>No hay eventos en los próximos {DIAS_PROXIMOS_VENTANA_HOY} días.</p>
              )}
            </>
          )}        </div>

        {/* La barra se vacía en SEGUNDOS_VENTANA_HOY segundos: muestra cuánto falta para que se cierre sola. */}
        <div className='portal-th__hoy-tiempo' aria-hidden='true'>
          <span style={{ animationDuration: `${SEGUNDOS_VENTANA_HOY}s` }} data-testid='ventana-hoy-barra' />
        </div>
      </div>
    </div>
  );
}
