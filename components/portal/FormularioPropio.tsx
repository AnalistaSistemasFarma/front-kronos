'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { leerJson } from './PortalContenido';
import {
  OPCIONES_SI_NO,
  MENSAJE_AUTORIZACION,
  textoDeRespuesta,
  validarPregunta,
  valoresIniciales,
  type DefinicionFormulario,
  type PreguntaFormulario,
  type Respuestas,
  type ValorRespuesta,
} from '../../lib/portal/formulario';

/**
 * FORMACIÓN — FORMULARIO PROPIO del curso (Cristian Baldión, 2026-10-08).
 *
 * "toma todas las preguntas que están ahí y créame el formulario en el curso,
 * así como el enlace que te pasé, pero que sea un formulario propio del curso".
 *
 * Comportamiento confirmado por Cristian:
 *   - se abre en la MISMA ventana de vista previa de los materiales;
 *   - UN solo botón "Enviar", al final;
 *   - si faltan obligatorias: mensaje visible arriba y desplazamiento (y foco)
 *     a la PRIMERA que falte;
 *   - al enviar con éxito: confirmación "Respuestas enviadas", botón para
 *     volver al curso, y la casilla y el "Completado" del material
 *     actualizados de inmediato en la lista (lo marca el servidor).
 *
 * El correo y el nombre se prellenan desde la sesión: el nombre se puede
 * corregir; el correo no (la respuesta se guarda con el de la sesión).
 */

const ID_AUTORIZACION = 'autorizacion';

type Errores = Record<string, string>;

interface DatosFormulario {
  material: { id: number; titulo: string };
  formulario: { versionId: number; version: number; definicion: DefinicionFormulario };
  prellenado: { correo: string; nombre: string };
  enviadaEl: string | null;
}

const fechaLarga = (v: string) =>
  new Date(v).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Bogota' });

/* ───────────────────────────── Ventana del formulario ───────────────────────────── */

export function VisorFormulario({
  materialId,
  titulo,
  previa,
  onCerrar,
  onEnviado,
}: {
  /** Material FORM a responder. */
  materialId?: number;
  titulo: string;
  /** Vista previa del formador: la definición directamente, sin guardar nada. */
  previa?: DefinicionFormulario;
  onCerrar: () => void;
  /** Se llama apenas el servidor confirma el envío (para refrescar la lista). */
  onEnviado?: () => Promise<void> | void;
}) {
  const [datos, setDatos] = useState<DatosFormulario | null>(
    previa
      ? {
          material: { id: 0, titulo },
          formulario: { versionId: 0, version: 0, definicion: previa },
          prellenado: { correo: 'persona@empresa.com', nombre: 'Nombre de la persona' },
          enviadaEl: null,
        }
      : null
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (previa || !materialId) return;
    let vivo = true;
    void (async () => {
      try {
        const res = await fetch(`/api/portal/materials/${materialId}/formulario`, { cache: 'no-store' });
        const data = await leerJson(res);
        if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo abrir el formulario.'));
        if (vivo) setDatos(data as unknown as DatosFormulario);
      } catch (e) {
        if (vivo) setError((e as Error).message);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [materialId, previa]);

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [onCerrar]);

  return (
    <div
      className='portal-th__visor'
      role='dialog'
      aria-modal='true'
      aria-label={titulo}
      data-testid='visor-formulario'
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div className='portal-th__visor-caja portal-th__visor-caja--formulario'>
        <header className='portal-th__visor-barra'>
          <strong>{titulo}</strong>
          <div className='portal-th__visor-acciones'>
            <button type='button' onClick={onCerrar} aria-label='Cerrar'>
              ✕
            </button>
          </div>
        </header>
        {error && (
          <p className='portal-th__resultado portal-th__resultado--error' role='alert'>
            {error}
          </p>
        )}
        {!datos && !error && <p className='portal-th__estado portal-th__formulario-cargando'>Cargando formulario…</p>}
        {datos && (
          <CuerpoFormulario
            key={datos.formulario.versionId}
            datos={datos}
            previa={!!previa}
            onCerrar={onCerrar}
            onEnviado={onEnviado}
          />
        )}
      </div>
    </div>
  );
}

function CuerpoFormulario({
  datos,
  previa,
  onCerrar,
  onEnviado,
}: {
  datos: DatosFormulario;
  previa: boolean;
  onCerrar: () => void;
  onEnviado?: () => Promise<void> | void;
}) {
  const definicion = datos.formulario.definicion;
  const [valores, setValores] = useState<Respuestas>(() => valoresIniciales(definicion, datos.prellenado));
  const [autoriza, setAutoriza] = useState(false);
  const [errores, setErrores] = useState<Errores>({});
  const [aviso, setAviso] = useState<{ tipo: 'error' | 'ok' | 'advertencia'; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviadaEl, setEnviadaEl] = useState<string | null>(datos.enviadaEl);
  const [recienEnviada, setRecienEnviada] = useState(false);
  const desplazable = useRef<HTMLDivElement | null>(null);

  const ponerValor = (id: string, valor: ValorRespuesta) => {
    setValores((v) => ({ ...v, [id]: valor }));
    // Al corregir, el error de esa pregunta se quita sin esperar a "Enviar".
    setErrores((e) => {
      if (!e[id]) return e;
      const copia = { ...e };
      delete copia[id];
      return copia;
    });
  };

  /** Lleva a la persona a la primera pregunta con error y la enfoca. */
  const irAlPrimerError = (lista: Errores) => {
    const orden = [ID_AUTORIZACION, ...definicion.preguntas.map((p) => p.id)];
    const primero = orden.find((id) => lista[id]);
    if (!primero) return;
    // Después de pintar los mensajes de error.
    window.requestAnimationFrame(() => {
      const bloque = document.getElementById(`fp-${primero}`);
      bloque?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const campo = bloque?.querySelector<HTMLElement>('input, textarea');
      campo?.focus({ preventScroll: true });
    });
  };

  const validarTodo = (): Errores => {
    const lista: Errores = {};
    if (definicion.autorizacion && !autoriza) lista[ID_AUTORIZACION] = MENSAJE_AUTORIZACION;
    for (const p of definicion.preguntas) {
      const e = validarPregunta(p, valores[p.id]);
      if (e) lista[p.id] = e;
    }
    return lista;
  };

  const mostrarErrores = (lista: Errores) => {
    setErrores(lista);
    const n = Object.keys(lista).filter((id) => id !== ID_AUTORIZACION).length;
    const partes: string[] = [];
    if (lista[ID_AUTORIZACION]) partes.push('acepte la autorización de tratamiento de datos');
    if (n > 0) partes.push(n === 1 ? 'revise 1 pregunta' : `revise ${n} preguntas`);
    const marcadas = Object.keys(lista).length === 1 ? 'marcada en rojo' : 'marcadas en rojo';
    setAviso({ tipo: 'error', texto: `No se pudo enviar: ${partes.join(' y ')} (${marcadas}).` });
    irAlPrimerError(lista);
  };

  const enviar = async () => {
    setAviso(null);
    const lista = validarTodo();
    if (Object.keys(lista).length > 0) return mostrarErrores(lista);
    if (previa) {
      setAviso({ tipo: 'advertencia', texto: 'Vista previa: el formulario está completo. En la vista previa no se guarda nada.' });
      desplazable.current?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setEnviando(true);
    try {
      const res = await fetch(`/api/portal/materials/${datos.material.id}/formulario`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId: datos.formulario.versionId, autorizaDatos: autoriza, respuestas: valores }),
      });
      const data = await leerJson(res);
      if (res.status === 422 && Array.isArray(data?.errores)) {
        const delServidor: Errores = {};
        for (const e of data.errores as { id: string; mensaje: string }[]) delServidor[e.id] = e.mensaje;
        return mostrarErrores(delServidor);
      }
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudieron enviar las respuestas.'));
      setEnviadaEl(String(data.enviadaEl ?? new Date().toISOString()));
      setRecienEnviada(true);
      desplazable.current?.scrollTo({ top: 0 });
      // La lista del curso se actualiza de inmediato (casilla + "Completado").
      await onEnviado?.();
    } catch (e) {
      setAviso({ tipo: 'error', texto: (e as Error).message });
      desplazable.current?.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setEnviando(false);
    }
  };

  if (enviadaEl) {
    return (
      <div className='portal-th__formulario-fin' data-testid='formulario-enviado'>
        {recienEnviada ? (
          <>
            <div className='portal-th__formulario-fin-icono' aria-hidden='true'>
              ✓
            </div>
            <h3 role='status'>Respuestas enviadas</h3>
            <p>Gracias. Sus respuestas quedaron guardadas y el material quedó completado.</p>
          </>
        ) : (
          <>
            <h3>Ya envió este formulario</h3>
            <p>Lo envió el {fechaLarga(enviadaEl)}. Las respuestas no se pueden modificar; si necesita corregir algo, pida a Talento Humano que lo reabra.</p>
          </>
        )}
        <button type='button' className='portal-th__certificado-boton' onClick={onCerrar}>
          Volver al curso
        </button>
      </div>
    );
  }

  return (
    <div className='portal-th__formulario' ref={desplazable} data-testid='formulario-propio'>
      {aviso && (
        <p
          className={`portal-th__resultado portal-th__resultado--${aviso.tipo} portal-th__formulario-aviso`}
          role={aviso.tipo === 'error' ? 'alert' : 'status'}
          data-testid='aviso-formulario'
        >
          {aviso.texto}
        </p>
      )}
      {previa && <p className='portal-th__aviso'>Vista previa del formador: puede llenarlo para probarlo; no se guarda nada.</p>}
      <div className='portal-th__formulario-encabezado'>
        <h3>{definicion.titulo}</h3>
        {definicion.descripcion && <p>{definicion.descripcion}</p>}
        <p className='portal-th__formulario-obligatorio-nota'>
          <span aria-hidden='true'>*</span> Obligatorio
        </p>
      </div>

      {definicion.autorizacion && (
        <section
          id={`fp-${ID_AUTORIZACION}`}
          className={`portal-th__formulario-autorizacion${errores[ID_AUTORIZACION] ? ' portal-th__formulario-pregunta--error' : ''}`}
          aria-labelledby='fp-autorizacion-titulo'
        >
          <h4 id='fp-autorizacion-titulo'>{definicion.autorizacion.titulo}</h4>
          {definicion.autorizacion.pendienteValidacion && (
            <p className='portal-th__formulario-pendiente' data-testid='autorizacion-pendiente'>
              Texto pendiente de validación por Talento Humano o Jurídica
            </p>
          )}
          <div className='portal-th__formulario-autorizacion-texto'>
            {definicion.autorizacion.texto.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          <label className='portal-th__formulario-casilla'>
            <input
              type='checkbox'
              checked={autoriza}
              aria-required='true'
              aria-invalid={!!errores[ID_AUTORIZACION]}
              onChange={(e) => {
                setAutoriza(e.target.checked);
                if (e.target.checked) setErrores((x) => ({ ...x, [ID_AUTORIZACION]: '' }));
              }}
            />
            <span>
              {definicion.autorizacion.casilla} <span className='portal-th__formulario-asterisco'>*</span>
            </span>
          </label>
          {errores[ID_AUTORIZACION] && <p className='portal-th__formulario-error'>{errores[ID_AUTORIZACION]}</p>}
        </section>
      )}

      <ol className='portal-th__formulario-preguntas'>
        {definicion.preguntas.map((p, i) => (
          <CampoPregunta
            key={p.id}
            numero={i + 1}
            pregunta={p}
            valor={valores[p.id]}
            error={errores[p.id]}
            soloLectura={p.prellenar === 'correo'}
            onCambio={(v) => ponerValor(p.id, v)}
          />
        ))}
      </ol>

      <div className='portal-th__formulario-pie'>
        <button
          type='button'
          className='portal-th__formulario-enviar'
          onClick={() => void enviar()}
          disabled={enviando}
          data-testid='enviar-formulario'
        >
          {enviando ? 'Enviando…' : 'Enviar'}
        </button>
      </div>
    </div>
  );
}

function CampoPregunta({
  numero,
  pregunta: p,
  valor,
  error,
  soloLectura,
  onCambio,
}: {
  numero: number;
  pregunta: PreguntaFormulario;
  valor: ValorRespuesta | undefined;
  error?: string;
  soloLectura: boolean;
  onCambio: (v: ValorRespuesta) => void;
}) {
  const idTitulo = `fp-${p.id}-titulo`;
  const idError = `fp-${p.id}-error`;
  const comun = {
    'aria-labelledby': idTitulo,
    'aria-required': p.obligatoria,
    'aria-invalid': !!error,
    'aria-describedby': error ? idError : undefined,
  };
  const texto = typeof valor === 'string' ? valor : '';
  const opciones = p.tipo === 'si_no' ? [...OPCIONES_SI_NO] : (p.opciones ?? []);
  const esOtra = typeof valor === 'object' && valor !== null;

  return (
    <li id={`fp-${p.id}`} className={`portal-th__formulario-pregunta${error ? ' portal-th__formulario-pregunta--error' : ''}`}>
      <div id={idTitulo} className='portal-th__formulario-titulo'>
        <span className='portal-th__formulario-numero'>{numero}.</span> {p.texto}
        {p.obligatoria && (
          <span className='portal-th__formulario-asterisco' aria-label='Respuesta necesaria'>
            {' '}
            *
          </span>
        )}
      </div>
      {p.ayuda && <p className='portal-th__formulario-ayuda'>{p.ayuda}</p>}

      {p.tipo === 'seleccion' || p.tipo === 'si_no' ? (
        <div role='radiogroup' {...comun} className='portal-th__formulario-opciones'>
          {opciones.map((o) => (
            <label key={o} className='portal-th__formulario-opcion'>
              <input type='radio' name={`fp-${p.id}`} checked={!esOtra && texto === o} onChange={() => onCambio(o)} />
              <span>{o}</span>
            </label>
          ))}
          {p.permiteOtra && (
            <div className='portal-th__formulario-opcion portal-th__formulario-opcion--otra'>
              <label>
                <input
                  type='radio'
                  name={`fp-${p.id}`}
                  checked={esOtra}
                  onChange={() => onCambio({ otra: esOtra ? (valor as { otra: string }).otra : '' })}
                />
                <span>Otra respuesta</span>
              </label>
              <input
                type='text'
                aria-label={`${p.texto}: otra respuesta`}
                placeholder='Otras'
                maxLength={2000}
                value={esOtra ? (valor as { otra: string }).otra : ''}
                onFocus={() => {
                  if (!esOtra) onCambio({ otra: '' });
                }}
                onChange={(e) => onCambio({ otra: e.target.value })}
              />
            </div>
          )}
        </div>
      ) : p.tipo === 'texto_largo' ? (
        <textarea {...comun} rows={4} maxLength={4000} placeholder='Escriba su respuesta' value={texto} onChange={(e) => onCambio(e.target.value)} />
      ) : (
        <input
          {...comun}
          type={p.tipo === 'fecha' ? 'date' : 'text'}
          inputMode={p.tipo === 'numero' ? 'decimal' : p.prellenar === 'correo' ? 'email' : undefined}
          autoComplete={p.prellenar === 'correo' ? 'email' : p.prellenar === 'nombre' ? 'name' : 'off'}
          placeholder={p.tipo === 'fecha' ? undefined : 'Escriba su respuesta'}
          maxLength={2000}
          readOnly={soloLectura}
          title={soloLectura ? 'Se toma del correo con el que ingresó al portal' : undefined}
          value={texto}
          onChange={(e) => onCambio(e.target.value)}
        />
      )}
      {error && (
        <p id={idError} className='portal-th__formulario-error'>
          {error}
        </p>
      )}
    </li>
  );
}

/* ─────────────────────── Respuestas (administradores/formadores) ─────────────────────── */

interface TablaRespuestas {
  curso: { id: number; titulo: string };
  material: { id: number; titulo: string };
  formulario: { codigo: string; titulo: string; version: number };
  columnas: { id: string; texto: string }[];
  filas: { id: number; correo: string; enviadaEl: string; version: number; autorizacionVersion: string | null; respuestas: Respuestas }[];
}

/**
 * Tabla de respuestas de UN material formulario, con exportación a Excel y
 * "Reabrir". Solo la ve quien esté en ADMINISTRADORES/FORMADORES del Excel de
 * permisos — el servidor lo vuelve a exigir en cada ruta (403).
 */
export function PanelRespuestas({ materialId, titulo, onCerrar, onCambio }: { materialId: number; titulo: string; onCerrar: () => void; onCambio?: () => Promise<void> | void }) {
  const [tabla, setTabla] = useState<TablaRespuestas | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('');

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/portal/materials/${materialId}/respuestas`, { cache: 'no-store' });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudieron cargar las respuestas.'));
      setTabla(data as unknown as TablaRespuestas);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [materialId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [onCerrar]);

  const reabrir = async (fila: TablaRespuestas['filas'][number]) => {
    if (
      !window.confirm(
        `¿Reabrir el formulario de ${fila.correo}? Se borran sus respuestas y la marca de completado de este material, y la persona deberá responderlo de nuevo.`
      )
    )
      return;
    setAviso(null);
    try {
      const res = await fetch(`/api/portal/materials/${materialId}/respuestas/${fila.id}`, { method: 'DELETE' });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo reabrir.'));
      setAviso(`Formulario reabierto para ${fila.correo}.`);
      await cargar();
      await onCambio?.();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const filas = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    if (!tabla || !f) return tabla?.filas ?? [];
    return tabla.filas.filter((x) =>
      [x.correo, ...Object.values(x.respuestas).map((v) => textoDeRespuesta(v))].some((t) => t.toLowerCase().includes(f))
    );
  }, [tabla, filtro]);

  return (
    <div
      className='portal-th__visor'
      role='dialog'
      aria-modal='true'
      aria-label={`Respuestas: ${titulo}`}
      data-testid='panel-respuestas'
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div className='portal-th__visor-caja portal-th__visor-caja--respuestas'>
        <header className='portal-th__visor-barra'>
          <strong>Respuestas · {titulo}</strong>
          <div className='portal-th__visor-acciones'>
            <button type='button' onClick={onCerrar} aria-label='Cerrar'>
              ✕
            </button>
          </div>
        </header>
        <div className='portal-th__respuestas-barra'>
          <span className='portal-th__respuestas-conteo' data-testid='conteo-respuestas'>
            {tabla ? `${tabla.filas.length} respuesta(s) · ${tabla.curso.titulo}` : 'Cargando…'}
          </span>
          <input
            type='search'
            aria-label='Buscar en las respuestas'
            placeholder='Buscar por correo o respuesta'
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
          />
          <a
            className='portal-th__certificado-boton portal-th__respuestas-exportar'
            href={`/api/portal/materials/${materialId}/respuestas/excel`}
            data-testid='exportar-excel'
          >
            ⬇ Exportar a Excel
          </a>
        </div>
        <p className='portal-th__respuestas-sensibles'>
          Datos personales sensibles (Ley 1581 de 2012): uso exclusivo de Talento Humano y del SG-SST. No los reenvíe ni los publique.
        </p>
        {error && (
          <p className='portal-th__resultado portal-th__resultado--error' role='alert'>
            {error}
          </p>
        )}
        {aviso && (
          <p className='portal-th__resultado portal-th__resultado--ok' role='status'>
            {aviso}
          </p>
        )}
        <div className='portal-th__respuestas-tabla-marco'>
          {tabla && tabla.filas.length === 0 ? (
            <p className='portal-th__estado'>Todavía nadie ha enviado este formulario.</p>
          ) : (
            tabla && (
              <table className='portal-th__correos-tabla portal-th__respuestas-tabla' data-testid='tabla-respuestas'>
                <thead>
                  <tr>
                    <th>Correo</th>
                    <th>Enviado</th>
                    {tabla.columnas.map((c, i) => (
                      <th key={c.id} title={`${i + 1}. ${c.texto}`}>
                        <span className='portal-th__respuestas-encabezado'>
                          {i + 1}. {c.texto}
                        </span>
                      </th>
                    ))}
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => (
                    <tr key={f.id}>
                      <td>{f.correo}</td>
                      <td>{fechaLarga(f.enviadaEl)}</td>
                      {tabla.columnas.map((c) => (
                        <td key={c.id}>{textoDeRespuesta(f.respuestas[c.id])}</td>
                      ))}
                      <td>
                        <button type='button' className='portal-th__boton-chico' onClick={() => void reabrir(f)}>
                          Reabrir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Formador: elegir / importar / editar ─────────────────────────── */

export interface FormularioResumen {
  id: number;
  codigo: string;
  titulo: string;
  version: number;
  materiales: number;
}

/**
 * Selector de formulario para un material nuevo tipo "Formulario", con
 * IMPORTAR (archivo .json o pegado), VISTA PREVIA y EDITAR (el JSON de la
 * definición; guardar crea una versión nueva). El editor visual pregunta por
 * pregunta queda para una entrega posterior.
 */
export function SelectorFormulario({
  valor,
  onCambio,
}: {
  valor: number | null;
  onCambio: (id: number | null, titulo: string) => void;
}) {
  const [lista, setLista] = useState<FormularioResumen[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ modo: 'importar' | 'editar'; texto: string; id?: number } | null>(null);
  const [erroresJson, setErroresJson] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [previa, setPrevia] = useState<DefinicionFormulario | null>(null);

  const cargar = useCallback(async (): Promise<FormularioResumen[]> => {
    try {
      const res = await fetch('/api/portal/formularios', { cache: 'no-store' });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudieron cargar los formularios.'));
      const l = Array.isArray(data.formularios) ? (data.formularios as FormularioResumen[]) : [];
      setLista(l);
      return l;
    } catch (e) {
      setError((e as Error).message);
      return [];
    }
  }, []);

  useEffect(() => {
    void cargar().then((l) => {
      if (valor === null && l.length > 0) onCambio(l[0].id, l[0].titulo);
    });
    // Solo al montar: elegir el primero por defecto.
  }, []);

  const definicionDe = async (id: number): Promise<DefinicionFormulario | null> => {
    const res = await fetch(`/api/portal/formularios/${id}`, { cache: 'no-store' });
    const data = await leerJson(res);
    if (!res.ok) {
      setError(String(data?.error ?? 'No se pudo cargar el formulario.'));
      return null;
    }
    return (data.formulario as { definicion: DefinicionFormulario }).definicion;
  };

  const verPrevia = async () => {
    if (!valor) return;
    setError(null);
    const d = await definicionDe(valor);
    if (d) setPrevia(d);
  };

  const empezarEdicion = async () => {
    if (!valor) return;
    setError(null);
    const d = await definicionDe(valor);
    if (d) setEditor({ modo: 'editar', id: valor, texto: JSON.stringify(d, null, 2) });
  };

  const guardar = async () => {
    if (!editor) return;
    setGuardando(true);
    setErroresJson([]);
    setError(null);
    try {
      const res = await fetch(editor.modo === 'importar' ? '/api/portal/formularios' : `/api/portal/formularios/${editor.id}`, {
        method: editor.modo === 'importar' ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: editor.texto,
      });
      const data = await leerJson(res);
      if (!res.ok) {
        setErroresJson(Array.isArray(data?.errores) ? (data.errores as string[]) : []);
        throw new Error(String(data?.error ?? 'No se pudo guardar.'));
      }
      const f = data.formulario as { id: number; titulo: string; version: number };
      setAviso(editor.modo === 'importar' ? `Formulario importado: ${f.titulo}.` : `Versión ${f.version} guardada: ${f.titulo}.`);
      setEditor(null);
      await cargar();
      onCambio(f.id, f.titulo);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className='portal-th__formulario-selector' data-testid='selector-formulario'>
      {lista && lista.length === 0 && <p className='portal-th__estado'>Todavía no hay formularios: importe uno.</p>}
      {lista && lista.length > 0 && (
        <select
          aria-label='Formulario'
          value={valor ?? ''}
          onChange={(e) => {
            const f = lista.find((x) => x.id === Number(e.target.value));
            onCambio(f ? f.id : null, f?.titulo ?? '');
          }}
        >
          {lista.map((f) => (
            <option key={f.id} value={f.id}>
              {f.titulo} · v{f.version}
            </option>
          ))}
        </select>
      )}
      <div className='portal-th__formulario-selector-acciones'>
        <button type='button' className='portal-th__boton-secundario' onClick={() => void verPrevia()} disabled={!valor}>
          Vista previa
        </button>
        <button type='button' className='portal-th__boton-secundario' onClick={() => void empezarEdicion()} disabled={!valor}>
          Editar (JSON)
        </button>
        <button
          type='button'
          className='portal-th__boton-secundario'
          onClick={() => {
            setErroresJson([]);
            setEditor({ modo: 'importar', texto: '' });
          }}
        >
          Importar formulario
        </button>
      </div>
      {aviso && (
        <p className='portal-th__resultado portal-th__resultado--ok' role='status'>
          {aviso}
        </p>
      )}
      {error && (
        <p className='portal-th__resultado portal-th__resultado--error' role='alert'>
          {error}
        </p>
      )}
      {editor && (
        <div className='portal-th__formulario-json'>
          <p className='portal-th__estado'>
            {editor.modo === 'importar'
              ? 'Pegue la definición JSON del formulario o cárguela desde un archivo .json.'
              : 'Al guardar se crea una versión nueva; las respuestas ya enviadas conservan la versión con la que se respondieron.'}
          </p>
          {editor.modo === 'importar' && (
            <input
              type='file'
              accept='application/json,.json'
              aria-label='Archivo JSON del formulario'
              onChange={async (e) => {
                const archivo = e.currentTarget.files?.[0];
                if (archivo) setEditor({ modo: 'importar', texto: await archivo.text() });
              }}
            />
          )}
          <textarea
            aria-label='Definición JSON del formulario'
            rows={12}
            spellCheck={false}
            value={editor.texto}
            onChange={(e) => setEditor({ ...editor, texto: e.target.value })}
          />
          {erroresJson.length > 0 && (
            <ul className='portal-th__formulario-json-errores'>
              {erroresJson.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <div className='portal-th__formacion-editar-acciones'>
            <button
              type='button'
              className='portal-th__boton-secundario'
              disabled={!editor.texto.trim()}
              onClick={() => {
                try {
                  setPrevia(JSON.parse(editor.texto) as DefinicionFormulario);
                  setErroresJson([]);
                } catch {
                  setErroresJson(['JSON mal formado.']);
                }
              }}
            >
              Vista previa del JSON
            </button>
            <button type='button' onClick={() => void guardar()} disabled={guardando || !editor.texto.trim()}>
              {guardando ? 'Guardando…' : editor.modo === 'importar' ? 'Importar' : 'Guardar versión nueva'}
            </button>
            <button type='button' className='portal-th__boton-secundario' onClick={() => setEditor(null)} disabled={guardando}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {previa && Array.isArray(previa.preguntas) && (
        <VisorFormulario titulo={`Vista previa · ${previa.titulo ?? ''}`} previa={previa} onCerrar={() => setPrevia(null)} />
      )}
    </div>
  );
}

/** Vista previa de un material formulario ya agregado (vista formador). */
export function PreviaDeMaterialFormulario({ formularioId, titulo, onCerrar }: { formularioId: number; titulo: string; onCerrar: () => void }) {
  const [definicion, setDefinicion] = useState<DefinicionFormulario | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/portal/formularios/${formularioId}`, { cache: 'no-store' });
      const data = await leerJson(res);
      if (!res.ok) setError(String(data?.error ?? 'No se pudo cargar el formulario.'));
      else setDefinicion((data.formulario as { definicion: DefinicionFormulario }).definicion);
    })();
  }, [formularioId]);
  if (error) {
    return (
      <p className='portal-th__resultado portal-th__resultado--error' role='alert'>
        {error}
      </p>
    );
  }
  if (!definicion) return null;
  return <VisorFormulario titulo={`Vista previa · ${titulo}`} previa={definicion} onCerrar={onCerrar} />;
}
