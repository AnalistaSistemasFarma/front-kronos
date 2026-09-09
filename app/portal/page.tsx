'use client';

import { useState } from 'react';
import PortalContenido, { usePortalContenido } from '../../components/portal/PortalContenido';

/**
 * PORTAL DE TALENTO HUMANO — entrada ABIERTA, con código al correo.
 *
 * Para los colaboradores del grupo que NO tienen usuario en SynerLink, que son
 * la mayoría: la plataforma tiene unos cien usuarios y el grupo es más grande.
 * Quien sí tiene usuario entra por el módulo del hub (`/process/portal-th`) y
 * no necesita ningún código.
 *
 * ESTA PÁGINA VIVE FUERA DE `(hub)` A PROPÓSITO: ponerla adentro la habría
 * dejado detrás del login de SynerLink, que es justo lo que aquí no aplica.
 *
 * Sin Mantine: es una página pública y cuanto menos cargue, mejor abre en un
 * celular con mala señal.
 */
export default function PortalAbierto() {
  const { cargando, email, error: errorContenido, recargar, documentos, banners } =
    usePortalContenido();

  const [correo, setCorreo] = useState('');
  const [codigo, setCodigo] = useState('');
  const [pidioCodigo, setPidioCodigo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      await recargar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  const salir = async () => {
    await fetch('/api/portal/logout', { method: 'POST' });
    setCorreo('');
    setPidioCodigo(false);
    await recargar();
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
            <p>Le enviamos un código de seis dígitos. Sirve una sola vez y vence en 10 minutos.</p>

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
                  // Teclado numérico en el celular, y `one-time-code` para que
                  // iOS ofrezca pegarlo desde el correo.
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

        {!cargando && email && <PortalContenido documentos={documentos} banners={banners} />}
        {!cargando && email && errorContenido && (
          <p className='portal-th__error'>{errorContenido}</p>
        )}
      </main>

      <footer className='portal-th__pie'>
        Group Shared Services Latinoamérica · Talento Humano
      </footer>
    </div>
  );
}
