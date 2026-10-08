import { useId, type CSSProperties } from 'react';

/**
 * Indicador "pensando" con el LOGO de SynerLink.
 *
 * Pedido de Nicolás Rivera (2026-10-08): reemplazar los tres puntitos que
 * rebotaban junto al estado del agente por una animación más bonita basada en
 * el logo. Es el isotipo de public/Logo_Principal.svg (la "S" con sus dos
 * trazos de acento y el degradado de la base), dibujado en línea para poder
 * animar cada pieza por separado y para no pedir un archivo de 400 KB.
 *
 * Capas (todo SVG + CSS, sin librerías; ver `.sl-pensando` en globals.css):
 *   - halo    : resplandor radial que "respira" detrás del logo.
 *   - órbita  : arco con degradado y un satélite que gira alrededor.
 *   - marca   : el isotipo, con pulso de escala suave.
 *   - acentos : los dos trazos azules destellan a destiempo, como chispazos.
 *
 * `variante` = 'tool' (ejecutando herramienta/comando) gira más rápido y con
 * el arco más largo; 'thinking' es el ritmo pausado por defecto.
 *
 * Solo se anima con `transform` y `opacity` (composición, sin relayout) y la
 * caja tiene tamaño fijo: no mueve el renglón del estado. Con
 * `prefers-reduced-motion: reduce` queda estático. Los colores salen de
 * variables CSS que cambian en modo oscuro (marca casi blanca, como
 * Logo_Principal_Blanco.svg).
 */

export type LogoPensandoVariante = 'thinking' | 'tool';

/** Isotipo de Logo_Principal.svg (mismas coordenadas que el archivo original). */
const MARCA_BASE =
  'M322.79,346.54s14.91-44.14,13.01-78.47l-16.81-.4c-3.8,41.23-19.66,78.72-19.66,78.72-40.6,0-62.8,5.08-62.16-45.02.63-50.11,57.08-42.5,93.86-38.07,36.8,4.45,78.77-35.11,44.03-58.91-17.36-11.88-50.91,9.68-53.54,37.35,0,0-120.29-27.48-134.46,46.94-15.22,79.92,104.65,77.37,104.65,77.37,0,0-12.05,42.52-92.6,118.61,0,0-6.99-42.49-18.39-56.44-11.16-13.64-48.84-13.96-54.85,43.64-5.62,54.01,40.26,43.25,40.26,43.25,0,0,18.02,38.07,82.46,48.84,108.14,18.08,169.33-50.74,166.16-131.3-3.17-80.54-91.96-86.11-91.96-86.11ZM364.01,213.84c11.26,8.76-24.38,25.54-25.35,25.98.37-.95,14.1-34.74,25.35-25.98ZM162.89,495.88s-9.59,4-15.14-7.71c-10.95-23.1-.97-38.41,6.02-40.77,13.71-4.61,9.12,48.48,9.12,48.48ZM254.29,540.47c-55.81-7.6-50.74-37.42-50.74-37.42,0,0,73.57-52.64,110.35-135.73,0,0,54.56-16.48,56.46,75.48,1.9,91.96-60.26,105.28-116.07,97.67Z';
const MARCA_ACENTO_ALTO =
  'M322.79,346.54s14.91-44.14,13.01-78.47l-16.81-.4c-3.8,41.23-19.66,78.72-19.66,78.72l23.46.14Z';
const MARCA_ACENTO_BAJO =
  'M203.55,503.05s73.57-52.64,110.35-135.73l-22.19-1.27s-12.05,42.52-92.6,118.61l4.44,18.39Z';
const MARCA_DEGRADADO =
  'M224.89,532.44c-21.46-17.25-25.78-47.77-25.78-47.77,0,0-6.99-42.5-18.37-56.44-11.18-13.64-48.87-13.99-54.87,43.61-5.61,54.02,40.27,43.26,40.27,43.26,0,0,.12,7.12,12.81,17.85,16.5,13.96,29.96,19,29.96,19,12.2-.47,23.4-13.54,15.97-19.51ZM162.91,495.89s-9.61,4-15.14-7.72c-10.95-23.09-1-38.42,5.99-40.77,13.72-4.61,9.14,48.49,9.14,48.49Z';

/** Recorte cuadrado (centrado) del isotipo dentro del viewBox original. */
const MARCA_VIEWBOX = '80 194 380 380';

/** Variante del indicador según el estado que reporta el agente. */
export function varianteDeEstado(state: string | null | undefined): LogoPensandoVariante {
  return state === 'tool' ? 'tool' : 'thinking';
}

export default function LogoPensando({
  variante = 'thinking',
  size = 28,
  className,
}: {
  variante?: LogoPensandoVariante;
  size?: number;
  className?: string;
}) {
  // Ids únicos por instancia (en un grupo puede haber varios a la vez). Se
  // limpian los caracteres de useId que no van bien dentro de url(#…).
  const base = `slp${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const idHalo = `${base}-halo`;
  const idArco = `${base}-arco`;
  const idBase = `${base}-base`;

  return (
    <span
      className={`sl-pensando${className ? ` ${className}` : ''}`}
      data-variante={variante}
      style={{ '--sl-pensando-size': `${size}px` } as CSSProperties}
      aria-hidden
    >
      <svg viewBox='0 0 100 100' width={size} height={size} focusable='false'>
        <defs>
          <radialGradient id={idHalo}>
            <stop offset='0' className='sl-pensando__halo-centro' />
            <stop offset='1' className='sl-pensando__halo-borde' />
          </radialGradient>
          {/* Cola del arco (arriba) transparente → cabeza (derecha) en azul. */}
          <linearGradient id={idArco} x1='0.5' y1='0' x2='1' y2='0.5'>
            <stop offset='0' className='sl-pensando__stop-cola' />
            <stop offset='1' className='sl-pensando__stop-acento' />
          </linearGradient>
          <linearGradient
            id={idBase}
            x1='229.15'
            y1='539.47'
            x2='130.85'
            y2='441.18'
            gradientUnits='userSpaceOnUse'
          >
            <stop offset='0' className='sl-pensando__stop-marca' />
            <stop offset='1' className='sl-pensando__stop-acento' />
          </linearGradient>
        </defs>

        <circle className='sl-pensando__halo' cx='50' cy='50' r='42' fill={`url(#${idHalo})`} />
        <circle className='sl-pensando__pista' cx='50' cy='50' r='44' />

        <g className='sl-pensando__orbita'>
          <circle
            className='sl-pensando__arco'
            cx='50'
            cy='50'
            r='44'
            stroke={`url(#${idArco})`}
            pathLength={100}
          />
          <circle className='sl-pensando__satelite' cx='94' cy='50' r='5' />
        </g>

        <g className='sl-pensando__marca'>
          <svg x='18' y='18' width='64' height='64' viewBox={MARCA_VIEWBOX}>
            <path className='sl-pensando__marca-base' d={MARCA_BASE} />
            <path className='sl-pensando__acento' d={MARCA_ACENTO_ALTO} />
            <path className='sl-pensando__acento sl-pensando__acento--bajo' d={MARCA_ACENTO_BAJO} />
            <path d={MARCA_DEGRADADO} fill={`url(#${idBase})`} />
          </svg>
        </g>
      </svg>
    </span>
  );
}
