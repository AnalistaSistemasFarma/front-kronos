'use client';

import { useCallback, useEffect, useState } from 'react';

interface Empresa {
  nombre: string;
  url: string;
}

/**
 * HEINSOHN NÓMINA (Cristian Baldión, 2026-10-15): ventana con un botón por empresa; cada botón abre su acceso al portal de
 * nómina de Heinsohn en una PESTAÑA NUEVA. Heinsohn no permite mostrar su página dentro de otra (X-Frame-Options: SAMEORIGIN),
 * así que no se puede incrustar como la vista previa de un documento. La lista sale del Excel «PORTAL NOMINA» en SharePoint.
 * Mismo marco que la ventana «Contactos». Los avisos van arriba y con color.
 */
export default function HeinsohnVentana({ onCerrar }: { onCerrar: () => void }) {
  const [empresas, setEmpresas] = useState<Empresa[] | null>(null);
  const [omitidas, setOmitidas] = useState<string[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch('/api/portal/heinsohn', { cache: 'no-store' });
      let data: Record<string, unknown> = {};
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        data = {};
      }
      if (!res.ok) throw new Error(String(data.error ?? 'No se pudieron cargar las empresas.'));
      setEmpresas(Array.isArray(data.empresas) ? (data.empresas as Empresa[]) : []);
      setOmitidas(Array.isArray(data.omitidas) ? (data.omitidas as string[]) : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
    };
    window.addEventListener('keydown', alTeclear);
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', alTeclear);
      document.body.style.overflow = previo;
    };
  }, [onCerrar]);

  return (
    <div
      className='portal-th__visor'
      role='dialog'
      aria-modal='true'
      aria-label='Heinsohn Nómina'
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div className='portal-th__visor-caja portal-th__visor-caja--contactos' data-testid='heinsohn-ventana'>
        <header className='portal-th__visor-barra'>
          <strong>Heinsohn Nómina</strong>
          <div className='portal-th__visor-acciones'>
            <button type='button' onClick={onCerrar} aria-label='Cerrar'>
              ✕
            </button>
          </div>
        </header>

        <div className='portal-th__contactos'>
          {/* Avisos ARRIBA y con color. */}
          {error && (
            <div className='portal-th__alerta portal-th__alerta--error' role='alert' data-testid='heinsohn-error'>
              <span>{error}</span>
              <button type='button' onClick={() => void cargar()}>
                Reintentar
              </button>
            </div>
          )}
          {omitidas.length > 0 && (
            <div className='portal-th__alerta portal-th__alerta--aviso' role='status' data-testid='heinsohn-omitidas'>
              <span>
                {omitidas.length === 1 ? 'Una empresa no se muestra porque su enlace no es válido' : `${omitidas.length} empresas no se muestran porque su enlace no es válido`}: {omitidas.join(', ')}. Avise a Talento Humano.
              </span>
            </div>
          )}

          {empresas && empresas.length > 0 && <p className='portal-th__estado'>Elija su empresa. Se abrirá el portal de nómina en una pestaña nueva.</p>}
          {cargando && <p className='portal-th__estado'>Cargando las empresas…</p>}
          {empresas && empresas.length === 0 && !error && <p className='portal-th__estado'>Todavía no hay empresas con enlace de acceso.</p>}

          {(empresas ?? []).map((e) => (
            <a
              key={`${e.nombre}|${e.url}`}
              className='portal-th__contactos-boton portal-th__contactos-boton--enlace'
              href={e.url}
              target='_blank'
              rel='noopener noreferrer'
              data-testid='heinsohn-empresa'
            >
              {e.nombre}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
