'use client';

import { useEffect, useState } from 'react';

/**
 * PANEL DE NAVEGACIÓN DEL PORTAL — pedido de Cristian (2026-09-10): botones al
 * lado izquierdo que lleven a cada sección ("ANUNCIOS", "POLÍTICAS Y
 * REGLAMENTOS", y las que se agreguen después).
 *
 * Es deliberadamente una lista de datos (`SeccionNav[]`), no botones sueltos
 * escritos a mano: agregar una sección nueva el día de mañana es agregar un
 * elemento al arreglo que arma `PortalContenido`, no tocar este componente.
 *
 * En celular se vuelve una barra horizontal con scroll en vez de una columna:
 * todo este portal se pensó para abrir bien con mala señal (ver el comentario
 * de `app/portal/page.tsx`), y una columna angosta a la izquierda le come el
 * ancho justo a la pantalla donde más se necesita.
 */
export interface SeccionNav {
  id: string;
  etiqueta: string;
}

export default function PortalNavegacion({
  secciones,
  activa,
  onSeleccionar,
}: {
  secciones: SeccionNav[];
  activa: string | null;
  onSeleccionar: (id: string) => void;
}) {
  if (secciones.length === 0) return null;

  return (
    <nav className='portal-th__nav' aria-label='Secciones del portal'>
      {secciones.map((s) => (
        <button
          key={s.id}
          type='button'
          className={`portal-th__nav-boton${activa === s.id ? ' portal-th__nav-boton--activo' : ''}`}
          onClick={() => onSeleccionar(s.id)}
        >
          {s.etiqueta}
        </button>
      ))}
    </nav>
  );
}

/**
 * Qué sección está a la vista, para resaltar su botón mientras se hace scroll.
 * Usa IntersectionObserver en vez de calcular posiciones a mano: es lo que el
 * navegador ya sabe hacer bien y no se desincroniza con cambios de layout.
 */
export function useSeccionActiva(ids: string[]): string | null {
  const [activa, setActiva] = useState<string | null>(ids[0] ?? null);
  // Los ids no cambian entre renders normales (dependen de qué secciones
  // existen, no de datos que se recargan), así que se unen en una clave
  // estable para no reinstalar el observador en cada render.
  const clave = ids.join('|');

  useEffect(() => {
    if (ids.length === 0) return;
    const elementos = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (elementos.length === 0) return;

    const observador = new IntersectionObserver(
      (entradas) => {
        // El primero visible de arriba hacia abajo es "la sección actual".
        const visible = entradas
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiva(visible.target.id);
      },
      // Franja angosta cerca del tope: que la sección cuente como "activa"
      // cuando su encabezado llega arriba, no cuando ya ocupó media pantalla.
      { rootMargin: '-15% 0px -70% 0px', threshold: 0 }
    );
    elementos.forEach((el) => observador.observe(el));
    return () => observador.disconnect();
  }, [clave]);

  return activa;
}
