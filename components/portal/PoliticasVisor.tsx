'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * VENTANA "VISUALIZAR" DE POLÍTICAS Y REGLAMENTOS.
 *
 * Pedido de Cristian Baldión (2026-10-08): un botón en la sección "Políticas y
 * reglamentos" que abra una ventana de vista previa con TODOS los archivos de
 * la carpeta POLITICAS Y REGLAMENTOS del SharePoint de Talento Humano.
 *
 * - Escritorio: lista a la izquierda y vista previa a la derecha.
 * - Celular: primero la lista; al elegir un archivo, la vista previa ocupa la
 *   ventana y un botón "← Documentos" vuelve a la lista.
 * - La vista previa es la de SharePoint (`driveItem/preview`) en un <iframe>:
 *   se ve el documento dentro del portal, sin forzar una descarga, y sirve
 *   también para Word, Excel y PowerPoint.
 * - Subcarpetas: el servidor las aplana; aquí se agrupan bajo su nombre.
 *
 * Sin Mantine a propósito: este componente también se pinta en `/portal`, la
 * página pública sin `MantineProvider` (ver `app/portal/page.tsx`). Usa las
 * clases `portal-th__*` del resto del portal para verse igual.
 */

export interface ArchivoPoliticaCliente {
  id: string;
  nombre: string;
  tipo: string;
  mime: string | null;
  tamano: number;
  modificado: string | null;
  carpeta: string;
  vistaPrevia: string;
}

/** Igual que `leerJson` de PortalContenido: una página HTML de error no revienta. */
async function leerJsonSeguro(res: Response): Promise<Record<string, unknown>> {
  const texto = await res.text();
  try {
    return texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
  } catch {
    throw new Error(
      res.ok
        ? 'El servidor respondió algo inesperado. Intente de nuevo en un momento.'
        : 'El servicio no está disponible en este momento. Intente de nuevo en un minuto.'
    );
  }
}

export function tamanoLegible(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

function fechaLegible(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'America/Bogota' });
}

const sinExtension = (nombre: string) => nombre.replace(/\.[^.]+$/, '');

export default function PoliticasVisor({ onCerrar }: { onCerrar: () => void }) {
  const [archivos, setArchivos] = useState<ArchivoPoliticaCliente[] | null>(null);
  const [truncado, setTruncado] = useState(false);
  const [cargandoLista, setCargandoLista] = useState(true);
  const [errorLista, setErrorLista] = useState<string | null>(null);

  const [seleccionado, setSeleccionado] = useState<ArchivoPoliticaCliente | null>(null);
  const [urlVista, setUrlVista] = useState<string | null>(null);
  const [cargandoVista, setCargandoVista] = useState(false);
  const [errorVista, setErrorVista] = useState<string | null>(null);
  // Cada clic pide una URL nueva; si la persona cambia de archivo antes de que
  // llegue la anterior, la respuesta vieja se descarta.
  const pedidoVista = useRef(0);

  const cargarLista = useCallback(async () => {
    setCargandoLista(true);
    setErrorLista(null);
    try {
      const res = await fetch('/api/portal/politicas', { cache: 'no-store' });
      const data = await leerJsonSeguro(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo cargar la carpeta de políticas.'));
      setArchivos(Array.isArray(data.archivos) ? (data.archivos as ArchivoPoliticaCliente[]) : []);
      setTruncado(data.truncado === true);
    } catch (e) {
      setErrorLista((e as Error).message);
    } finally {
      setCargandoLista(false);
    }
  }, []);

  useEffect(() => {
    void cargarLista();
  }, [cargarLista]);

  const abrir = useCallback(async (archivo: ArchivoPoliticaCliente) => {
    const n = ++pedidoVista.current;
    setSeleccionado(archivo);
    setUrlVista(null);
    setErrorVista(null);
    setCargandoVista(true);
    try {
      const res = await fetch(archivo.vistaPrevia, { cache: 'no-store' });
      const data = await leerJsonSeguro(res);
      if (!res.ok || typeof data.url !== 'string') {
        throw new Error(String(data?.error ?? 'No se pudo preparar la vista previa del documento.'));
      }
      if (n === pedidoVista.current) setUrlVista(data.url);
    } catch (e) {
      if (n === pedidoVista.current) setErrorVista((e as Error).message);
    } finally {
      if (n === pedidoVista.current) setCargandoVista(false);
    }
  }, []);

  const volverALista = () => {
    pedidoVista.current++;
    setSeleccionado(null);
    setUrlVista(null);
    setErrorVista(null);
    setCargandoVista(false);
  };

  // Escape cierra y el fondo no se desplaza mientras la ventana está abierta,
  // igual que la vista previa de documentos y la ventana de Contactos.
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
    };
    window.addEventListener('keydown', alTeclear);
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', alTeclear);
      document.body.style.overflow = overflowPrevio;
    };
  }, [onCerrar]);

  const grupos = useMemo(() => {
    const mapa = new Map<string, ArchivoPoliticaCliente[]>();
    for (const a of archivos ?? []) {
      const lista = mapa.get(a.carpeta) ?? [];
      lista.push(a);
      mapa.set(a.carpeta, lista);
    }
    return [...mapa.entries()];
  }, [archivos]);

  return (
    <div
      className='portal-th__visor'
      role='dialog'
      aria-modal='true'
      aria-label='Políticas y reglamentos'
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div
        className={`portal-th__visor-caja portal-th__politicas${seleccionado ? ' portal-th__politicas--viendo' : ''}`}
        data-testid='politicas-visor'
      >
        <header className='portal-th__visor-barra'>
          <strong>{seleccionado ? sinExtension(seleccionado.nombre) : 'Políticas y reglamentos'}</strong>
          <div className='portal-th__visor-acciones'>
            {urlVista && (
              <a href={urlVista} target='_blank' rel='noopener noreferrer'>
                Abrir aparte
              </a>
            )}
            <button type='button' onClick={onCerrar} aria-label='Cerrar'>
              ✕
            </button>
          </div>
        </header>

        <div className='portal-th__politicas-cuerpo'>
          <nav className='portal-th__politicas-lista' aria-label='Documentos de políticas y reglamentos'>
            {cargandoLista && <p className='portal-th__estado'>Cargando documentos…</p>}
            {errorLista && (
              <div className='portal-th__alerta portal-th__alerta--error' role='alert'>
                <span>{errorLista}</span>
                <button type='button' onClick={() => void cargarLista()}>
                  Reintentar
                </button>
              </div>
            )}
            {!cargandoLista && !errorLista && archivos?.length === 0 && (
              <p className='portal-th__estado'>La carpeta de políticas y reglamentos está vacía por ahora.</p>
            )}
            {truncado && (
              <div className='portal-th__alerta portal-th__alerta--aviso' role='status'>
                Hay más documentos de los que se pueden mostrar aquí.
              </div>
            )}
            {!errorLista &&
              grupos.map(([carpeta, lista]) => (
                <div key={carpeta || '(raiz)'} className='portal-th__politicas-grupo'>
                  {carpeta && <h3 className='portal-th__politicas-carpeta'>{carpeta.replaceAll('/', ' › ')}</h3>}
                  <ul>
                    {lista.map((a) => (
                      <li key={a.id}>
                        <button
                          type='button'
                          className={`portal-th__politicas-item${seleccionado?.id === a.id ? ' portal-th__politicas-item--activo' : ''}`}
                          aria-current={seleccionado?.id === a.id ? 'true' : undefined}
                          onClick={() => void abrir(a)}
                        >
                          <span className='portal-th__politicas-tipo' aria-hidden='true'>
                            {(a.tipo || 'doc').slice(0, 4).toUpperCase()}
                          </span>
                          <span className='portal-th__politicas-texto'>
                            <span className='portal-th__politicas-nombre'>{sinExtension(a.nombre)}</span>
                            <span className='portal-th__politicas-meta'>
                              {[tamanoLegible(a.tamano), fechaLegible(a.modificado)].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </nav>

          <section className='portal-th__politicas-vista' aria-live='polite'>
            {seleccionado && (
              <button type='button' className='portal-th__politicas-volver' onClick={volverALista}>
                ← Documentos
              </button>
            )}
            {!seleccionado && (
              <p className='portal-th__estado portal-th__politicas-indicacion'>
                Elija un documento de la lista para verlo aquí.
              </p>
            )}
            {seleccionado && cargandoVista && <p className='portal-th__estado'>Preparando la vista previa…</p>}
            {seleccionado && errorVista && (
              <div className='portal-th__alerta portal-th__alerta--error' role='alert'>
                <span>{errorVista}</span>
                <button type='button' onClick={() => void abrir(seleccionado)}>
                  Reintentar
                </button>
              </div>
            )}
            {seleccionado && urlVista && (
              <iframe key={urlVista} src={urlVista} title={seleccionado.nombre} allow='fullscreen' />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
