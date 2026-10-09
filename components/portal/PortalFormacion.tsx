'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@mantine/core';
import { IconTable } from '@tabler/icons-react';
import { leerJson } from './PortalContenido';
import {
  SubidaCancelada,
  formatearBytes,
  subirMaterialDirecto,
  type ArchivoSubidoAlCurso,
} from '../../lib/portal/subida-por-trozos';
import {
  contadorVideo,
  posicionPermitida,
  progresoLectura,
  reloj,
  segundosQueSuman,
  videoCompleto,
} from '../../lib/portal/visor-revision';
import { PanelRespuestas, PreviaDeMaterialFormulario, SelectorFormulario, VisorFormulario } from './FormularioPropio';

/**
 * FORMACIÓN — sección "tipo Moodle" al final del portal de Talento Humano.
 *
 * Pedido de Cristian Baldión (2026-09-18): cursos con materiales (documento o
 * enlace), una barra de progreso que ve el formador Y el estudiante, y un
 * certificado de GSS al llegar al 100%.
 *
 * Vive en un componente aparte de `PortalContenido` (que ya es grande) y
 * hace sus propios fetch: así una recarga de materiales o de progreso no
 * repinta el carrusel de anuncios ni las políticas.
 */

interface CursoResumen {
  id: number;
  titulo: string;
  descripcion: string | null;
  activo: boolean;
  totalMateriales: number;
  totalInscritos: number;
  inscrito: boolean;
  porcentaje: number | null;
  certificado: { code: string; emitidoEl: string } | null;
}

interface Material {
  id: number;
  /** FORM = formulario propio del portal (Cristian, 2026-10-08). */
  tipo: 'DOCUMENT' | 'LINK' | 'FORM';
  formularioId?: number | null;
  titulo: string;
  orden: number;
  url: string | null;
  nombreArchivo: string | null;
  mime?: string | null;
  obligatorio: boolean;
  completadoEl: string | null;
}

interface DetalleCurso {
  curso: { id: number; titulo: string; descripcion: string | null; activo: boolean; creadoPor: string };
  esFormador: boolean;
  /** Administrador/formador del Excel de permisos: puede marcar a mano. */
  puedeMarcarManual?: boolean;
  porcentaje: number;
  materiales: Material[];
  certificado: { code: string; emitidoEl: string } | null;
}

interface FilaRoster {
  correo: string;
  nombre: string;
  inscritoEl: string;
  porcentaje: number;
  materialesCompletados: number[];
  certificado: string | null;
}

const materialUrl = (cursoId: number, materialId: number) =>
  `/api/portal/courses/${cursoId}/materials/${materialId}/file`;
const certificadoUrl = (code: string) => `/api/portal/certificates/${encodeURIComponent(code)}`;

/**
 * `onSinSesion`: se llama si el servidor responde 401 al pedir los cursos,
 * para que la página de Formación (que vive aparte del portal desde
 * 2026-09-30) pueda mandar a la persona a ingresar primero.
 */
export default function PortalFormacion({ onSinSesion }: { onSinSesion?: () => void } = {}) {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursos, setCursos] = useState<CursoResumen[]>([]);
  const [esFormador, setEsFormador] = useState(false);
  const [vista, setVista] = useState<'estudiante' | 'formador'>('estudiante');
  // En una ref: si se pasa como función en línea, no debe re-disparar la carga.
  const onSinSesionRef = useRef(onSinSesion);
  onSinSesionRef.current = onSinSesion;

  const cargarCursos = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/portal/courses', { cache: 'no-store' });
      if (res.status === 401 && onSinSesionRef.current) {
        onSinSesionRef.current();
        return;
      }
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudieron cargar los cursos.'));
      setCursos(Array.isArray(data.cursos) ? (data.cursos as CursoResumen[]) : []);
      setEsFormador(data.esFormador === true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargarCursos();
  }, [cargarCursos]);

  const [cursoAbiertoId, setCursoAbiertoId] = useState<number | null>(null);
  const [cursoGestionId, setCursoGestionId] = useState<number | null>(null);

  if (cargando) return <p className='portal-th__estado'>Cargando formación…</p>;

  return (
    <div className='portal-th__formacion'>
      <div className='portal-th__formacion-barra'>
        {esFormador && (
          <div className='portal-th__formacion-toggle' role='tablist' aria-label='Vista de Formación'>
            <button
              type='button'
              className={vista === 'estudiante' ? 'portal-th__formacion-toggle-activo' : ''}
              onClick={() => setVista('estudiante')}
            >
              Vista estudiante
            </button>
            <button
              type='button'
              className={vista === 'formador' ? 'portal-th__formacion-toggle-activo' : ''}
              onClick={() => setVista('formador')}
            >
              Vista formador
            </button>
          </div>
        )}
      </div>

      {error && <p className='portal-th__error'>{error}</p>}

      {vista === 'estudiante' || !esFormador ? (
        cursoAbiertoId ? (
          <VistaCursoEstudiante cursoId={cursoAbiertoId} onVolver={() => setCursoAbiertoId(null)} onCambio={cargarCursos} />
        ) : (
          <ListaCursosEstudiante cursos={cursos.filter((c) => c.activo)} onAbrir={setCursoAbiertoId} />
        )
      ) : cursoGestionId ? (
        <VistaCursoFormador cursoId={cursoGestionId} onVolver={() => setCursoGestionId(null)} onCambio={cargarCursos} />
      ) : (
        <ListaCursosFormador cursos={cursos} onGestionar={setCursoGestionId} onCreado={cargarCursos} />
      )}
    </div>
  );
}

/* ─────────────────────────────── Estudiante ────────────────────────────── */

function BarraProgreso({ porcentaje, mostrarCompletado = false }: { porcentaje: number; mostrarCompletado?: boolean }) {
  const barra = (
    <div className='portal-th__curso-progreso' role='progressbar' aria-valuenow={porcentaje} aria-valuemin={0} aria-valuemax={100}>
      <div className='portal-th__curso-progreso-barra' style={{ width: `${Math.min(100, Math.max(0, porcentaje))}%` }} />
      <span>{porcentaje}%</span>
    </div>
  );
  if (!mostrarCompletado) return barra;
  // Cristian (2026-10-08): al quedar completo, "Completado" a la derecha de la barra.
  return (
    <div className='portal-th__progreso-fila'>
      {barra}
      {porcentaje >= 100 && <InsigniaCompletado />}
    </div>
  );
}

function InsigniaCompletado() {
  return (
    <span className='portal-th__completado' data-testid='insignia-completado'>
      ✓ Completado
    </span>
  );
}

/** Tooltip de la casilla bloqueada (pedido de Cristian, 2026-10-08). */
const AYUDA_CASILLA_BLOQUEADA = 'Se marca automáticamente al revisar el material';

/** Avance de una subida directa a SharePoint, con botón para cancelar. */
interface EstadoSubida {
  nombre: string;
  subidos: number;
  total: number;
}

function ProgresoSubida({ subida, onCancelar }: { subida: EstadoSubida; onCancelar: () => void }) {
  const porcentaje = subida.total > 0 ? Math.floor((subida.subidos / subida.total) * 100) : 0;
  return (
    <div className='portal-th__subida' role='status' aria-live='polite' data-testid='progreso-subida'>
      <div className='portal-th__subida-texto'>
        <strong>Subiendo a SharePoint:</strong> {subida.nombre}
        <span>
          {formatearBytes(subida.subidos)} de {formatearBytes(subida.total)} ({porcentaje}%)
        </span>
      </div>
      <BarraProgreso porcentaje={porcentaje} />
      <button type='button' className='portal-th__boton-secundario' onClick={onCancelar}>
        Cancelar subida
      </button>
    </div>
  );
}

function ListaCursosEstudiante({ cursos, onAbrir }: { cursos: CursoResumen[]; onAbrir: (id: number) => void }) {
  if (cursos.length === 0) {
    return <p className='portal-th__estado'>Todavía no hay cursos publicados.</p>;
  }
  return (
    <div className='portal-th__curso-grilla'>
      {cursos.map((c) => (
        <button type='button' key={c.id} className='portal-th__curso-tarjeta' onClick={() => onAbrir(c.id)}>
          <strong>{c.titulo}</strong>
          {c.descripcion && <p>{c.descripcion}</p>}
          <span className='portal-th__curso-meta'>{c.totalMateriales} material(es)</span>
          <BarraProgreso porcentaje={c.porcentaje ?? 0} mostrarCompletado />
          {c.certificado && <span className='portal-th__curso-certificado-chip'>✅ Certificado emitido</span>}
        </button>
      ))}
    </div>
  );
}

function VistaCursoEstudiante({
  cursoId,
  onVolver,
  onCambio,
}: {
  cursoId: number;
  onVolver: () => void;
  onCambio: () => void;
}) {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Resultado de una ACCIÓN (marcar, revisar): arriba y con color, sin
  // desmontar la vista (ver la convención de avisos visibles).
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [detalle, setDetalle] = useState<DetalleCurso | null>(null);
  const [marcando, setMarcando] = useState<number | null>(null);
  const [abierto, setAbierto] = useState<Material | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/portal/courses/${cursoId}`, { cache: 'no-store' });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo cargar el curso.'));
      setDetalle(data as unknown as DetalleCurso);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, [cursoId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const puedeMarcar = detalle?.puedeMarcarManual === true;

  /** Marcado MANUAL: solo administradores/formadores (el servidor lo exige). */
  const alternarMaterial = async (materialId: number, completado: boolean) => {
    if (!puedeMarcar) return;
    setMarcando(materialId);
    setAviso(null);
    try {
      const res = await fetch(`/api/portal/materials/${materialId}/progress`, {
        method: completado ? 'DELETE' : 'POST',
      });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo actualizar.'));
      await cargar();
      await onCambio();
    } catch (e) {
      setAviso({ tipo: 'error', texto: (e as Error).message });
    } finally {
      setMarcando(null);
    }
  };

  const alCompletar = async (titulo: string, texto?: string) => {
    setAviso({ tipo: 'ok', texto: texto ?? `"${titulo}" quedó completado.` });
    await cargar();
    await onCambio();
  };
  // Respuestas de un formulario (solo administradores/formadores del Excel).

  /** Un ENLACE cuenta como revisado al abrirlo (lo registra el servidor). */
  const abrirEnlace = (m: Material) => {
    void fetch(`/api/portal/materials/${m.id}/vista`, { method: 'POST', keepalive: true })
      .then(async (res) => {
        const data = await leerJson(res);
        if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo registrar la apertura del enlace.'));
        if (m.completadoEl === null) await alCompletar(m.titulo);
      })
      .catch((e) => setAviso({ tipo: 'error', texto: (e as Error).message }));
  };

  if (cargando) return <p className='portal-th__estado'>Cargando curso…</p>;
  if (error) return <p className='portal-th__error'>{error}</p>;
  if (!detalle) return null;

  return (
    <div className='portal-th__curso-detalle'>
      <button type='button' className='portal-th__volver' onClick={onVolver}>
        ← Volver a Formación
      </button>
      <h3>{detalle.curso.titulo}</h3>
      {detalle.curso.descripcion && <p className='portal-th__curso-descripcion'>{detalle.curso.descripcion}</p>}
      {aviso && (
        <p className={`portal-th__resultado portal-th__resultado--${aviso.tipo}`} role={aviso.tipo === 'error' ? 'alert' : 'status'}>
          {aviso.texto}
        </p>
      )}
      <BarraProgreso porcentaje={detalle.porcentaje} mostrarCompletado />

      <ul className='portal-th__material-lista'>
        {detalle.materiales.map((m) => {
          const completado = m.completadoEl !== null;
          return (
            <li key={m.id} className='portal-th__material-item'>
              {puedeMarcar ? (
                <button
                  type='button'
                  className={`portal-th__material-check${completado ? ' portal-th__material-check--hecho' : ''}`}
                  disabled={marcando === m.id}
                  onClick={() => void alternarMaterial(m.id, completado)}
                  aria-label={completado ? `Marcar ${m.titulo} como pendiente` : `Marcar ${m.titulo} como completado`}
                  title='Puede marcar o desmarcar a mano (administrador/formador)'
                >
                  {completado ? '✓' : ''}
                </button>
              ) : (
                <span
                  role='checkbox'
                  aria-checked={completado}
                  aria-disabled='true'
                  aria-label={`${m.titulo}: ${AYUDA_CASILLA_BLOQUEADA.toLowerCase()}`}
                  title={AYUDA_CASILLA_BLOQUEADA}
                  className={`portal-th__material-check portal-th__material-check--bloqueada${completado ? ' portal-th__material-check--hecho' : ''}`}
                >
                  {completado ? '✓' : ''}
                </span>
              )}
              <div className='portal-th__material-info'>
                {m.tipo === 'LINK' ? (
                  <a href={m.url ?? '#'} target='_blank' rel='noopener noreferrer' onClick={() => abrirEnlace(m)}>
                    {m.titulo}
                  </a>
                ) : m.tipo === 'FORM' ? (
                  <button
                    type='button'
                    className='portal-th__material-abrir'
                    onClick={() => setAbierto(m)}
                    data-testid={`abrir-formulario-${m.id}`}
                  >
                    {m.titulo}
                  </button>
                ) : (
                  <button type='button' className='portal-th__material-abrir' onClick={() => setAbierto(m)}>
                    {m.titulo}
                  </button>
                )}
                <span className='portal-th__material-tipo'>
                  {etiquetaTipo(m)}
                  {!m.obligatorio && ' · opcional'}
                </span>
              </div>
              {/* Las respuestas de un formulario NO se ven aquí: solo en la «Vista formador» (Cristian, 2026-10-09). */}
              {completado && <InsigniaCompletado />}
            </li>
          );
        })}
      </ul>
      {!puedeMarcar && detalle.materiales.length > 0 && (
        <p className='portal-th__estado'>
          Las casillas se marcan automáticamente cuando revisa cada material: los videos hasta el final, los PDF hasta la
          última página, los formularios al enviarlos y los demás documentos y enlaces al abrirlos.
        </p>
      )}

      {detalle.certificado ? (
        <a
          className='portal-th__certificado-boton'
          href={certificadoUrl(detalle.certificado.code)}
          target='_blank'
          rel='noopener noreferrer'
        >
          🎓 Descargar certificado
        </a>
      ) : (
        detalle.porcentaje < 100 && (
          <p className='portal-th__estado'>
            Complete los materiales obligatorios para obtener su certificado de finalización.
          </p>
        )
      )}

      {abierto && abierto.tipo === 'FORM' && (
        <VisorFormulario
          materialId={abierto.id}
          titulo={abierto.titulo}
          onCerrar={() => setAbierto(null)}
          onEnviado={() => alCompletar(abierto.titulo, `Respuestas enviadas: "${abierto.titulo}" quedó completado.`)}
        />
      )}
      {abierto && abierto.tipo !== 'FORM' && (
        <VisorMaterial
          cursoId={detalle.curso.id}
          material={abierto}
          onCerrar={() => setAbierto(null)}
          onCompletado={() => alCompletar(abierto.titulo)}
        />
      )}
    </div>
  );
}

function etiquetaTipo(m: Material): string {
  if (m.tipo === 'LINK') return 'Enlace';
  if (m.tipo === 'FORM') return 'Formulario';
  const mime = (m.mime ?? '').toLowerCase();
  if (mime.startsWith('video/')) return 'Video';
  return 'Documento';
}

/* ─────────────── Visor del material + revisión (2026-10-08) ─────────────── */

interface ReglaRevision {
  tipo: 'video' | 'pdf' | 'imagen' | 'documento' | 'enlace';
  segundosMinimos: number;
  fraccionVideo: number;
  paginas?: number | null;
}

/**
 * Abre un material DENTRO del portal, en la ventana de vista previa, y mide la
 * revisión (Cristian, 2026-10-08). El servidor registra la apertura; aquí se
 * mide lo que se ve y, al cumplir la regla, se reporta. Es el servidor quien
 * marca.
 *
 * - Video: sin la barra nativa (no hay cómo saltar), velocidad fija en 1× y
 *   un contador "visto / duración" que solo corre mientras el video se
 *   reproduce de verdad (no en pausa, no con la pestaña oculta: al ocultarla
 *   se pausa). Se puede retroceder 10 s, no adelantar. Se marca al llegar al
 *   100 %.
 * - PDF: una página a la vez con "Página anterior" / "Página siguiente" y una
 *   barra de lectura (página máxima alcanzada entre el total). Se marca al
 *   llegar a la última página; el de una sola página, al abrirlo.
 * - Imagen y Word/Excel/PowerPoint: sin tiempo mínimo, el servidor los marca
 *   al registrar la apertura y la persona cierra cuando quiera.
 */
function VisorMaterial({
  cursoId,
  material,
  onCerrar,
  onCompletado,
}: {
  cursoId: number;
  material: Material;
  onCerrar: () => void;
  onCompletado: () => Promise<void> | void;
}) {
  const url = materialUrl(cursoId, material.id);
  const [regla, setRegla] = useState<ReglaRevision | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [completado, setCompletado] = useState(material.completadoEl !== null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [segundos, setSegundos] = useState(0);
  const [duracion, setDuracion] = useState(0);
  const [reproduciendo, setReproduciendo] = useState(false);
  const [pdf, setPdf] = useState<{ pagina: number; maxima: number; total: number }>({ pagina: 1, maxima: 1, total: 0 });
  const reportado = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const video = useRef({ maximo: 0, acumulado: 0, ultimo: 0 });

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const res = await fetch(`/api/portal/materials/${material.id}/vista`, { method: 'POST' });
        const data = await leerJson(res);
        if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo abrir el material.'));
        if (!vivo) return;
        setToken(String(data.token));
        setRegla(data.regla as unknown as ReglaRevision);
        if (data.completado === true) {
          setCompletado(true);
          // Quedó marcado al abrirlo (imagen, Office, PDF de una página).
          if (material.completadoEl === null) await onCompletado();
        }
      } catch (e) {
        if (vivo) setError((e as Error).message);
      }
    })();
    return () => {
      vivo = false;
    };
    // Solo al abrir; `onCompletado` y `completadoEl` no deben reabrir la vista.
  }, [material.id]);

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [onCerrar]);

  const reportar = useCallback(
    async (cuerpo: { segundosVistos: number; duracion?: number; paginaMaxima?: number; paginasTotales?: number }) => {
      if (!token || reportado.current) return;
      reportado.current = true;
      try {
        const res = await fetch(`/api/portal/materials/${material.id}/vista/${token}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ duracion: null, ...cuerpo }),
        });
        const data = await leerJson(res);
        if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo registrar la revisión.'));
        setCompletado(true);
        setAviso(null);
        await onCompletado();
      } catch (e) {
        // Se puede volver a intentar con la misma apertura.
        reportado.current = false;
        setAviso((e as Error).message);
      }
    },
    [material.id, token, onCompletado]
  );

  // Imagen y Office con un mínimo configurado por entorno (por defecto no hay):
  // cuenta el tiempo con la ventana abierta.
  const conTiempo =
    regla !== null && (regla.tipo === 'imagen' || regla.tipo === 'documento') && regla.segundosMinimos > 0;
  useEffect(() => {
    if (!conTiempo || completado) return;
    const reloj = window.setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => window.clearInterval(reloj);
  }, [conTiempo, completado]);
  useEffect(() => {
    if (conTiempo && !completado && regla && segundos >= regla.segundosMinimos) void reportar({ segundosVistos: segundos });
  }, [conTiempo, completado, regla, segundos, reportar]);

  // Video: con la pestaña oculta se pausa (el contador tampoco corre).
  useEffect(() => {
    const alCambiarVisibilidad = () => {
      if (document.visibilityState !== 'visible') videoRef.current?.pause();
    };
    document.addEventListener('visibilitychange', alCambiarVisibilidad);
    return () => document.removeEventListener('visibilitychange', alCambiarVisibilidad);
  }, []);

  const alAvanzarVideo = (v: HTMLVideoElement) => {
    const estado = video.current;
    estado.acumulado += segundosQueSuman(v.currentTime - estado.ultimo, {
      velocidad: v.playbackRate,
      visible: document.visibilityState === 'visible',
      pausado: v.paused && !v.ended,
    });
    if (v.currentTime > estado.maximo && v.currentTime <= estado.maximo + 1.5) estado.maximo = v.currentTime;
    estado.ultimo = v.currentTime;
    const vistos = Math.min(estado.acumulado, Math.max(estado.maximo, v.ended ? v.duration : 0));
    setSegundos(vistos);
    if (regla && !completado && videoCompleto(vistos, v.duration, regla.fraccionVideo)) {
      void reportar({ segundosVistos: vistos, duracion: v.duration });
    }
  };
  const alBuscarVideo = (v: HTMLVideoElement) => {
    // No se puede saltar hacia adelante de lo ya visto (sí volver atrás).
    const permitida = posicionPermitida(v.currentTime, video.current.maximo);
    if (permitida !== v.currentTime) v.currentTime = permitida;
    video.current.ultimo = v.currentTime;
  };
  const alternarVideo = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  };
  const retrocederVideo = () => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, v.currentTime - 10);
  };

  // PDF: avanza solo con el botón; al llegar a la última página se reporta.
  const alCargarPdf = useCallback((total: number) => setPdf({ pagina: 1, maxima: 1, total }), []);
  const irAPagina = (pagina: number) => {
    setPdf((p) => {
      const siguiente = Math.max(1, Math.min(p.total, pagina));
      return { ...p, pagina: siguiente, maxima: Math.max(p.maxima, siguiente) };
    });
  };
  useEffect(() => {
    if (regla?.tipo !== 'pdf' || completado || pdf.total < 1) return;
    if (pdf.maxima >= pdf.total) {
      void reportar({ segundosVistos: 0, paginaMaxima: pdf.maxima, paginasTotales: pdf.total });
    }
  }, [regla, completado, pdf, reportar]);

  const mime = (material.mime ?? '').toLowerCase();
  const tipo = regla?.tipo ?? (mime.startsWith('video/') ? 'video' : null);
  const lectura = progresoLectura(pdf.maxima, pdf.total);

  let estadoTexto = 'Preparando…';
  if (completado) estadoTexto = '✓ Completado';
  else if (regla?.tipo === 'video') {
    estadoTexto = 'Vea el video completo: se marca cuando el contador llega a la duración.';
  } else if (regla?.tipo === 'pdf') {
    estadoTexto = pdf.total > 1 ? `Avance con "Página siguiente" hasta la última página · ${lectura} % leído` : 'Cargando documento…';
  } else if (conTiempo && regla) {
    estadoTexto = `Revisando… ${reloj(Math.min(segundos, regla.segundosMinimos))} de ${reloj(regla.segundosMinimos)}`;
  }

  return (
    <div
      className='portal-th__visor'
      role='dialog'
      aria-modal='true'
      aria-label={material.titulo}
      data-testid='visor-material'
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div className='portal-th__visor-caja'>
        <header className='portal-th__visor-barra'>
          <strong>{material.titulo}</strong>
          <div className='portal-th__visor-acciones'>
            {/* Video y PDF se revisan aquí; abrirlos aparte saltaría el control. */}
            {tipo !== 'video' && tipo !== 'pdf' && (
              <a href={url} target='_blank' rel='noopener noreferrer'>
                Abrir aparte
              </a>
            )}
            <button type='button' onClick={onCerrar} aria-label='Cerrar'>
              ✕
            </button>
          </div>
        </header>
        <div
          className={`portal-th__visor-revision${completado ? ' portal-th__visor-revision--hecho' : ''}`}
          role='status'
          data-testid='estado-revision'
        >
          {estadoTexto}
        </div>
        {error && (
          <p className='portal-th__resultado portal-th__resultado--error' role='alert'>
            {error}
          </p>
        )}
        {aviso && (
          <p className='portal-th__resultado portal-th__resultado--advertencia' role='alert'>
            {aviso}
          </p>
        )}
        {tipo === 'video' ? (
          <>
            {/* Sin `controls`: la barra nativa permite saltar. */}
            <video
              ref={videoRef}
              className='portal-th__visor-video'
              src={url}
              disablePictureInPicture
              playsInline
              preload='metadata'
              data-testid='video-material'
              onClick={alternarVideo}
              onContextMenu={(e) => e.preventDefault()}
              onLoadedMetadata={(e) => setDuracion(e.currentTarget.duration || 0)}
              onPlay={() => {
                video.current.ultimo = videoRef.current?.currentTime ?? 0;
                setReproduciendo(true);
              }}
              onPause={() => setReproduciendo(false)}
              onEnded={(e) => {
                setReproduciendo(false);
                alAvanzarVideo(e.currentTarget);
              }}
              onTimeUpdate={(e) => alAvanzarVideo(e.currentTarget)}
              onSeeking={(e) => alBuscarVideo(e.currentTarget)}
              onRateChange={(e) => {
                if (e.currentTarget.playbackRate !== 1) e.currentTarget.playbackRate = 1;
              }}
            />
            <div className='portal-th__visor-controles'>
              <button type='button' onClick={alternarVideo}>
                {reproduciendo ? '❚❚ Pausar' : '▶ Reproducir'}
              </button>
              <button type='button' onClick={retrocederVideo} aria-label='Retroceder 10 segundos'>
                ↺ 10 s
              </button>
              <div
                className='portal-th__visor-avance'
                role='progressbar'
                aria-label='Tiempo visto del video'
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={duracion > 0 ? Math.min(100, Math.floor((segundos / duracion) * 100)) : 0}
              >
                <span style={{ width: `${duracion > 0 ? Math.min(100, (segundos / duracion) * 100) : 0}%` }} />
              </div>
              <span className='portal-th__visor-contador' data-testid='contador-video'>
                {contadorVideo(segundos, duracion)}
              </span>
            </div>
          </>
        ) : tipo === 'imagen' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className='portal-th__visor-imagen' src={url} alt={material.titulo} />
        ) : tipo === 'pdf' ? (
          <>
            <PdfPaginado url={url} pagina={pdf.pagina} onCargado={alCargarPdf} onError={setError} />
            {pdf.total > 1 && (
              <div className='portal-th__visor-controles'>
                <button type='button' onClick={() => irAPagina(pdf.pagina - 1)} disabled={pdf.pagina <= 1}>
                  ← Página anterior
                </button>
                <span className='portal-th__visor-contador' data-testid='pagina-pdf'>
                  Página {pdf.pagina} de {pdf.total}
                </span>
                <button type='button' onClick={() => irAPagina(pdf.pagina + 1)} disabled={pdf.pagina >= pdf.total}>
                  Página siguiente →
                </button>
                <div
                  className='portal-th__visor-avance'
                  role='progressbar'
                  aria-label='Lectura del documento'
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={lectura}
                  data-testid='lectura-pdf'
                >
                  <span style={{ width: `${lectura}%` }} />
                </div>
                <span className='portal-th__visor-contador'>{lectura} %</span>
              </div>
            )}
          </>
        ) : tipo === 'documento' ? (
          <div className='portal-th__visor-documento'>
            <p>Este documento se abre con su programa (Word, Excel o PowerPoint).</p>
            <a className='portal-th__certificado-boton' href={url} target='_blank' rel='noopener noreferrer'>
              Abrir documento
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Pinta UNA página del PDF en un lienzo con pdf.js (el mismo `pdfjs-dist` y
 * el mismo worker que usan Orión y el SGC; no hay dependencia nueva). Sin
 * barra de desplazamiento ni salto directo: la página la decide el visor con
 * sus botones.
 */
function PdfPaginado({
  url,
  pagina,
  onCargado,
  onError,
}: {
  url: string;
  pagina: number;
  onCargado: (total: number) => void;
  onError: (mensaje: string) => void;
}) {
  const lienzo = useRef<HTMLCanvasElement | null>(null);
  const marco = useRef<HTMLDivElement | null>(null);
  const [documento, setDocumento] = useState<import('pdfjs-dist').PDFDocumentProxy | null>(null);
  const [pintada, setPintada] = useState(0);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('No se pudo cargar el documento.');
        const bytes = new Uint8Array(await res.arrayBuffer());
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const doc = await pdfjs.getDocument({ data: bytes }).promise;
        if (!vivo) return;
        setDocumento(doc);
        onCargado(doc.numPages);
      } catch (e) {
        if (vivo) onError((e as Error).message || 'No se pudo mostrar el documento.');
      }
    })();
    return () => {
      vivo = false;
    };
  }, [url, onCargado, onError]);

  useEffect(() => {
    if (!documento || !lienzo.current) return;
    let tarea: { cancel: () => void } | null = null;
    let vivo = true;
    void (async () => {
      const p = await documento.getPage(pagina);
      if (!vivo || !lienzo.current) return;
      const base = p.getViewport({ scale: 1 });
      // La página completa a la vista: se ajusta al ancho y al alto del visor.
      const ancho = Math.max(240, (marco.current?.clientWidth ?? 900) - 24);
      const alto = Math.max(240, (marco.current?.clientHeight ?? 700) - 24);
      const escala = Math.min(ancho / base.width, alto / base.height) * (window.devicePixelRatio || 1);
      const vista = p.getViewport({ scale: escala });
      const c = lienzo.current;
      c.width = vista.width;
      c.height = vista.height;
      c.style.width = `${vista.width / (window.devicePixelRatio || 1)}px`;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      const render = p.render({ canvasContext: ctx, viewport: vista, canvas: c } as Parameters<typeof p.render>[0]);
      tarea = render;
      await render.promise.catch(() => undefined);
      if (vivo) setPintada(pagina);
    })();
    return () => {
      vivo = false;
      tarea?.cancel();
    };
  }, [documento, pagina]);

  return (
    <div className='portal-th__visor-pdf' ref={marco} data-testid='pdf-material' data-pagina-pintada={pintada}>
      {!documento && <p className='portal-th__estado'>Cargando documento…</p>}
      <canvas ref={lienzo} aria-label={`Página ${pagina}`} />
    </div>
  );
}

/* ──────────────────────────────── Formador ─────────────────────────────── */

function ListaCursosFormador({
  cursos,
  onGestionar,
  onCreado,
}: {
  cursos: CursoResumen[];
  onGestionar: (id: number) => void;
  onCreado: () => Promise<void>;
}) {
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const crear = async () => {
    if (!titulo.trim()) return;
    setCreando(true);
    setError(null);
    try {
      const res = await fetch('/api/portal/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titulo, descripcion }),
      });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo crear el curso.'));
      setTitulo('');
      setDescripcion('');
      await onCreado();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreando(false);
    }
  };

  return (
    <div>
      <div className='portal-th__formacion-crear'>
        <input placeholder='Título del curso nuevo' value={titulo} onChange={(e) => setTitulo(e.target.value)} />
        <input
          placeholder='Descripción (opcional)'
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
        />
        <button type='button' onClick={() => void crear()} disabled={creando || !titulo.trim()}>
          {creando ? 'Creando…' : '+ Crear curso'}
        </button>
      </div>
      {error && <p className='portal-th__error'>{error}</p>}

      {cursos.length === 0 ? (
        <p className='portal-th__estado'>Todavía no ha creado ningún curso.</p>
      ) : (
        <div className='portal-th__curso-grilla'>
          {cursos.map((c) => (
            <button type='button' key={c.id} className='portal-th__curso-tarjeta' onClick={() => onGestionar(c.id)}>
              <strong>
                {c.titulo} {!c.activo && <span className='portal-th__curso-borrador'>(borrador)</span>}
              </strong>
              {c.descripcion && <p>{c.descripcion}</p>}
              <span className='portal-th__curso-meta'>
                {c.totalMateriales} material(es) · {c.totalInscritos} inscrito(s)
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function VistaCursoFormador({
  cursoId,
  onVolver,
  onCambio,
}: {
  cursoId: number;
  onVolver: () => void;
  onCambio: () => Promise<void>;
}) {
  const [detalle, setDetalle] = useState<DetalleCurso | null>(null);
  const [roster, setRoster] = useState<FilaRoster[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Error de una ACCIÓN (guardar, quitar, reemplazar): se muestra arriba sin
  // tapar la vista, para que el formador no pierda lo que estaba editando.
  const [errorAccion, setErrorAccion] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const [resCurso, resRoster] = await Promise.all([
        fetch(`/api/portal/courses/${cursoId}`, { cache: 'no-store' }),
        fetch(`/api/portal/courses/${cursoId}/roster`, { cache: 'no-store' }),
      ]);
      const dataCurso = await leerJson(resCurso);
      if (!resCurso.ok) throw new Error(String(dataCurso?.error ?? 'No se pudo cargar el curso.'));
      setDetalle(dataCurso as unknown as DetalleCurso);

      const dataRoster = await leerJson(resRoster);
      if (!resRoster.ok) throw new Error(String(dataRoster?.error ?? 'No se pudo cargar el progreso.'));
      setRoster(Array.isArray(dataRoster.estudiantes) ? (dataRoster.estudiantes as FilaRoster[]) : []);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [cursoId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // ── Subida DIRECTA a SharePoint (sin tope de peso; Cristian, 2026-10-08) ──
  // El archivo va del navegador a la carpeta FORMACION por trozos; el
  // servidor solo abre la sesión y después registra el material.
  const [subida, setSubida] = useState<EstadoSubida | null>(null);
  const cancelarSubidaRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!subida) return;
    // Cerrar la pestaña a mitad de un video de 500 MB lo deja a medias.
    const alSalir = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', alSalir);
    return () => window.removeEventListener('beforeunload', alSalir);
  }, [subida]);

  const subirDirecto = async (archivo: File): Promise<ArchivoSubidoAlCurso> => {
    const control = new AbortController();
    cancelarSubidaRef.current = control;
    setSubida({ nombre: archivo.name, subidos: 0, total: archivo.size });
    try {
      return await subirMaterialDirecto(cursoId, archivo, {
        signal: control.signal,
        onProgreso: (subidos, total) => setSubida({ nombre: archivo.name, subidos, total }),
      });
    } finally {
      cancelarSubidaRef.current = null;
      setSubida(null);
    }
  };

  const mensajeDeSubida = (e: unknown, porDefecto: string) =>
    e instanceof SubidaCancelada ? 'Subida cancelada. No se agregó nada al curso.' : (e as Error)?.message || porDefecto;

  const [tipoNuevo, setTipoNuevo] = useState<'DOCUMENT' | 'LINK' | 'FORM'>('DOCUMENT');
  const [formularioNuevo, setFormularioNuevo] = useState<{ id: number | null; titulo: string }>({ id: null, titulo: '' });
  const [respuestasDe, setRespuestasDe] = useState<Material | null>(null);
  const [previaDe, setPreviaDe] = useState<Material | null>(null);
  const [tituloNuevo, setTituloNuevo] = useState('');
  const [urlNueva, setUrlNueva] = useState('');
  const [archivoNuevo, setArchivoNuevo] = useState<File | null>(null);
  const [obligatorioNuevo, setObligatorioNuevo] = useState(true);
  const [subiendo, setSubiendo] = useState(false);

  const agregarMaterial = async () => {
    if (!tituloNuevo.trim() && tipoNuevo !== 'FORM') return;
    if (tipoNuevo === 'FORM' && !formularioNuevo.id) return;
    if (tipoNuevo === 'LINK' && !urlNueva.trim()) return;
    if (tipoNuevo === 'DOCUMENT' && !archivoNuevo) return;

    setSubiendo(true);
    setErrorAccion(null);
    try {
      const cuerpo: Record<string, unknown> = {
        type: tipoNuevo,
        title: tituloNuevo,
        required: String(obligatorioNuevo),
      };
      if (tipoNuevo === 'LINK') cuerpo.url = urlNueva;
      else if (tipoNuevo === 'FORM') cuerpo.formularioId = formularioNuevo.id;
      else if (archivoNuevo) Object.assign(cuerpo, await subirDirecto(archivoNuevo));

      const res = await fetch(`/api/portal/courses/${cursoId}/materials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo agregar el material.'));

      setTituloNuevo('');
      setUrlNueva('');
      setArchivoNuevo(null);
      setObligatorioNuevo(true);
      await cargar();
    } catch (e) {
      setErrorAccion(mensajeDeSubida(e, 'No se pudo agregar el material.'));
    } finally {
      setSubiendo(false);
    }
  };

  const quitarMaterial = async (materialId: number) => {
    if (
      !window.confirm(
        '¿Quitar este material del curso? Deja de contar para el progreso y su archivo se mueve a la carpeta ' +
          'FORMACION/ELIMINADOS de SharePoint (no se borra).'
      )
    )
      return;
    setErrorAccion(null);
    try {
      const res = await fetch(`/api/portal/courses/${cursoId}/materials/${materialId}`, { method: 'DELETE' });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo quitar el material.'));
      await cargar();
    } catch (e) {
      setErrorAccion((e as Error).message);
    }
  };

  /** PATCH del material (JSON). Devuelve true si salió bien. */
  const guardarMaterial = async (materialId: number, cambios: Record<string, unknown>): Promise<boolean> => {
    setErrorAccion(null);
    try {
      const res = await fetch(`/api/portal/courses/${cursoId}/materials/${materialId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cambios),
      });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo guardar el material.'));
      return true;
    } catch (e) {
      setErrorAccion((e as Error).message);
      return false;
    }
  };

  /** Reemplaza el archivo (o convierte un enlace en documento). */
  const reemplazarArchivo = async (materialId: number, archivo: File): Promise<boolean> => {
    setErrorAccion(null);
    try {
      const subido = await subirDirecto(archivo);
      const res = await fetch(`/api/portal/courses/${cursoId}/materials/${materialId}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subido),
      });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo reemplazar el archivo.'));
      return true;
    } catch (e) {
      setErrorAccion(mensajeDeSubida(e, 'No se pudo reemplazar el archivo.'));
      return false;
    }
  };

  const moverMaterial = async (materialId: number, mover: 'arriba' | 'abajo') => {
    if (await guardarMaterial(materialId, { mover })) await cargar();
  };

  const [editandoCurso, setEditandoCurso] = useState(false);
  const [tituloCurso, setTituloCurso] = useState('');
  const [descripcionCurso, setDescripcionCurso] = useState('');
  const [guardandoCurso, setGuardandoCurso] = useState(false);

  const empezarEdicionCurso = () => {
    if (!detalle) return;
    setTituloCurso(detalle.curso.titulo);
    setDescripcionCurso(detalle.curso.descripcion ?? '');
    setEditandoCurso(true);
  };

  const guardarCurso = async () => {
    if (!tituloCurso.trim()) {
      setErrorAccion('El título del curso no puede quedar vacío.');
      return;
    }
    setGuardandoCurso(true);
    setErrorAccion(null);
    try {
      const res = await fetch(`/api/portal/courses/${cursoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titulo: tituloCurso, descripcion: descripcionCurso }),
      });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo guardar el curso.'));
      setEditandoCurso(false);
      await cargar();
      await onCambio();
    } catch (e) {
      setErrorAccion((e as Error).message);
    } finally {
      setGuardandoCurso(false);
    }
  };

  const publicar = async (activo: boolean) => {
    try {
      const res = await fetch(`/api/portal/courses/${cursoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activo }),
      });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo actualizar el curso.'));
      await cargar();
      await onCambio();
    } catch (e) {
      setErrorAccion((e as Error).message);
    }
  };

  if (error) return <p className='portal-th__error'>{error}</p>;
  if (!detalle || !roster) return <p className='portal-th__estado'>Cargando…</p>;

  return (
    <div className='portal-th__curso-detalle'>
      <button type='button' className='portal-th__volver' onClick={onVolver}>
        ← Volver a Formación
      </button>
      {errorAccion && (
        <p className='portal-th__error portal-th__error--accion' role='alert'>
          {errorAccion}
        </p>
      )}
      {subida && <ProgresoSubida subida={subida} onCancelar={() => cancelarSubidaRef.current?.abort()} />}
      {editandoCurso ? (
        <div className='portal-th__formacion-crear portal-th__formacion-editar'>
          <input
            aria-label='Título del curso'
            placeholder='Título del curso'
            value={tituloCurso}
            maxLength={255}
            onChange={(e) => setTituloCurso(e.target.value)}
          />
          <textarea
            aria-label='Descripción del curso'
            placeholder='Descripción (opcional)'
            value={descripcionCurso}
            maxLength={4000}
            rows={3}
            onChange={(e) => setDescripcionCurso(e.target.value)}
          />
          <div className='portal-th__formacion-editar-acciones'>
            <button type='button' onClick={() => void guardarCurso()} disabled={guardandoCurso}>
              {guardandoCurso ? 'Guardando…' : 'Guardar'}
            </button>
            <button
              type='button'
              className='portal-th__boton-secundario'
              onClick={() => setEditandoCurso(false)}
              disabled={guardandoCurso}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className='portal-th__formacion-gestion-barra'>
          <div className='portal-th__formacion-titulo'>
            <h3>{detalle.curso.titulo}</h3>
            <button
              type='button'
              className='portal-th__icono-boton'
              title='Editar título y descripción'
              aria-label='Editar título y descripción'
              onClick={empezarEdicionCurso}
            >
              ✎
            </button>
          </div>
          <button type='button' onClick={() => void publicar(!detalle.curso.activo)}>
            {detalle.curso.activo ? 'Pasar a borrador' : 'Publicar curso'}
          </button>
        </div>
      )}
      {!editandoCurso && detalle.curso.descripcion && (
        <p className='portal-th__formacion-descripcion'>{detalle.curso.descripcion}</p>
      )}
      {!detalle.curso.activo && (
        <p className='portal-th__aviso'>Este curso está en borrador: los estudiantes todavía no lo ven.</p>
      )}

      <h4>Materiales</h4>
      <ul className='portal-th__material-lista'>
        {detalle.materiales.map((m, i) => (
          <FilaMaterialFormador
            key={m.id}
            cursoId={detalle.curso.id}
            material={m}
            esPrimero={i === 0}
            esUltimo={i === detalle.materiales.length - 1}
            onGuardar={guardarMaterial}
            onReemplazar={reemplazarArchivo}
            onMover={moverMaterial}
            onQuitar={quitarMaterial}
            onRecargar={cargar}
            puedeVerRespuestas={detalle.puedeMarcarManual === true}
            onVerRespuestas={setRespuestasDe}
            onVerPrevia={setPreviaDe}
          />
        ))}
        {detalle.materiales.length === 0 && <p className='portal-th__estado'>Todavía no hay materiales.</p>}
      </ul>

      <div className='portal-th__formacion-crear'>
        <div className='portal-th__formacion-toggle'>
          <button
            type='button'
            className={tipoNuevo === 'DOCUMENT' ? 'portal-th__formacion-toggle-activo' : ''}
            onClick={() => setTipoNuevo('DOCUMENT')}
          >
            Documento
          </button>
          <button
            type='button'
            className={tipoNuevo === 'LINK' ? 'portal-th__formacion-toggle-activo' : ''}
            onClick={() => setTipoNuevo('LINK')}
          >
            Enlace
          </button>
          <button
            type='button'
            className={tipoNuevo === 'FORM' ? 'portal-th__formacion-toggle-activo' : ''}
            onClick={() => setTipoNuevo('FORM')}
          >
            Formulario
          </button>
        </div>
        <input
          placeholder={tipoNuevo === 'FORM' ? 'Título (opcional)' : 'Título del material'}
          value={tituloNuevo}
          onChange={(e) => setTituloNuevo(e.target.value)}
        />
        {tipoNuevo === 'FORM' ? (
          <SelectorFormulario valor={formularioNuevo.id} onCambio={(id, titulo) => setFormularioNuevo({ id, titulo })} />
        ) : tipoNuevo === 'LINK' ? (
          <input
            placeholder='https://…'
            value={urlNueva}
            onChange={(e) => setUrlNueva(e.target.value)}
          />
        ) : (
          <input type='file' onChange={(e) => setArchivoNuevo(e.currentTarget.files?.[0] ?? null)} />
        )}
        <label className='portal-th__formacion-obligatorio'>
          <input type='checkbox' checked={obligatorioNuevo} onChange={(e) => setObligatorioNuevo(e.target.checked)} />
          Obligatorio para completar el curso
        </label>
        <button type='button' onClick={() => void agregarMaterial()} disabled={subiendo}>
          {subiendo ? (subida ? 'Subiendo…' : 'Agregando…') : '+ Agregar material'}
        </button>
      </div>

      {respuestasDe && (
        <PanelRespuestas materialId={respuestasDe.id} titulo={respuestasDe.titulo} onCerrar={() => setRespuestasDe(null)} onCambio={cargar} />
      )}
      {previaDe?.formularioId && (
        <PreviaDeMaterialFormulario formularioId={previaDe.formularioId} titulo={previaDe.titulo} onCerrar={() => setPreviaDe(null)} />
      )}

      <h4>Progreso de los estudiantes</h4>
      {roster.length === 0 ? (
        <p className='portal-th__estado'>Todavía no hay estudiantes inscritos.</p>
      ) : (
        <div className='portal-th__correos'>
          <table className='portal-th__correos-tabla portal-th__roster-tabla'>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Correo</th>
                <th>Progreso</th>
                <th>Certificado</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((f) => (
                <tr key={f.correo}>
                  <td>{f.nombre}</td>
                  <td>{f.correo}</td>
                  <td>
                    <BarraProgreso porcentaje={f.porcentaje} />
                  </td>
                  <td>
                    {f.certificado ? (
                      <a href={certificadoUrl(f.certificado)} target='_blank' rel='noopener noreferrer'>
                        Ver
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Un material en la vista del formador, con edición EN LÍNEA (lápiz →
 * Guardar/Cancelar): título, tipo, enlace, reemplazo del archivo, la marca
 * de obligatorio y el orden (↑/↓). Pedido de Cristian, 2026-09-30.
 */
function FilaMaterialFormador({
  cursoId,
  material: m,
  esPrimero,
  esUltimo,
  onGuardar,
  onReemplazar,
  onMover,
  onQuitar,
  onRecargar,
  puedeVerRespuestas = false,
  onVerRespuestas,
  onVerPrevia,
}: {
  cursoId: number;
  material: Material;
  puedeVerRespuestas?: boolean;
  onVerRespuestas?: (m: Material) => void;
  onVerPrevia?: (m: Material) => void;
  esPrimero: boolean;
  esUltimo: boolean;
  onGuardar: (materialId: number, cambios: Record<string, unknown>) => Promise<boolean>;
  onReemplazar: (materialId: number, archivo: File) => Promise<boolean>;
  onMover: (materialId: number, mover: 'arriba' | 'abajo') => Promise<void>;
  onQuitar: (materialId: number) => Promise<void>;
  onRecargar: () => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [titulo, setTitulo] = useState(m.titulo);
  const [tipo, setTipo] = useState<'DOCUMENT' | 'LINK' | 'FORM'>(m.tipo);
  const [url, setUrl] = useState(m.url ?? '');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [obligatorio, setObligatorio] = useState(m.obligatorio);
  const [guardando, setGuardando] = useState(false);

  const empezar = () => {
    setTitulo(m.titulo);
    setTipo(m.tipo);
    setUrl(m.url ?? '');
    setArchivo(null);
    setObligatorio(m.obligatorio);
    setEditando(true);
  };

  // Pasar de enlace a documento exige subir un archivo.
  const faltaArchivo = tipo === 'DOCUMENT' && m.tipo === 'LINK' && !archivo;
  const faltaUrl = tipo === 'LINK' && !url.trim();

  const guardar = async () => {
    if (!titulo.trim() || faltaArchivo || faltaUrl) return;
    setGuardando(true);
    try {
      // 1) El archivo primero: si falla, no se toca nada más.
      if (tipo === 'DOCUMENT' && archivo) {
        if (!(await onReemplazar(m.id, archivo))) return;
      }
      // 2) Los demás campos.
      const cambios: Record<string, unknown> = { titulo, obligatorio };
      if (tipo === 'LINK' && m.tipo !== 'FORM') {
        cambios.tipo = 'LINK';
        cambios.url = url;
      }
      if (!(await onGuardar(m.id, cambios))) {
        await onRecargar();
        return;
      }
      setEditando(false);
      await onRecargar();
    } finally {
      setGuardando(false);
    }
  };

  if (!editando) {
    return (
      <li className='portal-th__material-item'>
        <div className='portal-th__material-info'>
          {m.tipo === 'FORM' ? (
            <button type='button' className='portal-th__material-abrir' onClick={() => onVerPrevia?.(m)}>
              {m.titulo}
            </button>
          ) : (
            <a
              href={m.tipo === 'LINK' ? (m.url ?? '#') : materialUrl(cursoId, m.id)}
              target='_blank'
              rel='noopener noreferrer'
            >
              {m.titulo}
            </a>
          )}
          <span className='portal-th__material-tipo'>
            {m.tipo === 'LINK' ? 'Enlace' : m.tipo === 'FORM' ? 'Formulario propio' : 'Documento'}
            {m.tipo === 'DOCUMENT' && m.nombreArchivo && ` · ${m.nombreArchivo}`}
            {!m.obligatorio && ' · opcional'}
          </span>
        </div>
        <div className='portal-th__material-acciones'>
          {m.tipo === 'FORM' && puedeVerRespuestas && (
            <Button size='xs' variant='default' leftSection={<IconTable size={14} />} onClick={() => onVerRespuestas?.(m)}>
              Respuestas
            </Button>
          )}
          <button
            type='button'
            className='portal-th__icono-boton'
            title='Subir'
            aria-label='Subir un puesto'
            disabled={esPrimero}
            onClick={() => void onMover(m.id, 'arriba')}
          >
            ↑
          </button>
          <button
            type='button'
            className='portal-th__icono-boton'
            title='Bajar'
            aria-label='Bajar un puesto'
            disabled={esUltimo}
            onClick={() => void onMover(m.id, 'abajo')}
          >
            ↓
          </button>
          <button type='button' className='portal-th__icono-boton' title='Editar' aria-label='Editar material' onClick={empezar}>
            ✎
          </button>
          <button
            type='button'
            className='portal-th__icono-boton'
            title='Quitar'
            aria-label='Quitar material'
            onClick={() => void onQuitar(m.id)}
          >
            ✕
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className='portal-th__material-item portal-th__material-item--editando'>
      <div className='portal-th__formacion-crear portal-th__formacion-editar'>
        <div className='portal-th__formacion-toggle' hidden={m.tipo === 'FORM'}>
          <button
            type='button'
            className={tipo === 'DOCUMENT' ? 'portal-th__formacion-toggle-activo' : ''}
            onClick={() => setTipo('DOCUMENT')}
          >
            Documento
          </button>
          <button
            type='button'
            className={tipo === 'LINK' ? 'portal-th__formacion-toggle-activo' : ''}
            onClick={() => setTipo('LINK')}
          >
            Enlace
          </button>
        </div>
        <input
          aria-label='Título del material'
          placeholder='Título del material'
          value={titulo}
          maxLength={255}
          onChange={(e) => setTitulo(e.target.value)}
        />
        {m.tipo === 'FORM' ? (
          <p className='portal-th__estado'>Formulario propio: las preguntas se editan en «Formularios» al agregar un material.</p>
        ) : tipo === 'LINK' ? (
          <input aria-label='Enlace' placeholder='https://…' value={url} onChange={(e) => setUrl(e.target.value)} />
        ) : (
          <label className='portal-th__formacion-archivo'>
            <span>
              {m.tipo === 'DOCUMENT'
                ? `Reemplazar archivo (actual: ${m.nombreArchivo ?? 'sin nombre'})`
                : 'Archivo del documento'}
            </span>
            <input type='file' onChange={(e) => setArchivo(e.currentTarget.files?.[0] ?? null)} />
          </label>
        )}
        <label className='portal-th__formacion-obligatorio'>
          <input type='checkbox' checked={obligatorio} onChange={(e) => setObligatorio(e.target.checked)} />
          Obligatorio para completar el curso
        </label>
        {(archivo || (tipo === 'LINK' && m.tipo === 'DOCUMENT')) && (
          <p className='portal-th__aviso'>
            El archivo anterior se moverá a la carpeta FORMACION/ELIMINADOS de SharePoint (no se borra). Quien ya
            había completado este material conserva su avance.
          </p>
        )}
        <div className='portal-th__formacion-editar-acciones'>
          <button
            type='button'
            onClick={() => void guardar()}
            disabled={guardando || !titulo.trim() || faltaArchivo || faltaUrl}
          >
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
          <button
            type='button'
            className='portal-th__boton-secundario'
            onClick={() => setEditando(false)}
            disabled={guardando}
          >
            Cancelar
          </button>
        </div>
      </div>
    </li>
  );
}
