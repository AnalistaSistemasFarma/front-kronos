'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DIAS_SEMANA_CORTO,
  MAX_DESCRIPCION_EVENTO,
  MAX_TITULO_EVENTO,
  MESES,
  NOMBRE_TIPO,
  cuadriculaDelMes,
  eventosFijosPorDia,
  fechaLarga,
  hoyEnBogota,
  mesVecino,
  proximos,
  unirEventos,
  validarEvento,
  type EventoDia,
  type TipoEvento,
} from '../../lib/portal/calendario';

/**
 * PORTAL TH — CALENDARIO de la ventana principal (Cristian Baldión, 2026-10-09).
 *
 * Arriba a la izquierda, sobre los botones de navegación: un calendario de Colombia con los festivos y las
 * fechas importantes, y DEBAJO un recuadro con los eventos del día elegido. Los festivos se calculan por ley
 * (`lib/portal/calendario.ts`); los eventos de la empresa vienen de `/api/portal/eventos` y solo los
 * editores del portal (los de los anuncios) los agregan o quitan.
 *
 * Mismo estilo que el resto de la ventana principal (CSS propio `portal-th__*`, sin Mantine: esta página abre
 * también para quienes no tienen usuario en SynerLink y se piensa para celulares con mala señal). En celular
 * el calendario se pliega para no empujar el contenido; en escritorio siempre está desplegado.
 * Los avisos (error, éxito) van ARRIBA del recuadro de eventos y con color.
 */

const lectura = async (res: Response): Promise<Record<string, unknown>> => {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const mes2 = (n: number) => String(n).padStart(2, '0');
const DOS_TIPOS_PUNTO: TipoEvento[] = ['festivo', 'laboral', 'conmemoracion', 'empresa'];

export default function PortalCalendario({ puedeEditar }: { puedeEditar: boolean }) {
  const [hoy, setHoy] = useState<string | null>(null);
  const [visible, setVisible] = useState<{ año: number; mes: number } | null>(null);
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [empresa, setEmpresa] = useState<EventoDia[]>([]);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [plegado, setPlegado] = useState(true); // solo se nota en celular (ver el CSS)
  const [nuevo, setNuevo] = useState<{ titulo: string; descripcion: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [quitando, setQuitando] = useState<number | null>(null);
  const [puedeEditarServidor, setPuedeEditarServidor] = useState(false);
  const avisoRef = useRef<HTMLDivElement | null>(null);

  // La fecha de hoy se fija en el navegador (hora de Colombia): así servidor y cliente no discrepan.
  useEffect(() => {
    const h = hoyEnBogota();
    setHoy(h);
    setSeleccionado(h);
    setVisible({ año: Number(h.slice(0, 4)), mes: Number(h.slice(5, 7)) });
  }, []);

  const celdas = useMemo(() => (visible ? cuadriculaDelMes(visible.año, visible.mes) : []), [visible]);
  const desde = celdas[0]?.fecha;
  const hasta = celdas[celdas.length - 1]?.fecha;

  const cargarEmpresa = useCallback(async () => {
    if (!desde || !hasta) return;
    try {
      const res = await fetch(`/api/portal/eventos?desde=${desde}&hasta=${hasta}`, { cache: 'no-store' });
      if (res.status === 401) return setEmpresa([]);
      const data = await lectura(res);
      if (!res.ok) throw new Error(String(data.error ?? 'No se pudieron cargar los eventos de la empresa.'));
      setEmpresa(Array.isArray(data.eventos) ? (data.eventos as EventoDia[]) : []);
      setPuedeEditarServidor(data.puedeEditar === true);
    } catch (e) {
      setAviso({ tipo: 'error', texto: (e as Error).message });
    }
  }, [desde, hasta]);

  useEffect(() => {
    void cargarEmpresa();
  }, [cargarEmpresa]);

  // El aviso va ARRIBA: al aparecer uno, se lleva a la persona hasta él.
  useEffect(() => {
    if (!aviso) return;
    window.requestAnimationFrame(() => avisoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }, [aviso]);

  const todo = useMemo(() => {
    if (celdas.length === 0) return new Map<string, EventoDia[]>();
    const años = [Number(celdas[0].fecha.slice(0, 4)), Number(celdas[celdas.length - 1].fecha.slice(0, 4))];
    return unirEventos(eventosFijosPorDia(años), empresa);
  }, [celdas, empresa]);

  if (!hoy || !visible || !seleccionado) return null;

  const editar = puedeEditar || puedeEditarServidor;
  const delDia = todo.get(seleccionado) ?? [];
  const siguientes = delDia.length === 0 ? proximos(todo, seleccionado, 1) : [];

  const irAlMes = (delta: -1 | 1) => {
    const v = mesVecino(visible.año, visible.mes, delta);
    setVisible(v);
    setAviso(null);
    setNuevo(null);
  };
  const irAHoy = () => {
    setVisible({ año: Number(hoy.slice(0, 4)), mes: Number(hoy.slice(5, 7)) });
    setSeleccionado(hoy);
    setAviso(null);
  };
  const elegir = (fecha: string) => {
    setSeleccionado(fecha);
    setAviso(null);
    setNuevo(null);
    // Un día de otro mes lleva a ese mes.
    if (!fecha.startsWith(`${visible.año}-${mes2(visible.mes)}`)) setVisible({ año: Number(fecha.slice(0, 4)), mes: Number(fecha.slice(5, 7)) });
  };

  const guardar = async () => {
    if (!nuevo) return;
    setAviso(null);
    const v = validarEvento({ fecha: seleccionado, ...nuevo });
    if (!v.ok) return setAviso({ tipo: 'error', texto: v.error });
    setGuardando(true);
    try {
      const res = await fetch('/api/portal/eventos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fecha: v.fecha, titulo: v.titulo, descripcion: v.descripcion }),
      });
      const data = await lectura(res);
      if (!res.ok) throw new Error(String(data.error ?? 'No se pudo guardar el evento.'));
      setEmpresa((l) => [...l, data.evento as EventoDia]);
      setNuevo(null);
      setAviso({ tipo: 'ok', texto: `Evento agregado: ${v.titulo}.` });
    } catch (e) {
      setAviso({ tipo: 'error', texto: (e as Error).message });
    } finally {
      setGuardando(false);
    }
  };

  const quitar = async (e: EventoDia) => {
    if (e.id === undefined) return;
    setAviso(null);
    try {
      const res = await fetch(`/api/portal/eventos/${e.id}`, { method: 'DELETE' });
      const data = await lectura(res);
      if (!res.ok) throw new Error(String(data.error ?? 'No se pudo quitar el evento.'));
      setEmpresa((l) => l.filter((x) => x.id !== e.id));
      setAviso({ tipo: 'ok', texto: `Evento quitado: ${e.titulo}.` });
    } catch (err) {
      setAviso({ tipo: 'error', texto: (err as Error).message });
    } finally {
      setQuitando(null);
    }
  };

  return (
    <div className={`portal-th__cal${plegado ? ' portal-th__cal--plegado' : ''}`} data-testid='portal-calendario'>
      {/* Solo se ve en celular: pliega y despliega el calendario. */}
      <button type='button' className='portal-th__cal-alternar' aria-expanded={!plegado} onClick={() => setPlegado((p) => !p)} data-testid='calendario-alternar'>
        <span>Calendario y eventos</span>
        <span className='portal-th__cal-alternar-fecha'>{fechaLarga(hoy)}</span>
      </button>

      <div className='portal-th__cal-cuerpo'>
        <section className='portal-th__cal-tarjeta' aria-label='Calendario'>
          <header className='portal-th__cal-cabecera'>
            <button type='button' className='portal-th__cal-flecha' aria-label='Mes anterior' onClick={() => irAlMes(-1)} data-testid='mes-anterior'>
              ‹
            </button>
            <div className='portal-th__cal-titulo' aria-live='polite' data-testid='mes-titulo'>
              {MESES[visible.mes - 1]} {visible.año}
            </div>
            <button type='button' className='portal-th__cal-flecha' aria-label='Mes siguiente' onClick={() => irAlMes(1)} data-testid='mes-siguiente'>
              ›
            </button>
          </header>

          <div className='portal-th__cal-semana' aria-hidden='true'>
            {DIAS_SEMANA_CORTO.map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>

          <div className='portal-th__cal-cuadricula' role='group' aria-label={`${MESES[visible.mes - 1]} de ${visible.año}`}>
            {celdas.map((c) => {
              const eventos = todo.get(c.fecha) ?? [];
              const esFestivo = eventos.some((e) => e.tipo === 'festivo');
              const tipos = DOS_TIPOS_PUNTO.filter((t) => eventos.some((e) => e.tipo === t));
              const clases = [
                'portal-th__cal-dia',
                !c.delMes && 'portal-th__cal-dia--fuera',
                c.fecha === hoy && 'portal-th__cal-dia--hoy',
                c.fecha === seleccionado && 'portal-th__cal-dia--sel',
                esFestivo && 'portal-th__cal-dia--festivo',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <button
                  key={c.fecha}
                  type='button'
                  className={clases}
                  aria-label={`${fechaLarga(c.fecha)}${eventos.length > 0 ? `, ${eventos.length} ${eventos.length === 1 ? 'evento' : 'eventos'}` : ''}`}
                  aria-pressed={c.fecha === seleccionado}
                  aria-current={c.fecha === hoy ? 'date' : undefined}
                  onClick={() => elegir(c.fecha)}
                  data-fecha={c.fecha}
                >
                  <span>{c.dia}</span>
                  <span className='portal-th__cal-puntos' aria-hidden='true'>
                    {tipos.map((t) => (
                      <i key={t} className={`portal-th__cal-punto portal-th__cal-punto--${t}`} />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>

          <footer className='portal-th__cal-pie'>
            <button type='button' className='portal-th__cal-hoy' onClick={irAHoy} data-testid='calendario-hoy'>
              Hoy
            </button>
            <ul className='portal-th__cal-leyenda' aria-label='Leyenda'>
              {DOS_TIPOS_PUNTO.map((t) => (
                <li key={t}>
                  <i className={`portal-th__cal-punto portal-th__cal-punto--${t}`} aria-hidden='true' />
                  {t === 'festivo' ? 'Festivo' : t === 'laboral' ? 'Laboral' : t === 'conmemoracion' ? 'Importante' : 'Empresa'}
                </li>
              ))}
            </ul>
          </footer>
        </section>

        <section className='portal-th__cal-tarjeta' aria-label='Eventos del día' aria-live='polite' data-testid='calendario-eventos'>
          {/* Aviso de resultado ARRIBA y con color. */}
          {aviso && (
            <div ref={avisoRef} className={`portal-th__cal-aviso portal-th__cal-aviso--${aviso.tipo}`} role={aviso.tipo === 'error' ? 'alert' : 'status'} data-testid='calendario-aviso'>
              {aviso.texto}
            </div>
          )}
          <h3 className='portal-th__cal-dia-titulo' data-testid='eventos-titulo'>
            {fechaLarga(seleccionado)}
          </h3>

          {delDia.length > 0 ? (
            <ul className='portal-th__cal-eventos'>
              {delDia.map((e, i) => (
                <li key={`${e.tipo}-${e.id ?? i}`} className='portal-th__cal-evento' data-testid='evento-item'>
                  <i className={`portal-th__cal-punto portal-th__cal-punto--${e.tipo}`} aria-hidden='true' />
                  <div className='portal-th__cal-evento-texto'>
                    <strong>{e.titulo}</strong>
                    <small>
                      {NOMBRE_TIPO[e.tipo]}
                      {e.descripcion ? ` · ${e.descripcion}` : ''}
                    </small>
                  </div>
                  {e.tipo === 'empresa' && editar && (
                    quitando === e.id ? (
                      <span className='portal-th__cal-confirmar'>
                        <button type='button' className='portal-th__cal-mini portal-th__cal-mini--peligro' onClick={() => void quitar(e)} data-testid='confirmar-quitar'>
                          Quitar
                        </button>
                        <button type='button' className='portal-th__cal-mini' onClick={() => setQuitando(null)}>
                          No
                        </button>
                      </span>
                    ) : (
                      <button type='button' className='portal-th__cal-mini' aria-label={`Quitar el evento ${e.titulo}`} onClick={() => setQuitando(e.id ?? null)} data-testid='quitar-evento'>
                        ✕
                      </button>
                    )
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className='portal-th__cal-vacio' data-testid='sin-eventos'>
              No hay eventos para este día.
              {siguientes[0] && (
                <>
                  {' '}
                  <span className='portal-th__cal-proximo'>
                    Próximo: {fechaLarga(siguientes[0].fecha).replace(/^[a-záéíóú]+, /, '')} — {siguientes[0].titulo}.
                  </span>
                </>
              )}
            </p>
          )}

          {editar &&
            (nuevo ? (
              <form
                className='portal-th__cal-form'
                onSubmit={(ev) => {
                  ev.preventDefault();
                  void guardar();
                }}
                data-testid='evento-form'
              >
                <label>
                  Título del evento
                  <input
                    type='text'
                    value={nuevo.titulo}
                    maxLength={MAX_TITULO_EVENTO}
                    onChange={(ev) => setNuevo({ ...nuevo, titulo: ev.currentTarget.value })}
                    data-testid='evento-titulo'
                    autoFocus
                  />
                </label>
                <label>
                  Descripción (opcional)
                  <textarea
                    value={nuevo.descripcion}
                    rows={3}
                    maxLength={MAX_DESCRIPCION_EVENTO}
                    onChange={(ev) => setNuevo({ ...nuevo, descripcion: ev.currentTarget.value })}
                    data-testid='evento-descripcion'
                  />
                </label>
                <div className='portal-th__cal-acciones'>
                  <button type='button' className='portal-th__cal-boton' onClick={() => setNuevo(null)} disabled={guardando}>
                    Cancelar
                  </button>
                  <button type='submit' className='portal-th__cal-boton portal-th__cal-boton--primario' disabled={guardando} data-testid='evento-guardar'>
                    {guardando ? 'Guardando…' : 'Guardar evento'}
                  </button>
                </div>
              </form>
            ) : (
              <button
                type='button'
                className='portal-th__cal-boton portal-th__cal-boton--ancho'
                onClick={() => {
                  setAviso(null);
                  setNuevo({ titulo: '', descripcion: '' });
                }}
                data-testid='evento-agregar'
              >
                + Agregar evento
              </button>
            ))}
        </section>
      </div>
    </div>
  );
}
