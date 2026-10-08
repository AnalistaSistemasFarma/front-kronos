import {
  NOTO_ACCESSORIES,
  NOTO_BEARD,
  NOTO_DETAILS,
  NOTO_EYEBROWS,
  NOTO_EYES,
  NOTO_FACE,
  NOTO_GLASSES,
  NOTO_HAIR,
  NOTO_MOUTH,
  NOTO_NOSE,
} from './parts.generated';

/**
 * Piezas de "Noto avatar" (Felix Wong, CC0 1.0) — las mismas que usa
 * notion-avatar (github.com/Mayandev/notion-avatar). Lienzo de 1080×1080.
 *
 * Aquí solo se les da nombre en español y se ofrecen utilidades para
 * montarlas en el lienzo de 300×300 de SynerLink. El dibujo no se toca.
 * Ver lib/avatar/noto/LICENSE.md.
 */
export const NOTO = {
  cara: NOTO_FACE,
  cabello: NOTO_HAIR,
  ojos: NOTO_EYES,
  cejas: NOTO_EYEBROWS,
  nariz: NOTO_NOSE,
  boca: NOTO_MOUTH,
  barba: NOTO_BEARD,
  gafas: NOTO_GLASSES,
  accesorios: NOTO_ACCESSORIES,
  detalles: NOTO_DETAILS,
} as const;

/** Envuelve una pieza (lienzo 1080) con su traslado y escala al lienzo de 300. */
export function montar(svg: string, tx: number, ty: number, s: number): string {
  if (!svg) return '';
  return `<g transform="translate(${redondear(tx)} ${redondear(ty)}) scale(${redondear(s)})">${svg}</g>`;
}

const redondear = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Centro de referencia de las piezas de expresión de Noto (lienzo 1080):
 * punto medio entre los dos ojos y centro de la boca.
 */
export const CENTRO_OJOS = { x: 639, y: 540 } as const;
export const CENTRO_BOCA = { x: 600, y: 765 } as const;

/**
 * Carita DE FRENTE con piezas de Noto (ojos, cejas, boca), para animales y
 * planetas. `x, y` es el punto entre los ojos en el lienzo de 300; `s` la
 * escala de las piezas; `bajaBoca` cuánto más abajo de los ojos va la boca.
 */
export function ojosDeFrente(svg: string, x: number, y: number, s: number): string {
  return montar(svg, x - CENTRO_OJOS.x * s, y - CENTRO_OJOS.y * s, s);
}

export function bocaDeFrente(svg: string, x: number, y: number, s: number, bajaBoca: number): string {
  return montar(svg, x - CENTRO_BOCA.x * s, y + bajaBoca - CENTRO_BOCA.y * s, s);
}

/** Intercambia blanco y negro (carita sobre una figura negra). */
export function invertirBN(svg: string): string {
  return svg.replace(/#(000|fff)\b/gi, (_m, c: string) => (c.toLowerCase() === '000' ? '#fff' : '#000'));
}
