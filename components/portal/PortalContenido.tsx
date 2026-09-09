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
  titulo: string;
  ruta: string;
  modificado: string;
}

export const archivoUrl = (ruta: string) => `/api/portal/file?ruta=${encodeURIComponent(ruta)}`;

const pesoLegible = (bytes: number) =>
  bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

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
} {
  const [cargando, setCargando] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);

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
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'No se pudo cargar el contenido.');
      setEmail(data.email);
      setDocumentos(data.documentos ?? []);
      setBanners(data.banners ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  return { cargando, email, error, recargar, documentos, banners };
}

export default function PortalContenido({
  documentos,
  banners,
}: {
  documentos: Documento[];
  banners: Banner[];
}) {
  return (
    <>
      {banners.length > 0 && (
        <section className='portal-th__seccion'>
          <h2>Anuncios</h2>
          <div className='portal-th__banners'>
            {banners.map((b) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={b.ruta} src={archivoUrl(b.ruta)} alt={b.titulo} loading='lazy' />
            ))}
          </div>
        </section>
      )}

      <section className='portal-th__seccion'>
        <h2>Políticas y reglamentos</h2>
        {documentos.length === 0 ? (
          <p className='portal-th__estado'>Todavía no hay documentos publicados.</p>
        ) : (
          <div className='portal-th__tarjetas'>
            {documentos.map((d) => (
              <a
                key={d.ruta}
                className='portal-th__tarjeta'
                href={archivoUrl(d.ruta)}
                target='_blank'
                rel='noopener noreferrer'
              >
                {d.portada ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={archivoUrl(d.portada)} alt='' loading='lazy' />
                ) : (
                  <div className='portal-th__sinportada'>PDF</div>
                )}
                <div className='portal-th__tarjeta-pie'>
                  <strong>{d.titulo}</strong>
                  <span>{pesoLegible(d.tamano)}</span>
                </div>
              </a>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
