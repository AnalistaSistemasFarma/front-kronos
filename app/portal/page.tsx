'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * PORTAL DE TALENTO HUMANO.
 *
 * Pedido de Cristian Baldión (2026-09-09): un sitio donde cualquier
 * colaborador del grupo consulte las políticas y los reglamentos, y vea los
 * anuncios de Talento Humano.
 *
 * ESTA PÁGINA VIVE FUERA DE `(hub)` A PROPÓSITO. El portal no usa la sesión de
 * SynerLink: entra gente que no tiene usuario en la plataforma, y por eso su
 * ingreso es un código enviado al correo. Ponerla dentro del hub la habría
 * dejado detrás del login de SynerLink, que es justo lo que no queríamos.
 *
 * Sin dependencias de Mantine: es una página pública, y cuanto menos cargue,
 * mejor abre en un celular con mala señal.
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

const archivoUrl = (ruta: string) => `/api/portal/file?ruta=${encodeURIComponent(ruta)}`;

const pesoLegible = (bytes: number) =>
  bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

export default function PortalTalentoHumano() {
  const [cargando, setCargando] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);

  /* Ingreso */
  const [correo, setCorreo] = useState('');
  const [codigo, setCodigo] = useState('');
  const [pidioCodigo, setPidioCodigo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargarContenido = useCallback(async () => {
    try {
      const res = await fetch('/api/portal/content', { cache: 'no-store' });
      if (res.status === 401) {
        setEmail(null);
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
    void cargarContenido();
  }, [cargarContenido]);

  const pedirCodigo = async () => {
    setError(null);
    setAviso(null);
    setEnviando(true);
    try {
      const res = await fetch('/api/portal/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: correo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'No se pudo enviar el código.');
      setPidioCodigo(true);
      setAviso(data.mensaje);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  const validarCodigo = async () => {
    setError(null);
    setEnviando(true);
    try {
      const res = await fetch('/api/portal/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: correo, code: codigo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'No se pudo validar el código.');
      setCodigo('');
      setPidioCodigo(false);
      setCargando(true);
      await cargarContenido();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  const salir = async () => {
    await fetch('/api/portal/logout', { method: 'POST' });
    setEmail(null);
    setDocumentos([]);
    setBanners([]);
    setCorreo('');
    setPidioCodigo(false);
  };

  return (
    <div className='portal-th'>
      <header className='portal-th__barra'>
        <div className='portal-th__marca'>
          <span className='portal-th__logo'>GSS</span>
          <div>
            <h1>Portal de Talento Humano</h1>
            <p>Group Shared Services Latinoamérica</p>
          </div>
        </div>
        {email && (
          <div className='portal-th__sesion'>
            <span>{email}</span>
            <button type='button' onClick={salir}>
              Salir
            </button>
          </div>
        )}
      </header>

      <main className='portal-th__cuerpo'>
        {cargando && <p className='portal-th__estado'>Cargando…</p>}

        {!cargando && !email && (
          <section className='portal-th__ingreso'>
            <h2>Ingrese con su correo</h2>
            <p>
              Le enviamos un código de seis dígitos. Sirve una sola vez y vence en 10 minutos.
            </p>

            {!pidioCodigo ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void pedirCodigo();
                }}
              >
                <input
                  type='email'
                  inputMode='email'
                  autoComplete='email'
                  placeholder='nombre.apellido@empresa.com'
                  value={correo}
                  onChange={(e) => setCorreo(e.target.value)}
                  required
                />
                <button type='submit' disabled={enviando || correo.trim() === ''}>
                  {enviando ? 'Enviando…' : 'Enviarme el código'}
                </button>
              </form>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void validarCodigo();
                }}
              >
                <input
                  // `inputMode` numérico para que en el celular salga el teclado
                  // de números y no el alfabético.
                  inputMode='numeric'
                  pattern='[0-9]*'
                  maxLength={6}
                  autoComplete='one-time-code'
                  placeholder='000000'
                  className='portal-th__codigo'
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
                  required
                />
                <button type='submit' disabled={enviando || codigo.length !== 6}>
                  {enviando ? 'Validando…' : 'Entrar'}
                </button>
                <button
                  type='button'
                  className='portal-th__enlace'
                  onClick={() => {
                    setPidioCodigo(false);
                    setCodigo('');
                    setAviso(null);
                  }}
                >
                  Usar otro correo
                </button>
              </form>
            )}

            {aviso && <p className='portal-th__aviso'>{aviso}</p>}
            {error && <p className='portal-th__error'>{error}</p>}
          </section>
        )}

        {!cargando && email && (
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
        )}

        {!cargando && error && email && <p className='portal-th__error'>{error}</p>}
      </main>

      <footer className='portal-th__pie'>
        Group Shared Services Latinoamérica · Talento Humano
      </footer>
    </div>
  );
}
