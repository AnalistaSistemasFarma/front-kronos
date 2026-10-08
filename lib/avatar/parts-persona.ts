import { NOTO, montar } from './noto';
import type { AvatarCategory, AvatarOption } from './types';

/**
 * CATÁLOGO DE PARTES — PERSONA (versión 3, 2026-10-08).
 *
 * Usa las piezas de "Noto avatar" (Felix Wong, CC0), las mismas que usa
 * notion-avatar: cabeza en 3/4 con oreja, trazo negro grueso, rellenos negros
 * sólidos y, sobre todo, MUCHA expresión (16 cejas, 14 ojos, 20 bocas, 58
 * cabellos). Ver lib/avatar/noto/LICENSE.md.
 *
 * Las piezas vienen en un lienzo de 1080; aquí se montan en el de 300 con una
 * sola escala y traslado (ESCALA, TX, TY) para que la cara quede grande y
 * centrada: a 28 px se sigue leyendo el gesto.
 *
 * Contrato: la base guarda ÍNDICES. El índice de cada opción es el número del
 * archivo de Noto (0.svg, 1.svg…). Nada se ha desplegado aún, así que esta
 * versión reemplaza la anterior; desde aquí, solo se agrega al final.
 */

export const ESCALA = 0.31;
export const TX = 150 - 490 * ESCALA;
export const TY = 158 - 600 * ESCALA;

const pieza = (svg: string) => montar(svg, TX, TY, ESCALA);

/** Opciones a partir de una lista de Noto. `vacio`: el índice 0 es "Ninguno". */
function opciones(
  lista: readonly string[],
  nombre: string,
  { vacio, pesoNinguno = 1, pesoCon }: { vacio?: string; pesoNinguno?: number; pesoCon?: (i: number) => number } = {}
): AvatarOption[] {
  return lista.map((svg, i) => {
    if (vacio && i === 0) return { label: vacio, svg: '', peso: pesoNinguno };
    return { label: `${nombre} ${vacio ? i : i + 1}`, svg: pieza(svg), peso: pesoCon?.(i) ?? 1 };
  });
}

/** Contexto para las miniaturas: el contorno de la cara. */
const CARA_BASE = pieza(NOTO.cara[0]);

const CARAS = opciones(NOTO.cara, 'Cara');
// Cabello 0 = sin cabello (calvo): sale poco al azar.
const CABELLOS = opciones(NOTO.cabello, 'Cabello', { vacio: 'Sin cabello', pesoNinguno: 0.4 });
const OJOS = opciones(NOTO.ojos, 'Ojos');
const CEJAS = opciones(NOTO.cejas, 'Cejas');
const NARICES = opciones(NOTO.nariz, 'Nariz');
const BOCAS = opciones(NOTO.boca, 'Boca');
// Lo opcional sale con frecuencia moderada: da carácter sin recargar.
// Barba ≈ 25 %, gafas ≈ 35 %, accesorio ≈ 20 %, detalle ≈ 25 %.
const BARBAS = opciones(NOTO.barba, 'Barba', { vacio: 'Sin barba', pesoNinguno: 48 });
const GAFAS = opciones(NOTO.gafas, 'Gafas', { vacio: 'Sin gafas', pesoNinguno: 26 });
const ACCESORIOS = opciones(NOTO.accesorios, 'Accesorio', { vacio: 'Ninguno', pesoNinguno: 56 });
const DETALLES = opciones(NOTO.detalles, 'Detalle', { vacio: 'Ninguno', pesoNinguno: 39 });

// Aretes y piercings (todo menos lo que va en la cabeza: 10, 11 y 12) se
// pueden combinar con gafas al azar.
ACCESORIOS.forEach((o, i) => {
  if (i > 0 && ![10, 11, 12].includes(i)) o.combinable = true;
});

/** Categorías del editor de PERSONA. NO renombrar los ids (se guardan). */
export const CATEGORIAS_PERSONA: AvatarCategory[] = [
  { id: 'cara', label: 'Cara', title: 'Caras', options: CARAS, thumbViewBox: '55 70 220 220' },
  { id: 'cabello', label: 'Cabello', title: 'Cabellos', options: CABELLOS, thumbViewBox: '0 0 300 300', optional: true },
  { id: 'ojos', label: 'Ojos', title: 'Ojos', options: OJOS, thumbViewBox: '150 100 110 80', thumbBase: CARA_BASE },
  { id: 'cejas', label: 'Cejas', title: 'Cejas', options: CEJAS, thumbViewBox: '150 90 110 80', thumbBase: CARA_BASE },
  { id: 'nariz', label: 'Nariz', title: 'Narices', options: NARICES, thumbViewBox: '170 125 80 80', thumbBase: CARA_BASE },
  { id: 'boca', label: 'Boca', title: 'Bocas', options: BOCAS, thumbViewBox: '135 170 110 80', thumbBase: CARA_BASE },
  { id: 'barba', label: 'Barba', title: 'Barbas', options: BARBAS, thumbViewBox: '70 140 200 160', thumbBase: CARA_BASE, optional: true },
  { id: 'gafas', label: 'Gafas', title: 'Gafas', options: GAFAS, thumbViewBox: '70 70 210 130', thumbBase: CARA_BASE, optional: true },
  { id: 'accesorios', label: 'Accesorios', title: 'Accesorios', options: ACCESORIOS, thumbViewBox: '20 20 260 260', thumbBase: CARA_BASE, optional: true },
  { id: 'detalles', label: 'Detalles', title: 'Detalles', options: DETALLES, thumbViewBox: '100 80 180 160', thumbBase: CARA_BASE, optional: true },
];

/** Orden de las capas (el mismo de notion-avatar): de atrás hacia adelante. */
export const ORDEN_PERSONA = [
  'cara',
  'nariz',
  'boca',
  'ojos',
  'cejas',
  'gafas',
  'cabello',
  'accesorios',
  'detalles',
  'barba',
] as const;
