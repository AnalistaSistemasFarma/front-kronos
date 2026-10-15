'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EMPRESA_POR_DEFECTO,
  MODELO,
  NOMBRE_FRANJAS,
  coincideBusqueda,
  normalizarEmpresa,
  textoDelNodo,
  type NodoOrganigrama,
  type PersonaOrganigrama,
} from '../../lib/portal/organigrama';

/**
 * ORGANIGRAMA de Farmalógica, digital e interactivo (Cristian Baldión, 2026-10-15).
 *
 * Dibuja el organigrama del PDF GTH-01-FR-005-5 (franjas, cuadros y conectores) como un gráfico vectorial con zoom y búsqueda.
 * Al pulsar un cargo se abre una ventana pequeña con las personas de BASE PERSONAL que lo tienen: empresa, nombre, área, cargo
 * y correo corporativo. Por defecto solo las de GSS (pedido de Cristian); hay un interruptor para incluir las de otras empresas.
 * Los avisos (error de carga) van arriba, con color. Mismo marco y estilo que las demás ventanas del portal.
 */

const ZOOM_INICIAL = 3;
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;

const unir = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

export default function OrganigramaVisor({ onCerrar }: { onCerrar: () => void }) {
  const [personas, setPersonas] = useState<Record<string, PersonaOrganigrama[]> | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(ZOOM_INICIAL);
  const [seleccionado, setSeleccionado] = useState<NodoOrganigrama | null>(null);
  const [otrasEmpresas, setOtrasEmpresas] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const contenedor = useRef<HTMLDivElement | null>(null);
  const arrastre = useRef<{ x: number; y: number; izq: number; arr: number } | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch('/api/portal/organigrama', { cache: 'no-store' });
      let data: Record<string, unknown> = {};
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        data = {};
      }
      if (!res.ok) throw new Error(String(data.error ?? 'No se pudieron cargar los datos de las personas.'));
      setPersonas((data.personas ?? {}) as Record<string, PersonaOrganigrama[]>);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Escape cierra primero la ventanita de personas y luego el organigrama; el fondo no se desplaza.
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (seleccionado) setSeleccionado(null);
      else onCerrar();
    };
    window.addEventListener('keydown', alTeclear);
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', alTeclear);
      document.body.style.overflow = previo;
    };
  }, [onCerrar, seleccionado]);

  const [vx, vy, vw, vh] = MODELO.vista;
  const textos = useMemo(() => new Map(MODELO.nodos.map((n) => [n.id, textoDelNodo(n)])), []);
  const coincidencias = useMemo(
    () => new Set(busqueda.trim() ? MODELO.nodos.filter((n) => coincideBusqueda(n, personas?.[n.id], busqueda)).map((n) => n.id) : []),
    [busqueda, personas]
  );

  // Buscar lleva la vista al primer cuadro que coincide.
  useEffect(() => {
    if (coincidencias.size === 0 || !contenedor.current) return;
    const primero = MODELO.nodos.filter((n) => coincidencias.has(n.id)).sort((a, b) => a.x - b.x)[0];
    const c = contenedor.current;
    const escala = c.scrollWidth / vw;
    c.scrollTo({ left: Math.max(0, (primero.x + primero.w / 2 - vx) * escala - c.clientWidth / 2), top: Math.max(0, (primero.y + primero.h / 2 - vy) * escala - c.clientHeight / 2), behavior: 'smooth' });
  }, [coincidencias, vw, vx, vy]);

  const cambiarZoom = (nuevo: number) => {
    const c = contenedor.current;
    const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nuevo));
    if (c) {
      // Conserva el punto que está en el centro de la ventana.
      const cx = (c.scrollLeft + c.clientWidth / 2) / c.scrollWidth;
      const cy = (c.scrollTop + c.clientHeight / 2) / c.scrollHeight;
      setZoom(z);
      window.requestAnimationFrame(() => {
        c.scrollLeft = cx * c.scrollWidth - c.clientWidth / 2;
        c.scrollTop = cy * c.scrollHeight - c.clientHeight / 2;
      });
    } else setZoom(z);
  };

  const gente = seleccionado ? (personas?.[seleccionado.id] ?? []) : [];
  const deLaEmpresa = gente.filter((p) => normalizarEmpresa(p.empresa) === normalizarEmpresa(EMPRESA_POR_DEFECTO));
  const deOtras = gente.length - deLaEmpresa.length;
  const visibles = otrasEmpresas ? gente : deLaEmpresa;

  const abrirNodo = (n: NodoOrganigrama) => {
    setOtrasEmpresas(false);
    setSeleccionado(n);
  };

  return (
    <div
      className='portal-th__visor portal-th__visor--organigrama'
      role='dialog'
      aria-modal='true'
      aria-label='Organigrama'
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div className='portal-th__visor-caja portal-th__visor-caja--organigrama' data-testid='organigrama-visor'>
        <header className='portal-th__visor-barra'>
          <strong>Organigrama Farmalógica S.A.</strong>
          <div className='portal-th__visor-acciones'>
            <button type='button' onClick={onCerrar} aria-label='Cerrar'>
              ✕
            </button>
          </div>
        </header>

        {/* Avisos ARRIBA y con color. */}
        {error && (
          <div className='portal-th__alerta portal-th__alerta--error' role='alert' data-testid='organigrama-error'>
            <span>{error}</span>
            <button type='button' onClick={() => void cargar()}>
              Reintentar
            </button>
          </div>
        )}

        <div className='portal-th__org-herramientas'>
          <input
            type='search'
            className='portal-th__buscador'
            placeholder='Buscar un cargo o una persona'
            aria-label='Buscar un cargo o una persona en el organigrama'
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            autoComplete='off'
            data-testid='organigrama-buscar'
          />
          <span className='portal-th__org-contador' aria-live='polite' data-testid='organigrama-coincidencias'>
            {busqueda.trim() ? (coincidencias.size === 0 ? 'Sin coincidencias' : `${coincidencias.size} ${coincidencias.size === 1 ? 'cargo' : 'cargos'}`) : ''}
          </span>
          <div className='portal-th__org-zoom' role='group' aria-label='Zoom'>
            <button type='button' onClick={() => cambiarZoom(zoom - 1)} disabled={zoom <= ZOOM_MIN} aria-label='Alejar' data-testid='zoom-menos'>
              −
            </button>
            <button type='button' onClick={() => cambiarZoom(ZOOM_MIN)} data-testid='zoom-ajustar'>
              Ver todo
            </button>
            <button type='button' onClick={() => cambiarZoom(zoom + 1)} disabled={zoom >= ZOOM_MAX} aria-label='Acercar' data-testid='zoom-mas'>
              +
            </button>
          </div>
        </div>

        <p className='portal-th__org-ayuda'>
          Pulse un cargo para ver quiénes lo ocupan. Arrastre para moverse; acerque con «+».{' '}
          <span className='portal-th__org-leyenda'>
            <i className='portal-th__org-muestra portal-th__org-muestra--con' aria-hidden='true' /> con personas de {EMPRESA_POR_DEFECTO}
          </span>
          <span className='portal-th__org-leyenda'>
            <i className='portal-th__org-muestra portal-th__org-muestra--otras' aria-hidden='true' /> solo de otras empresas
          </span>
        </p>

        <div
          ref={contenedor}
          className='portal-th__org-lienzo'
          data-testid='organigrama-lienzo'
          onPointerDown={(e) => {
            if ((e.target as Element).closest('[data-nodo]')) return;
            const c = contenedor.current;
            if (!c) return;
            arrastre.current = { x: e.clientX, y: e.clientY, izq: c.scrollLeft, arr: c.scrollTop };
            c.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const a = arrastre.current;
            const c = contenedor.current;
            if (!a || !c) return;
            c.scrollLeft = a.izq - (e.clientX - a.x);
            c.scrollTop = a.arr - (e.clientY - a.y);
          }}
          onPointerUp={() => {
            arrastre.current = null;
          }}
        >
          <svg
            viewBox={`${vx} ${vy} ${vw} ${vh}`}
            style={{ width: `${zoom * 100}%` }}
            role='group'
            aria-label='Organigrama de Farmalógica S.A.'
            data-testid='organigrama-svg'
          >
            {MODELO.bandas.map((b, i) => (
              <g key={i}>
                <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={b.fill} />
                <g transform={`translate(${vx + 20} ${b.y + b.h / 2})`}>
                  <rect x={0} y={-Math.min(b.h, 260) / 2} width={70} height={Math.min(b.h, 260)} fill={b.fill} stroke='#000' strokeWidth={1.2} vectorEffect='non-scaling-stroke' />
                  <text transform='rotate(-90)' textAnchor='middle' dominantBaseline='central' x={0} y={35} fontSize={28} fill='#000'>
                    {NOMBRE_FRANJAS[i] ?? ''}
                  </text>
                </g>
              </g>
            ))}
            {MODELO.conectores.map((c, i) => (
              <path key={i} d={c.d} fill='none' stroke='#000' strokeWidth={1.2} vectorEffect='non-scaling-stroke' />
            ))}
            {MODELO.nodos.map((n) => {
              const t = textos.get(n.id)!;
              const lista = personas?.[n.id] ?? [];
              const gentes = lista.filter((p) => normalizarEmpresa(p.empresa) === normalizarEmpresa(EMPRESA_POR_DEFECTO)).length;
              const deOtrasN = lista.length - gentes;
              const cx = n.x + n.w / 2;
              const cy = n.y + n.h / 2;
              const alto = t.lineas.length * t.tam * 1.2;
              return (
                <g
                  key={n.id}
                  data-nodo={n.id}
                  className={unir(
                    'portal-th__org-nodo',
                    gentes > 0 && 'portal-th__org-nodo--con',
                    gentes === 0 && deOtrasN > 0 && 'portal-th__org-nodo--otras',
                    seleccionado?.id === n.id && 'portal-th__org-nodo--activo',
                    coincidencias.has(n.id) && 'portal-th__org-nodo--busqueda'
                  )}
                  role='button'
                  tabIndex={0}
                  aria-label={`${n.texto}${personas ? (gentes > 0 ? `, ${gentes} ${gentes === 1 ? 'persona' : 'personas'} de ${EMPRESA_POR_DEFECTO}` : deOtrasN > 0 ? ', solo personas de otras empresas' : ', sin personas registradas') : ''}`}
                  onClick={() => abrirNodo(n)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      abrirNodo(n);
                    }
                  }}
                >
                  <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={Math.min(18, n.w / 3, n.h / 3)} />
                  <text
                    textAnchor='middle'
                    fontSize={t.tam}
                    transform={n.v ? `rotate(-90 ${cx} ${cy})` : undefined}
                    className='portal-th__org-texto'
                  >
                    {t.lineas.map((l, i) => (
                      <tspan key={i} x={cx} y={cy - alto / 2 + t.tam * 1.2 * (i + 0.5) + t.tam * 0.35}>
                        {l}
                      </tspan>
                    ))}
                  </text>
                </g>
              );
            })}
          </svg>
          {cargando && <p className='portal-th__estado portal-th__org-cargando'>Cargando las personas de cada cargo…</p>}
        </div>

        {/* Ventana pequeña con las personas del cargo elegido. */}
        {seleccionado && (
          <div className='portal-th__org-ventana' role='dialog' aria-label={`Personas con el cargo ${seleccionado.texto}`} data-testid='organigrama-personas'>
            <header>
              <div>
                <strong>{seleccionado.texto}</strong>
                <small>
                  {visibles.length} {visibles.length === 1 ? 'persona' : 'personas'}
                </small>
              </div>
              <button type='button' onClick={() => setSeleccionado(null)} aria-label='Cerrar la ventana de personas' data-testid='organigrama-personas-cerrar'>
                ✕
              </button>
            </header>
            <div className='portal-th__org-ventana-cuerpo'>
              {!personas && !error && <p className='portal-th__estado'>Cargando…</p>}
              {personas && visibles.length === 0 && (
                <p className='portal-th__estado' data-testid='organigrama-sin-personas'>
                  {gente.length === 0
                    ? 'No hay personas registradas con este cargo en BASE PERSONAL.'
                    : `No hay personas de ${EMPRESA_POR_DEFECTO} con este cargo.`}
                </p>
              )}
              <ul>
                {visibles.map((p, i) => (
                  <li key={`${p.nombre}-${i}`} data-testid='organigrama-persona'>
                    <dl>
                      <dt>Empresa</dt>
                      <dd>{p.empresa || '—'}</dd>
                      <dt>Apellidos y Nombres</dt>
                      <dd>
                        <strong>{p.nombre}</strong>
                      </dd>
                      <dt>Área / Dependencia</dt>
                      <dd>{p.area || '—'}</dd>
                      <dt>Cargo</dt>
                      <dd>{p.cargo}</dd>
                      <dt>Correo corporativo</dt>
                      <dd>{p.correo.includes('@') ? <a href={`mailto:${p.correo}`}>{p.correo}</a> : p.correo || '—'}</dd>
                    </dl>
                  </li>
                ))}
              </ul>
            </div>
            {deOtras > 0 && (
              <label className='portal-th__org-otras'>
                <input type='checkbox' checked={otrasEmpresas} onChange={(e) => setOtrasEmpresas(e.target.checked)} data-testid='organigrama-otras' />
                Incluir {deOtras} {deOtras === 1 ? 'persona' : 'personas'} de otras empresas con este cargo
              </label>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
