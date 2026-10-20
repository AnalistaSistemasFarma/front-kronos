'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EMOJIS_MENSAJE, MAX_CARACTERES_MENSAJE, contarCaracteres, type MensajeVisible, type RespuestaMensajes } from '../../lib/portal/mensajes-cumple';
import estilos from './MensajesCumpleanos.module.css';

/**
 * MENSAJES DE CUMPLEAÑOS (Cristian Baldión, 2026-10-20): en el recuadro de eventos del calendario, el nombre de quien cumple años abre
 * «Deja tu mensaje» (texto de hasta 500 caracteres, paleta de emojis y botón «Enviar»). Lo lee solo el cumpleañero y el administrador
 * —lo decide el SERVIDOR— y el administrador puede borrar lo que no corresponda. Mismo estilo del calendario (CSS propio `portal-th__*`,
 * sin Mantine: esta página abre también para quienes no tienen usuario en SynerLink). Los avisos van ARRIBA y con color.
 */

const lectura = async (res: Response): Promise<Record<string, unknown>> => {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
};

export interface DestinoMensaje {
  fecha: string;
  nombre: string;
  empresa: string;
}

export function VentanaMensaje({ destino, onCerrar, onEnviado }: { destino: DestinoMensaje; onCerrar: () => void; onEnviado: () => void }) {
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const caja = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    caja.current?.focus({ preventScroll: true });
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [onCerrar]);

  const cuantos = contarCaracteres(texto);

  /** Inserta el emoji donde está el cursor (o al final), sin pasarse del tope. */
  const agregarEmoji = (emoji: string) => {
    const area = caja.current;
    const ini = area?.selectionStart ?? texto.length;
    const fin = area?.selectionEnd ?? texto.length;
    const nuevo = texto.slice(0, ini) + emoji + texto.slice(fin);
    if (contarCaracteres(nuevo) > MAX_CARACTERES_MENSAJE) return;
    setTexto(nuevo);
    window.requestAnimationFrame(() => {
      area?.focus({ preventScroll: true });
      area?.setSelectionRange(ini + emoji.length, ini + emoji.length);
    });
  };

  const enviar = async () => {
    setAviso(null);
    if (!texto.trim()) {
      setAviso('Escriba su mensaje.');
      caja.current?.focus();
      return;
    }
    setEnviando(true);
    try {
      const res = await fetch('/api/portal/mensajes-cumple', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fecha: destino.fecha, nombre: destino.nombre, empresa: destino.empresa, texto }),
      });
      const data = await lectura(res);
      if (!res.ok) throw new Error(String(data.error ?? 'No se pudo enviar el mensaje.'));
      setEnviado(true);
      onEnviado();
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div
      className={estilos.fondo}
      role='dialog'
      aria-modal='true'
      aria-label='Deja tu mensaje'
      data-testid='ventana-mensaje'
      onClick={(e) => {
        if (e.target === e.currentTarget && !enviando) onCerrar();
      }}
    >
      <div className={estilos.caja} data-testid='mensaje-caja'>
        <header className={estilos.barra}>
          <div>
            <strong>Deja tu mensaje</strong>
            <small data-testid='mensaje-para'>Para {destino.nombre}</small>
          </div>
          <button type='button' onClick={onCerrar} aria-label='Cerrar' data-testid='mensaje-cerrar'>
            ✕
          </button>
        </header>

        <div className={estilos.cuerpo}>
          {/* Avisos ARRIBA y con color. */}
          {aviso && (
            <div className='portal-th__cal-aviso portal-th__cal-aviso--error' role='alert' data-testid='mensaje-aviso'>
              {aviso}
            </div>
          )}
          {enviado ? (
            <>
              <div className='portal-th__cal-aviso portal-th__cal-aviso--ok' role='status' data-testid='mensaje-enviado'>
                ¡Mensaje enviado! Lo verá la persona que cumple años.
              </div>
              <div className={estilos.acciones}>
                <button type='button' className={estilos.enviar} onClick={onCerrar}>
                  Cerrar
                </button>
              </div>
            </>
          ) : (
            <>
              <label htmlFor='portal-th-mensaje-texto' className={estilos.etiqueta}>
                Escriba su mensaje de cumpleaños
              </label>
              <textarea
                id='portal-th-mensaje-texto'
                ref={caja}
                className={estilos.texto}
                rows={5}
                value={texto}
                disabled={enviando}
                placeholder='Escriba aquí su mensaje…'
                aria-describedby='portal-th-mensaje-contador'
                data-testid='mensaje-texto'
                onChange={(e) => {
                  // Un tope duro: lo que se pega de más se corta, y los emojis cuentan como un solo carácter.
                  const v = e.currentTarget.value;
                  setTexto(contarCaracteres(v) > MAX_CARACTERES_MENSAJE ? Array.from(v).slice(0, MAX_CARACTERES_MENSAJE).join('') : v);
                }}
              />
              <div className={estilos.contador} id='portal-th-mensaje-contador' data-testid='mensaje-contador'>
                {cuantos} / {MAX_CARACTERES_MENSAJE}
              </div>
              <div className={estilos.emojis} role='group' aria-label='Emojis' data-testid='mensaje-emojis'>
                {EMOJIS_MENSAJE.map((e) => (
                  <button key={e} type='button' disabled={enviando} onClick={() => agregarEmoji(e)} aria-label={`Agregar ${e}`}>
                    {e}
                  </button>
                ))}
              </div>
              <p className={estilos.nota}>Su mensaje lo verá solo la persona que cumple años y el administrador de la plataforma.</p>
              <div className={estilos.acciones}>
                <button type='button' className={estilos.cancelar} onClick={onCerrar} disabled={enviando}>
                  Cancelar
                </button>
                <button type='button' className={estilos.enviar} onClick={() => void enviar()} disabled={enviando || !texto.trim()} aria-busy={enviando} data-testid='mensaje-enviar'>
                  {enviando ? 'Enviando…' : 'Enviar'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Los mensajes de un día que ESTA sesión puede leer: el cumpleañero, los suyos; el administrador, todos (y puede borrar). Si no hay
 * ninguno para quien mira, no se pinta nada. Un fallo de lectura tampoco: el calendario ya tiene sus propios avisos.
 */
export function MensajesRecibidos({ fecha, version }: { fecha: string; version: number }) {
  const [datos, setDatos] = useState<RespuestaMensajes | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [quitando, setQuitando] = useState<string | null>(null);
  const [borrando, setBorrando] = useState(false);

  const cargar = useCallback(
    async (senal?: AbortSignal) => {
      try {
        const res = await fetch(`/api/portal/mensajes-cumple?fecha=${encodeURIComponent(fecha)}`, { cache: 'no-store', signal: senal });
        if (senal?.aborted) return;
        if (!res.ok) return setDatos(null);
        const data = (await lectura(res)) as Partial<RespuestaMensajes>;
        setDatos({ mensajes: Array.isArray(data.mensajes) ? (data.mensajes as MensajeVisible[]) : [], puedeModerar: data.puedeModerar === true });
      } catch {
        if (!senal?.aborted) setDatos(null);
      }
    },
    [fecha]
  );

  useEffect(() => {
    setAviso(null);
    setQuitando(null);
    const control = new AbortController();
    void cargar(control.signal);
    return () => control.abort();
  }, [cargar, version]);

  const borrar = async (m: MensajeVisible) => {
    setBorrando(true);
    setAviso(null);
    try {
      const res = await fetch(`/api/portal/mensajes-cumple?fecha=${encodeURIComponent(fecha)}&id=${encodeURIComponent(m.id)}`, { method: 'DELETE' });
      const data = await lectura(res);
      if (!res.ok) throw new Error(String(data.error ?? 'No se pudo borrar el mensaje.'));
      setQuitando(null);
      await cargar();
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      setBorrando(false);
    }
  };

  if (!datos || datos.mensajes.length === 0) return null;

  return (
    <section className={estilos.lista} aria-label={datos.puedeModerar ? 'Mensajes de cumpleaños (administrador)' : 'Mensajes que le dejaron'} data-testid='mensajes-recibidos'>
      <h4>{datos.puedeModerar ? 'Mensajes de cumpleaños · administrador' : '🎁 Mensajes que le dejaron'}</h4>
      {aviso && (
        <div className='portal-th__cal-aviso portal-th__cal-aviso--error' role='alert' data-testid='mensajes-aviso'>
          {aviso}
        </div>
      )}
      <ul>
        {datos.mensajes.map((m) => (
          <li key={m.id} data-testid='mensaje-item'>
            <p className={estilos.contenido}>{m.texto}</p>
            <small>
              {datos.puedeModerar ? `Para ${m.paraNombre} · ` : ''}De {m.deNombre}
              {datos.puedeModerar && m.deCorreo ? ` (${m.deCorreo})` : ''}
            </small>
            {datos.puedeModerar && m.sinCorreo && (
              <small className={estilos.sincorreo} data-testid='mensaje-sin-correo'>
                Sin correo corporativo: la persona no puede leerlo en el portal; hágaselo llegar por otro medio.
              </small>
            )}
            {datos.puedeModerar &&
              (quitando === m.id ? (
                <span className='portal-th__cal-confirmar'>
                  <button type='button' className='portal-th__cal-mini portal-th__cal-mini--peligro' onClick={() => void borrar(m)} disabled={borrando} aria-busy={borrando} data-testid='mensaje-confirmar-borrar'>
                    {borrando ? 'Borrando…' : 'Borrar'}
                  </button>
                  <button type='button' className='portal-th__cal-mini' onClick={() => setQuitando(null)} disabled={borrando}>
                    No
                  </button>
                </span>
              ) : (
                <button type='button' className='portal-th__cal-mini' onClick={() => setQuitando(m.id)} aria-label={`Borrar el mensaje de ${m.deNombre}`} data-testid='mensaje-borrar'>
                  ✕
                </button>
              ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
