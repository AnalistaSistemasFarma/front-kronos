'use client';

import { useCallback, useEffect, useState } from 'react';

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

  // El documento que se está viendo, o null. Pedido de Cristian (2026-09-09):
  // que abrir un documento no lo saque del portal a otra pestaña.
  const [abierto, setAbierto] = useState<Documento | null>(null);

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

  return (
    <>
      {/* La sección se pinta si hay anuncios O si esta persona los administra:
          quien puede cargar tiene que ver dónde hacerlo aunque no haya
          ninguno todavía. */}
      {(banners.length > 0 || puedeEditar) && (
        <section className='portal-th__seccion'>
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
            <div className='portal-th__banners'>
              {banners.map((b) => (
                <figure key={b.id} className='portal-th__banner'>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={b.url} alt={b.titulo} loading='lazy' />
                  {puedeEditar && (
                    <button
                      type='button'
                      className='portal-th__banner-quitar'
                      onClick={() => void quitarBanner(b.id)}
                      aria-label={`Quitar ${b.titulo}`}
                      title='Quitar este anuncio'
                    >
                      ✕
                    </button>
                  )}
                </figure>
              ))}
            </div>
          )}
        </section>
      )}

      <section className='portal-th__seccion'>
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
                onClick={() => setAbierto(d)}
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
                <a href={archivoUrl(abierto.ruta)} target='_blank' rel='noopener noreferrer'>
                  Abrir aparte
                </a>
                <button type='button' onClick={() => setAbierto(null)} aria-label='Cerrar'>
                  ✕
                </button>
              </div>
            </header>
            <iframe src={archivoUrl(abierto.ruta)} title={abierto.titulo} />
          </div>
        </div>
      )}
    </>
  );
}
