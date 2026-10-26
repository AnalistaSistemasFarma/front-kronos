'use client';

import { useCallback, useEffect, useState } from 'react';
import { medallaDelPuesto, type FilaTop, type VistaRanking } from '../../lib/portal/ranking-formacion';

/**
 * FORMACIÓN — TOP 10 DE ESTUDIANTES (Cristian Baldión, 2026-10-16): una tabla con los mejores estudiantes (más cursos completados y,
 * a igual número, mejor nota promedio). SOLO SE MUESTRA EL NOMBRE (pedido de Cristian, 2026-10-16): ni cursos ni nota. Oro, plata y bronce para los tres primeros. A la derecha de la lista de cursos en pantallas
 * anchas y debajo en las angostas. Sin sesión (401) no se muestra nada. Los fallos se avisan arriba, con color.
 */

const NOMBRE_MEDALLA = { oro: 'Medalla de oro', plata: 'Medalla de plata', bronce: 'Medalla de bronce' } as const;
const COLORES = {
  oro: { borde: '#b8860b', centro: '#ffd54a', anillo: '#f5b800', cinta: '#c62828' },
  plata: { borde: '#78909c', centro: '#eceff1', anillo: '#b0bec5', cinta: '#1565c0' },
  bronce: { borde: '#8d4a1b', centro: '#e0a26b', anillo: '#cd7f32', cinta: '#2e7d32' },
} as const;

/** Medalla dibujada en SVG (no depende de emojis ni de fuentes): cinta, disco con borde y el número del puesto. */
export function Medalla({ tipo, puesto }: { tipo: 'oro' | 'plata' | 'bronce'; puesto: number }) {
  const c = COLORES[tipo];
  return (
    <svg className={`portal-th__top-medalla portal-th__top-medalla--${tipo}`} viewBox='0 0 32 40' width='28' height='35' role='img' aria-label={NOMBRE_MEDALLA[tipo]} data-testid={`medalla-${tipo}`}>
      <path d='M8 0h6l4 14h-7z' fill={c.cinta} />
      <path d='M24 0h-6l-4 14h7z' fill={c.cinta} opacity='.82' />
      <circle cx='16' cy='26' r='12.5' fill={c.anillo} stroke={c.borde} strokeWidth='1.6' />
      <circle cx='16' cy='26' r='9' fill={c.centro} stroke={c.borde} strokeWidth='.9' />
      <text x='16' y='30.2' textAnchor='middle' fontSize='11.5' fontWeight='700' fill={c.borde} fontFamily='Arial, sans-serif'>
        {puesto}
      </text>
    </svg>
  );
}

function Puesto({ fila }: { fila: FilaTop }) {
  const medalla = medallaDelPuesto(fila.puesto);
  return medalla ? <Medalla tipo={medalla} puesto={fila.puesto} /> : <span className='portal-th__top-numero'>{fila.puesto}</span>;
}

export default function TopEstudiantes() {
  const [datos, setDatos] = useState<VistaRanking | null>(null);
  const [oculto, setOculto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/portal/ranking-formacion', { cache: 'no-store' });
      if (res.status === 401) {
        setOculto(true); // sin sesión no hay nada que mostrar (la página ya avisa)
        return;
      }
      let data: Record<string, unknown> = {};
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        data = {};
      }
      if (!res.ok) throw new Error(String(data.error ?? 'No se pudo cargar el top de estudiantes.'));
      setDatos(data as unknown as VistaRanking);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (oculto) return null;

  return (
    <aside className='portal-th__top' aria-labelledby='portal-th-top-titulo' data-testid='top-estudiantes'>
      <h3 id='portal-th-top-titulo'>
        <span aria-hidden='true'>🏆</span> Top 10 de estudiantes
      </h3>
      <p className='portal-th__top-explica'>Más cursos completados y, a igual número, mejor nota promedio.</p>

      {/* Avisos ARRIBA y con color. */}
      {error && (
        <div className='portal-th__alerta portal-th__alerta--error' role='alert' data-testid='top-error'>
          <span>{error}</span>
          <button type='button' onClick={() => void cargar()}>
            Reintentar
          </button>
        </div>
      )}
      {cargando && <p className='portal-th__estado'>Cargando…</p>}

      {datos && datos.top.length === 0 && (
        <p className='portal-th__estado' data-testid='top-vacio'>
          Todavía nadie ha completado un curso. ¡Sea la primera persona del top!
        </p>
      )}

      {datos && datos.top.length > 0 && (
        <>
          <table className='portal-th__top-tabla'>
            <caption className='portal-th__top-solo-lectores'>Los {datos.top.length} mejores estudiantes de Formación</caption>
            <thead>
              <tr>
                <th scope='col'>Puesto</th>
                <th scope='col'>Estudiante</th>
              </tr>
            </thead>
            <tbody>
              {datos.top.map((f) => (
                <tr key={f.puesto} className={f.esUsted ? 'portal-th__top-usted' : undefined} data-testid='top-fila' data-puesto={f.puesto}>
                  <td className='portal-th__top-puesto'>
                    <Puesto fila={f} />
                  </td>
                  <th scope='row' className='portal-th__top-nombre'>
                    {f.nombre}
                    {f.esUsted && <span className='portal-th__top-tu'> (usted)</span>}
                  </th>
                </tr>
              ))}
            </tbody>
          </table>
          {datos.usted && (
            <p className='portal-th__top-suposicion' data-testid='top-usted'>
              Su puesto: <strong>#{datos.usted.puesto}</strong> de {datos.total}
            </p>
          )}
        </>
      )}
    </aside>
  );
}
