'use client';

import { useCallback, useEffect, useState } from 'react';
import { leerJson } from './PortalContenido';

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
  tipo: 'DOCUMENT' | 'LINK';
  titulo: string;
  orden: number;
  url: string | null;
  nombreArchivo: string | null;
  obligatorio: boolean;
  completadoEl: string | null;
}

interface DetalleCurso {
  curso: { id: number; titulo: string; descripcion: string | null; activo: boolean; creadoPor: string };
  esFormador: boolean;
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

export default function PortalFormacion() {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursos, setCursos] = useState<CursoResumen[]>([]);
  const [esFormador, setEsFormador] = useState(false);
  const [vista, setVista] = useState<'estudiante' | 'formador'>('estudiante');

  const cargarCursos = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/portal/courses', { cache: 'no-store' });
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

function BarraProgreso({ porcentaje }: { porcentaje: number }) {
  return (
    <div className='portal-th__curso-progreso' role='progressbar' aria-valuenow={porcentaje} aria-valuemin={0} aria-valuemax={100}>
      <div className='portal-th__curso-progreso-barra' style={{ width: `${Math.min(100, Math.max(0, porcentaje))}%` }} />
      <span>{porcentaje}%</span>
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
          <BarraProgreso porcentaje={c.porcentaje ?? 0} />
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
  const [detalle, setDetalle] = useState<DetalleCurso | null>(null);
  const [marcando, setMarcando] = useState<number | null>(null);

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

  const alternarMaterial = async (materialId: number, completado: boolean) => {
    setMarcando(materialId);
    try {
      const res = await fetch(`/api/portal/materials/${materialId}/progress`, {
        method: completado ? 'DELETE' : 'POST',
      });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo actualizar.'));
      await cargar();
      await onCambio();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMarcando(null);
    }
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
      <BarraProgreso porcentaje={detalle.porcentaje} />

      <ul className='portal-th__material-lista'>
        {detalle.materiales.map((m) => {
          const completado = m.completadoEl !== null;
          return (
            <li key={m.id} className='portal-th__material-item'>
              <button
                type='button'
                className={`portal-th__material-check${completado ? ' portal-th__material-check--hecho' : ''}`}
                disabled={marcando === m.id}
                onClick={() => void alternarMaterial(m.id, completado)}
                aria-label={completado ? `Marcar ${m.titulo} como pendiente` : `Marcar ${m.titulo} como completado`}
              >
                {completado ? '✓' : ''}
              </button>
              <div className='portal-th__material-info'>
                <a
                  href={m.tipo === 'LINK' ? (m.url ?? '#') : materialUrl(detalle.curso.id, m.id)}
                  target='_blank'
                  rel='noopener noreferrer'
                >
                  {m.titulo}
                </a>
                <span className='portal-th__material-tipo'>
                  {m.tipo === 'LINK' ? 'Enlace' : 'Documento'}
                  {!m.obligatorio && ' · opcional'}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

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

  const [tipoNuevo, setTipoNuevo] = useState<'DOCUMENT' | 'LINK'>('DOCUMENT');
  const [tituloNuevo, setTituloNuevo] = useState('');
  const [urlNueva, setUrlNueva] = useState('');
  const [archivoNuevo, setArchivoNuevo] = useState<File | null>(null);
  const [obligatorioNuevo, setObligatorioNuevo] = useState(true);
  const [subiendo, setSubiendo] = useState(false);

  const agregarMaterial = async () => {
    if (!tituloNuevo.trim()) return;
    if (tipoNuevo === 'LINK' && !urlNueva.trim()) return;
    if (tipoNuevo === 'DOCUMENT' && !archivoNuevo) return;

    setSubiendo(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('type', tipoNuevo);
      form.append('title', tituloNuevo);
      form.append('required', String(obligatorioNuevo));
      if (tipoNuevo === 'LINK') form.append('url', urlNueva);
      else if (archivoNuevo) form.append('file', archivoNuevo);

      const res = await fetch(`/api/portal/courses/${cursoId}/materials`, { method: 'POST', body: form });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo agregar el material.'));

      setTituloNuevo('');
      setUrlNueva('');
      setArchivoNuevo(null);
      setObligatorioNuevo(true);
      await cargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubiendo(false);
    }
  };

  const quitarMaterial = async (materialId: number) => {
    if (!window.confirm('¿Quitar este material del curso? El progreso que los estudiantes tenían ahí se pierde.')) return;
    try {
      const res = await fetch(`/api/portal/courses/${cursoId}/materials/${materialId}`, { method: 'DELETE' });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo quitar el material.'));
      await cargar();
    } catch (e) {
      setError((e as Error).message);
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
      setError((e as Error).message);
    }
  };

  if (error) return <p className='portal-th__error'>{error}</p>;
  if (!detalle || !roster) return <p className='portal-th__estado'>Cargando…</p>;

  return (
    <div className='portal-th__curso-detalle'>
      <button type='button' className='portal-th__volver' onClick={onVolver}>
        ← Volver a Formación
      </button>
      <div className='portal-th__formacion-gestion-barra'>
        <h3>{detalle.curso.titulo}</h3>
        <button type='button' onClick={() => void publicar(!detalle.curso.activo)}>
          {detalle.curso.activo ? 'Pasar a borrador' : 'Publicar curso'}
        </button>
      </div>
      {!detalle.curso.activo && (
        <p className='portal-th__aviso'>Este curso está en borrador: los estudiantes todavía no lo ven.</p>
      )}

      <h4>Materiales</h4>
      <ul className='portal-th__material-lista'>
        {detalle.materiales.map((m) => (
          <li key={m.id} className='portal-th__material-item'>
            <div className='portal-th__material-info'>
              <a
                href={m.tipo === 'LINK' ? (m.url ?? '#') : materialUrl(detalle.curso.id, m.id)}
                target='_blank'
                rel='noopener noreferrer'
              >
                {m.titulo}
              </a>
              <span className='portal-th__material-tipo'>
                {m.tipo === 'LINK' ? 'Enlace' : 'Documento'}
                {!m.obligatorio && ' · opcional'}
              </span>
            </div>
            <button type='button' className='portal-th__banner-quitar' onClick={() => void quitarMaterial(m.id)}>
              ✕
            </button>
          </li>
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
        </div>
        <input placeholder='Título del material' value={tituloNuevo} onChange={(e) => setTituloNuevo(e.target.value)} />
        {tipoNuevo === 'LINK' ? (
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
          {subiendo ? 'Agregando…' : '+ Agregar material'}
        </button>
      </div>

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
