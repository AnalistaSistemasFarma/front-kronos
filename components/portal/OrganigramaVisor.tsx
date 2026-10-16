'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ALTO_CUADRO,
  EMPRESA_POR_DEFECTO,
  coincideBusqueda,
  disenarOrganigrama,
  nombreLegible,
  normalizarEmpresa,
  textoDelNodo,
  type NodoCargo,
  type PersonaOrganigrama,
} from '../../lib/portal/organigrama';

/**
 * ORGANIGRAMA de GSS, digital e interactivo (Cristian Baldión, 2026-10-15).
 *
 * El árbol se LEE de SynerLink (módulo Organigrama) y se dibuja aquí como un gráfico vectorial con zoom y búsqueda. Al pulsar un
 * cargo se abre una ventana pequeña con las personas de BASE PERSONAL que lo tienen: empresa, nombre, área, cargo y correo corporativo.
 * Por defecto solo las de GSS; un interruptor permite incluir las de otras empresas. Color del cuadro = nivel (estratégico, táctico,
 * operativo). Los avisos van arriba, con color. Mismo marco y estilo que las demás ventanas del portal.
 */

const ZOOM_INICIAL = 4;
const ZOOM_MIN = 1;
const ZOOM_MAX = 10;
const unir = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');
const CLASE_NIVEL: Record<string, string> = { 'Estratégico': 'estrategico', Estrategico: 'estrategico', 'Táctico': 'tactico', Tactico: 'tactico', Operativo: 'operativo' };

export default function OrganigramaVisor({ onCerrar }: { onCerrar: () => void }) {
  const [nodos, setNodos] = useState<NodoCargo[] | null>(null);
  const [personas, setPersonas] = useState<Record<string, PersonaOrganigrama[]>>({});
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [avisoPersonas, setAvisoPersonas] = useState<string | null>(null);
  const [zoom, setZoom] = useState(ZOOM_INICIAL);
  const [seleccionado, setSeleccionado] = useState<NodoCargo | null>(null);
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
      if (!res.ok) throw new Error(String(data.error ?? 'No se pudo cargar el organigrama.'));
      setNodos(Array.isArray(data.nodos) ? (data.nodos as NodoCargo[]) : []);
      setPersonas((data.personas ?? {}) as Record<string, PersonaOrganigrama[]>);
      setAvisoPersonas(typeof data.avisoPersonas === 'string' ? data.avisoPersonas : null);
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

  const diseno = useMemo(() => (nodos && nodos.length > 0 ? disenarOrganigrama(nodos) : null), [nodos]);
  const nodoPorId = useMemo(() => new Map((nodos ?? []).map((n) => [n.id, n])), [nodos]);
  const coincidencias = useMemo(
    () => new Set(busqueda.trim() && nodos ? nodos.filter((n) => coincideBusqueda(n, personas[n.id], busqueda)).map((n) => n.id) : []),
    [busqueda, personas, nodos]
  );

  // Al abrir, la vista queda centrada en la cima (el Director General), no en el borde izquierdo de un dibujo muy ancho.
  const centrado = useRef(false);
  useEffect(() => {
    if (!diseno || centrado.current || !contenedor.current) return;
    centrado.current = true;
    const raiz = nodos?.find((n) => n.padre === null);
    const cuadro = diseno.cuadros.find((c) => c.id === raiz?.id);
    const c = contenedor.current;
    if (!cuadro) return;
    window.requestAnimationFrame(() => {
      const escala = c.scrollWidth / diseno.vista[2];
      c.scrollLeft = Math.max(0, (cuadro.x + cuadro.w / 2 - diseno.vista[0]) * escala - c.clientWidth / 2);
    });
  }, [diseno, nodos]);

  // Buscar lleva la vista al primer cuadro que coincide.
  useEffect(() => {
    if (coincidencias.size === 0 || !contenedor.current || !diseno) return;
    const cuadro = diseno.cuadros.filter((c) => coincidencias.has(c.id)).sort((a, b) => a.x - b.x)[0];
    if (!cuadro) return;
    const c = contenedor.current;
    const escala = c.scrollWidth / diseno.vista[2];
    c.scrollTo({ left: Math.max(0, (cuadro.x + cuadro.w / 2 - diseno.vista[0]) * escala - c.clientWidth / 2), top: Math.max(0, (cuadro.y + cuadro.h / 2 - diseno.vista[1]) * escala - c.clientHeight / 3), behavior: 'smooth' });
  }, [coincidencias, diseno]);

  const cambiarZoom = (nuevo: number) => {
    const c = contenedor.current;
    const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nuevo));
    if (c) {
      const cx = (c.scrollLeft + c.clientWidth / 2) / c.scrollWidth;
      const cy = (c.scrollTop + c.clientHeight / 2) / c.scrollHeight;
      setZoom(z);
      window.requestAnimationFrame(() => {
        c.scrollLeft = cx * c.scrollWidth - c.clientWidth / 2;
        c.scrollTop = cy * c.scrollHeight - c.clientHeight / 2;
      });
    } else setZoom(z);
  };

  const gente = seleccionado ? (personas[seleccionado.id] ?? []) : [];
  const deLaEmpresa = gente.filter((p) => normalizarEmpresa(p.empresa).includes(normalizarEmpresa(EMPRESA_POR_DEFECTO)));
  const deOtras = gente.length - deLaEmpresa.length;
  const visibles = otrasEmpresas ? gente : deLaEmpresa;
  const abrirNodo = (n: NodoCargo) => {
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
          <strong>Organigrama {EMPRESA_POR_DEFECTO}</strong>
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
        {avisoPersonas && (
          <div className='portal-th__alerta portal-th__alerta--error' role='alert' data-testid='organigrama-aviso-personas'>
            <span>{avisoPersonas}</span>
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
          {diseno && (
            <svg viewBox={diseno.vista.join(' ')} style={{ width: `${zoom * 100}%` }} role='group' aria-label={`Organigrama de ${EMPRESA_POR_DEFECTO}`} data-testid='organigrama-svg'>
              {diseno.caminos.map((d, i) => (
                <path key={i} d={d} fill='none' stroke='#374151' strokeWidth={1.4} vectorEffect='non-scaling-stroke' />
              ))}
              {diseno.cuadros.map((c) => {
                const n = nodoPorId.get(c.id);
                if (!n) return null;
                const t = textoDelNodo(n.nombre, c);
                const lista = personas[n.id] ?? [];
                const gentes = lista.filter((p) => normalizarEmpresa(p.empresa).includes(normalizarEmpresa(EMPRESA_POR_DEFECTO))).length;
                const deOtrasN = lista.length - gentes;
                const cx = c.x + c.w / 2;
                const cy = c.y + c.h / 2;
                const alto = t.lineas.length * t.tam * 1.2;
                const nivel = n.nivel ? CLASE_NIVEL[n.nivel] : undefined;
                return (
                  <g
                    key={c.id}
                    data-nodo={c.id}
                    className={unir(
                      'portal-th__org-nodo',
                      nivel && `portal-th__org-nodo--${nivel}`,
                      gentes > 0 && 'portal-th__org-nodo--con',
                      gentes === 0 && deOtrasN > 0 && 'portal-th__org-nodo--otras',
                      seleccionado?.id === c.id && 'portal-th__org-nodo--activo',
                      coincidencias.has(c.id) && 'portal-th__org-nodo--busqueda'
                    )}
                    role='button'
                    tabIndex={0}
                    aria-label={`${nombreLegible(n.nombre)}${gentes > 0 ? `, ${gentes} ${gentes === 1 ? 'persona' : 'personas'} de ${EMPRESA_POR_DEFECTO}` : deOtrasN > 0 ? ', solo personas de otras empresas' : ', sin personas registradas'}`}
                    onClick={() => abrirNodo(n)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        abrirNodo(n);
                      }
                    }}
                  >
                    <rect x={c.x} y={c.y} width={c.w} height={ALTO_CUADRO} rx={14} />
                    <text textAnchor='middle' fontSize={t.tam} className='portal-th__org-texto'>
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
          )}
          {cargando && <p className='portal-th__estado portal-th__org-cargando'>Cargando el organigrama…</p>}
          {!cargando && !error && nodos && nodos.length === 0 && (
            <p className='portal-th__estado' data-testid='organigrama-vacio'>
              El organigrama de {EMPRESA_POR_DEFECTO} todavía no está cargado.
            </p>
          )}
        </div>

        {/* Ventana pequeña con las personas del cargo elegido. */}
        {seleccionado && (
          <div className='portal-th__org-ventana' role='dialog' aria-label={`Personas con el cargo ${nombreLegible(seleccionado.nombre)}`} data-testid='organigrama-personas'>
            <header>
              <div>
                <strong>{nombreLegible(seleccionado.nombre)}</strong>
                <small>
                  {visibles.length} {visibles.length === 1 ? 'persona' : 'personas'}
                </small>
              </div>
              <button type='button' onClick={() => setSeleccionado(null)} aria-label='Cerrar la ventana de personas' data-testid='organigrama-personas-cerrar'>
                ✕
              </button>
            </header>
            <div className='portal-th__org-ventana-cuerpo'>
              {visibles.length === 0 && (
                <p className='portal-th__estado' data-testid='organigrama-sin-personas'>
                  {gente.length === 0 ? 'No hay personas registradas con este cargo en BASE PERSONAL.' : `No hay personas de ${EMPRESA_POR_DEFECTO} con este cargo.`}
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
