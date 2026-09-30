'use client';

import { useCallback, useEffect, useState } from 'react';
import PortalFormacion from './PortalFormacion';
import PortalNavegacion, { useSeccionActiva, type SeccionNav } from './PortalNavegacion';

/** Cada cuánto rota sola la imagen principal del carrusel de anuncios. */
const ROTACION_CARRUSEL_MS = 6000;

/** ids estables de sección, para el panel de navegación y el scroll-spy. */
const ID_SECCION_ANUNCIOS = 'portal-th-anuncios';
const ID_SECCION_POLITICAS = 'portal-th-politicas';
/** Sección nueva "tipo Moodle" — cursos, materiales, progreso y certificado.
 *  Pedido de Cristian (2026-09-18). Va al final, después de Políticas. */
const ID_SECCION_FORMACION = 'portal-th-formacion';
/** No es una sección con scroll: es un botón del panel que abre su propia
 *  ventana de vista previa (ver `irASeccion`), igual que un documento. */
const ID_SECCION_CONTACTOS = 'portal-th-contactos';

/**
 * EL CONTENIDO DEL PORTAL DE TALENTO HUMANO — anuncios y documentos.
 *
 * Vive aparte porque se pinta en DOS sitios y tiene que verse igual en los
 * dos: el módulo dentro del hub de SynerLink (`/process/portal-th`) y el
 * portal abierto con código al correo (`/portal`). Duplicarlo llevaría a que
 * uno de los dos se quede sin los arreglos del otro — el mismo criterio que ya
 * se usó con el cuadro de crear grupo en el chat.
 *
 * Lo único que cambia entre los dos es CÓMO se identifica la persona, y de eso
 * no sabe nada este componente: pide `/api/portal/content` y el servidor
 * resuelve por dónde entró.
 */

interface Documento {
  titulo: string;
  ruta: string;
  tamano: number;
  modificado: string;
  portada: string | null;
}
interface Banner {
  id: number;
  titulo: string;
  /** Los anuncios se sirven desde la base, no desde SharePoint. */
  url: string;
}
/** Un correo con licencia activa de M365, agrupado por empresa. */
interface GrupoCorreo {
  empresa: string;
  dominio: string;
  /** 'sin_acceso' = todavía no hay conector configurado para ese tenant. */
  estado: 'ok' | 'sin_acceso';
  usuarios: { nombre: string; correo: string }[];
}

/**
 * Lee la respuesta como JSON SIN reventar cuando no lo es.
 *
 * Pasa de verdad: si el servidor está reiniciándose —un despliegue, por
 * ejemplo— responde una página de error en HTML, y `res.json()` lanza
 * «Unexpected token '<'». Al usuario le aparecía ese texto tal cual, que no
 * le dice nada y parece un error de la aplicación. Le pasó a Cristian el
 * 2026-09-09 justo mientras se desplegaba pruebas.
 */
export async function leerJson(res: Response): Promise<Record<string, unknown>> {
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

/** Lo que la ventana de vista previa necesita saber, sea PDF o anuncio. */
interface Vista {
  titulo: string;
  url: string;
  esImagen: boolean;
}

/** Ancho al que se reduce un anuncio antes de subirlo. */
const ANCHO_MAXIMO = 1600;

export const archivoUrl = (ruta: string) => `/api/portal/file?ruta=${encodeURIComponent(ruta)}`;

export interface EstadoPortal {
  cargando: boolean;
  /** null = no identificado; el contenedor decide qué hacer con eso. */
  email: string | null;
  error: string | null;
  recargar: () => Promise<void>;
}

/** Trae el contenido. Lo usan las dos pantallas. */
export function usePortalContenido(): EstadoPortal & {
  documentos: Documento[];
  banners: Banner[];
  puedeEditar: boolean;
} {
  const [cargando, setCargando] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  // Si esta persona puede cargar y quitar anuncios. Lo dice el servidor: la
  // interfaz no lo adivina de una lista de correos propia.
  const [puedeEditar, setPuedeEditar] = useState(false);

  const recargar = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/portal/content', { cache: 'no-store' });
      if (res.status === 401) {
        setEmail(null);
        setDocumentos([]);
        setBanners([]);
        return;
      }
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo cargar el contenido.'));
      setEmail(typeof data.email === 'string' ? data.email : null);
      setDocumentos(Array.isArray(data.documentos) ? (data.documentos as Documento[]) : []);
      setBanners(Array.isArray(data.banners) ? (data.banners as Banner[]) : []);
      setPuedeEditar(data.puedeEditar === true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  return { cargando, email, error, recargar, documentos, banners, puedeEditar };
}

export default function PortalContenido({
  documentos,
  banners,
  puedeEditar = false,
  onCambioEnBanners,
}: {
  documentos: Documento[];
  banners: Banner[];
  /** Solo Talento Humano administra la cartelera. */
  puedeEditar?: boolean;
  onCambioEnBanners?: () => void | Promise<void>;
}) {
  const [subiendo, setSubiendo] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // ── Carrusel de anuncios ────────────────────────────────────────────────
  // Índice de la imagen "principal" que se ve ahora mismo. Pedido de Cristian
  // (2026-09-10): que se vea una imagen a la vez y vayan rotando solas entre
  // todas las cargadas, no una grilla con todas al tiempo.
  const [indiceCarrusel, setIndiceCarrusel] = useState(0);

  // Si se borra un anuncio (o llega una lista más corta) y el índice quedó
  // apuntando fuera de rango, vuelve al principio en vez de dejar el
  // carrusel en blanco.
  useEffect(() => {
    if (indiceCarrusel >= banners.length && banners.length > 0) setIndiceCarrusel(0);
  }, [banners.length, indiceCarrusel]);

  useEffect(() => {
    if (banners.length <= 1) return;
    const temporizador = setInterval(() => {
      setIndiceCarrusel((i) => (i + 1) % banners.length);
    }, ROTACION_CARRUSEL_MS);
    // Se reinicia también cuando la persona navega a mano (cambia
    // `indiceCarrusel`): así no rota sola justo un segundo después de que
    // alguien eligió ver otro anuncio.
    return () => clearInterval(temporizador);
  }, [banners.length, indiceCarrusel]);

  /**
   * Reduce la imagen antes de subirla: 1600 px de ancho es de sobra para una
   * cartelera y evita meter en la base la foto de 8 MB que salió del celular.
   * Se hace en el navegador porque en el servidor pediría una dependencia
   * nativa y aquí el `canvas` ya está. El tope se revisa igual del otro lado.
   */
  const reducir = (archivo: File): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(archivo);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const escala = Math.min(1, ANCHO_MAXIMO / img.width);
        if (escala === 1 && archivo.size <= 2 * 1024 * 1024) {
          resolve(archivo);
          return;
        }
        const lienzo = document.createElement('canvas');
        lienzo.width = Math.round(img.width * escala);
        lienzo.height = Math.round(img.height * escala);
        const ctx = lienzo.getContext('2d');
        if (!ctx) {
          reject(new Error('El navegador no pudo procesar la imagen.'));
          return;
        }
        ctx.drawImage(img, 0, 0, lienzo.width, lienzo.height);
        lienzo.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('No se pudo convertir la imagen.'))),
          'image/jpeg',
          0.86
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Ese archivo no parece una imagen.'));
      };
      img.src = url;
    });

  const subirBanner = async (archivo: File) => {
    setErrorBanner(null);
    setSubiendo(true);
    try {
      const reducida = await reducir(archivo);
      const cuerpo = new FormData();
      cuerpo.append('file', new File([reducida], archivo.name, { type: reducida.type || archivo.type }));
      const res = await fetch('/api/portal/banners', { method: 'POST', body: cuerpo });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo cargar el anuncio.'));
      await onCambioEnBanners?.();
    } catch (e) {
      setErrorBanner((e as Error).message);
    } finally {
      setSubiendo(false);
    }
  };

  const quitarBanner = async (id: number) => {
    // Borra de verdad y no hay papelera: una ✕ mal picada en el celular no
    // debería desaparecer el anuncio de toda la empresa.
    if (!window.confirm('¿Quitar este anuncio del portal?')) return;
    setErrorBanner(null);
    try {
      const res = await fetch(`/api/portal/banners/${id}`, { method: 'DELETE' });
      const data = await leerJson(res);
      if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo quitar el anuncio.'));
      await onCambioEnBanners?.();
    } catch (e) {
      setErrorBanner((e as Error).message);
    }
  };

  /**
   * Lo que se está viendo en la ventana de vista previa, o null.
   *
   * No es "un documento": desde el 2026-09-09 también se abren así los
   * anuncios de la cartelera, a pedido de Cristian. Por eso el estado guarda
   * lo mínimo que la ventana necesita —título, dirección y si es imagen— y no
   * la fila entera de un tipo u otro.
   */
  const [abierto, setAbierto] = useState<Vista | null>(null);

  /**
   * Ventana de "Contactos". Pedido de Cristian (2026-09-14): un botón propio
   * en el panel que abre una vista previa con dos botones adentro —"Correos
   * Corporativos" y "Extensiones Corporativas"— sin contenido todavía; avisó
   * que luego cuenta de dónde sale la información de cada uno.
   */
  const [contactosAbierto, setContactosAbierto] = useState(false);
  const [contactoSeleccionado, setContactoSeleccionado] = useState<'correos' | 'extensiones' | null>(null);
  const cerrarContactos = () => {
    setContactosAbierto(false);
    setContactoSeleccionado(null);
  };

  // ── "Correos Corporativos" dentro de Contactos ──────────────────────────
  // Se pide la primera vez que se abre esa opción, no al abrir la ventana de
  // Contactos entera (nadie pide "Extensiones" el 100% de las veces).
  const [correosGrupos, setCorreosGrupos] = useState<GrupoCorreo[] | null>(null);
  const [correosCargando, setCorreosCargando] = useState(false);
  const [correosError, setCorreosError] = useState<string | null>(null);

  useEffect(() => {
    if (contactoSeleccionado !== 'correos' || correosGrupos !== null || correosCargando) return;
    let cancelado = false;
    setCorreosCargando(true);
    setCorreosError(null);
    (async () => {
      try {
        const res = await fetch('/api/portal/contactos/correos', { cache: 'no-store' });
        const data = await leerJson(res);
        if (!res.ok) throw new Error(String(data?.error ?? 'No se pudo cargar la lista.'));
        if (!cancelado) setCorreosGrupos(Array.isArray(data.grupos) ? (data.grupos as GrupoCorreo[]) : []);
      } catch (e) {
        if (!cancelado) setCorreosError((e as Error).message);
      } finally {
        if (!cancelado) setCorreosCargando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [contactoSeleccionado, correosGrupos, correosCargando]);

  // Cerrar con Escape: en una ventana que tapa la pantalla, buscar la ✕ con el
  // mouse cuando uno solo quería salir es incómodo.
  useEffect(() => {
    if (!abierto) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(null);
    };
    window.addEventListener('keydown', alTeclear);
    // Mientras la vista previa está abierta, el fondo no se desplaza: si no,
    // uno cree que mueve el documento y está moviendo la página de atrás.
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', alTeclear);
      document.body.style.overflow = overflowPrevio;
    };
  }, [abierto]);

  // Mismo tratamiento de Escape y bloqueo de scroll que la vista previa de
  // documentos, para la ventana de Contactos.
  useEffect(() => {
    if (!contactosAbierto) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cerrarContactos();
    };
    window.addEventListener('keydown', alTeclear);
    const overflowPrevio = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', alTeclear);
      document.body.style.overflow = overflowPrevio;
    };
  }, [contactosAbierto]);

  // ── Panel de navegación ─────────────────────────────────────────────────
  // Misma condición que ya decide si se pinta la sección de Anuncios: si no
  // hay ninguno y esta persona no administra, ese botón tampoco tiene sentido.
  const mostrarAnuncios = banners.length > 0 || puedeEditar;
  const secciones: SeccionNav[] = [
    ...(mostrarAnuncios ? [{ id: ID_SECCION_ANUNCIOS, etiqueta: 'Anuncios' }] : []),
    { id: ID_SECCION_POLITICAS, etiqueta: 'Políticas y reglamentos' },
    { id: ID_SECCION_FORMACION, etiqueta: 'Formación' },
    { id: ID_SECCION_CONTACTOS, etiqueta: 'Contactos' },
    // Cuando el portal tenga más secciones, se agregan acá — el panel de
    // navegación no necesita ningún otro cambio.
  ];
  // Contactos no tiene sección propia en la página (no hay `getElementById`
  // que la encuentre), así que nunca queda "activa" por scroll — eso está
  // bien: no navega, abre su ventana.
  const idsSecciones = secciones.map((s) => s.id);
  const activa = useSeccionActiva(idsSecciones);

  const irASeccion = (id: string) => {
    if (id === ID_SECCION_CONTACTOS) {
      setContactosAbierto(true);
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <>
      <div className='portal-th__layout'>
        <PortalNavegacion secciones={secciones} activa={activa} onSeleccionar={irASeccion} />

        <div className='portal-th__contenido'>
          {/* La sección se pinta si hay anuncios O si esta persona los administra:
              quien puede cargar tiene que ver dónde hacerlo aunque no haya
              ninguno todavía. */}
          {mostrarAnuncios && (
            <section id={ID_SECCION_ANUNCIOS} className='portal-th__seccion'>
              <div className='portal-th__seccion-barra'>
                <h2>Anuncios</h2>
                {puedeEditar && (
                  <label className='portal-th__cargar'>
                    {subiendo ? 'Cargando…' : '+ Agregar anuncio'}
                    <input
                      type='file'
                      accept='image/jpeg,image/png,image/webp'
                      disabled={subiendo}
                      onChange={(e) => {
                        const f = e.currentTarget.files?.[0];
                        e.currentTarget.value = '';
                        if (f) void subirBanner(f);
                      }}
                    />
                  </label>
                )}
              </div>

              {errorBanner && <p className='portal-th__error'>{errorBanner}</p>}

              {banners.length === 0 ? (
                <p className='portal-th__estado'>
                  Todavía no hay anuncios. Cargue una imagen y la verá aquí toda la empresa.
                </p>
              ) : (
                <div className='portal-th__carrusel'>
                  {/* Se ve UNA imagen "principal" a la vez, con transición suave,
                      y rota sola cada pocos segundos entre todas las cargadas —
                      pedido de Cristian (2026-09-10). El `key={actual.id}` es lo
                      que dispara la animación de entrada en cada cambio. */}
                  <div className='portal-th__carrusel-marco'>
                    {(() => {
                      const actual = banners[Math.min(indiceCarrusel, banners.length - 1)];
                      return (
                        <button
                          key={actual.id}
                          type='button'
                          className='portal-th__carrusel-abrir'
                          onClick={() => setAbierto({ titulo: actual.titulo, url: actual.url, esImagen: true })}
                          aria-label={`Ver ${actual.titulo}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            className='portal-th__carrusel-imagen'
                            src={actual.url}
                            alt={actual.titulo}
                          />
                        </button>
                      );
                    })()}
                    {puedeEditar && (
                      <button
                        type='button'
                        className='portal-th__banner-quitar'
                        onClick={() => void quitarBanner(banners[Math.min(indiceCarrusel, banners.length - 1)].id)}
                        aria-label={`Quitar ${banners[Math.min(indiceCarrusel, banners.length - 1)].titulo}`}
                        title='Quitar este anuncio'
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Puntos para saltar a un anuncio puntual sin esperar la
                      rotación. Con uno solo no hace falta mostrarlos. */}
                  {banners.length > 1 && (
                    <div className='portal-th__carrusel-puntos' role='tablist' aria-label='Anuncios'>
                      {banners.map((b, i) => (
                        <button
                          key={b.id}
                          type='button'
                          role='tab'
                          aria-selected={i === indiceCarrusel}
                          aria-label={`Ver anuncio: ${b.titulo}`}
                          className={`portal-th__carrusel-punto${i === indiceCarrusel ? ' portal-th__carrusel-punto--activo' : ''}`}
                          onClick={() => setIndiceCarrusel(i)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          <section id={ID_SECCION_POLITICAS} className='portal-th__seccion'>
            <h2>Políticas y reglamentos</h2>
            {documentos.length === 0 ? (
              <p className='portal-th__estado'>Todavía no hay documentos publicados.</p>
            ) : (
              <div className='portal-th__tarjetas'>
                {documentos.map((d) => (
                  <button
                    type='button'
                    key={d.ruta}
                    className='portal-th__tarjeta'
                    onClick={() =>
                      setAbierto({ titulo: d.titulo, url: archivoUrl(d.ruta), esImagen: false })
                    }
                    aria-label={`Ver ${d.titulo}`}
                  >
                    {d.portada ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={archivoUrl(d.portada)} alt='' loading='lazy' />
                    ) : (
                      <div className='portal-th__sinportada'>PDF</div>
                    )}
                    {/* Sin el peso del archivo: a quien entra a leer una política no
                        le dice nada saber que pesa 3 MB, y llenaba el renglón de
                        ruido. Pedido de Cristian (2026-09-09). */}
                    <div className='portal-th__tarjeta-pie'>
                      <strong>{d.titulo}</strong>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* FORMACIÓN — sección nueva "tipo Moodle" al final de la página
              (pedido de Cristian, 2026-09-18): cursos, materiales, progreso y
              certificado. Vive en su propio componente porque hace sus
              propios fetch — ver `PortalFormacion.tsx`. */}
          <section id={ID_SECCION_FORMACION} className='portal-th__seccion'>
            <h2>Formación</h2>
            <PortalFormacion />
          </section>
        </div>
      </div>

      {/* VISTA PREVIA dentro del portal.
          El PDF se muestra en un marco con el visor del propio navegador. Se
          deja SIEMPRE el enlace "abrir aparte": en el iPhone, Safari a veces
          no pinta un PDF dentro de un marco, y sin esa salida la persona se
          queda mirando un recuadro en blanco sin saber qué hacer. */}
      {abierto && (
        <div
          className='portal-th__visor'
          role='dialog'
          aria-modal='true'
          aria-label={abierto.titulo}
          onClick={(e) => {
            // Solo cierra si se toca el fondo, no el documento.
            if (e.target === e.currentTarget) setAbierto(null);
          }}
        >
          <div className='portal-th__visor-caja'>
            <header className='portal-th__visor-barra'>
              <strong>{abierto.titulo}</strong>
              <div className='portal-th__visor-acciones'>
                <a href={abierto.url} target='_blank' rel='noopener noreferrer'>
                  Abrir aparte
                </a>
                <button type='button' onClick={() => setAbierto(null)} aria-label='Cerrar'>
                  ✕
                </button>
              </div>
            </header>
            {/* Una imagen NO va en un marco: el navegador la pondría arriba a
                la izquierda, a tamaño real y con barras de desplazamiento. Se
                pinta directa y se deja que quepa entera. */}
            {abierto.esImagen ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className='portal-th__visor-imagen' src={abierto.url} alt={abierto.titulo} />
            ) : (
              <iframe src={abierto.url} title={abierto.titulo} />
            )}
          </div>
        </div>
      )}

      {/* VENTANA DE CONTACTOS — mismo marco que la vista previa de documentos,
          pero con dos botones adentro en vez de un PDF. Sin contenido todavía:
          Cristian confirma después de dónde sale cada uno (SharePoint o
          directorio de Microsoft 365). */}
      {contactosAbierto && (
        <div
          className='portal-th__visor'
          role='dialog'
          aria-modal='true'
          aria-label='Contactos'
          onClick={(e) => {
            if (e.target === e.currentTarget) cerrarContactos();
          }}
        >
          <div
            className={
              contactoSeleccionado === 'correos'
                ? 'portal-th__visor-caja portal-th__visor-caja--contactos portal-th__visor-caja--contactos-tabla'
                : 'portal-th__visor-caja portal-th__visor-caja--contactos'
            }
          >
            <header className='portal-th__visor-barra'>
              <strong>Contactos</strong>
              <div className='portal-th__visor-acciones'>
                <button type='button' onClick={cerrarContactos} aria-label='Cerrar'>
                  ✕
                </button>
              </div>
            </header>
            <div className='portal-th__contactos'>
              <button
                type='button'
                className='portal-th__contactos-boton'
                onClick={() => setContactoSeleccionado('correos')}
              >
                Correos Corporativos
              </button>
              <button
                type='button'
                className='portal-th__contactos-boton'
                onClick={() => setContactoSeleccionado('extensiones')}
              >
                Extensiones Corporativas
              </button>

              {contactoSeleccionado === 'extensiones' && (
                <p className='portal-th__estado'>Todavía no hay contenido cargado para Extensiones Corporativas.</p>
              )}

              {contactoSeleccionado === 'correos' && (
                <div className='portal-th__correos'>
                  {correosCargando && <p className='portal-th__estado'>Cargando correos corporativos…</p>}
                  {correosError && <p className='portal-th__error'>{correosError}</p>}
                  {correosGrupos &&
                    correosGrupos.map((grupo) => (
                      <section key={grupo.dominio} className='portal-th__correos-grupo'>
                        <h4 className='portal-th__correos-empresa'>
                          {grupo.empresa}
                          <span className='portal-th__correos-dominio'> · {grupo.dominio}</span>
                        </h4>
                        {grupo.estado === 'sin_acceso' ? (
                          <p className='portal-th__estado'>Sin acceso configurado para este tenant.</p>
                        ) : grupo.usuarios.length === 0 ? (
                          <p className='portal-th__estado'>Sin usuarios con licencia activa.</p>
                        ) : (
                          <table className='portal-th__correos-tabla'>
                            <thead>
                              <tr>
                                <th>Nombre</th>
                                <th>Correo</th>
                              </tr>
                            </thead>
                            <tbody>
                              {grupo.usuarios.map((u) => (
                                <tr key={u.correo}>
                                  <td>{u.nombre}</td>
                                  <td>{u.correo}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </section>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

