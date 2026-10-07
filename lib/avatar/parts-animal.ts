import type { AvatarCategory, AvatarOption } from './types';
import { ACCESORIOS_ANIMAL, GAFAS, OJOS_OPCIONES, ROPA_OPCIONES } from './parts-persona';

/**
 * CATÁLOGO DE PARTES — ANIMALES (avatares de los agentes del chat).
 *
 * Mismo trazo y mismo lienzo que las personas (ver parts-persona.ts) para que
 * un agente y una persona se vean de la misma familia en la bandeja del chat.
 * Cada animal trae su cabeza, orejas, hocico y nariz; los ojos, la boca, las
 * gafas, los accesorios y la ropa son capas aparte, así que el mismo animal
 * cambia de expresión sin redibujarlo. Por eso TODOS los animales dejan libre
 * la zona de los ojos —(128, 142) y (172, 142)— y la de la boca (y≈182–198).
 *
 * ⚠️ NO reordenar ni borrar opciones: la base guarda ÍNDICES.
 */

const NEGRO = 'fill="#000"';
const SIN_RELLENO = 'fill="none"';
const SIN_TRAZO = 'stroke="none"';
const trazo = (d: string, ancho = 3) => `<path d="${d}" ${SIN_RELLENO} stroke-width="${ancho}"/>`;
const elipse = (cx: number, cy: number, rx: number, ry: number, extra = '') =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ${extra}/>`;
const circulo = (cx: number, cy: number, r: number, extra = '') => `<circle cx="${cx}" cy="${cy}" r="${r}" ${extra}/>`;

/** Bigotes de gato/conejo, a lado y lado del hocico. */
const BIGOTES = trazo('M118 168 L90 162 M118 176 L90 178 M182 168 L210 162 M182 176 L210 178');

/** Melena del león: estrella de 18 puntas alrededor de la cabeza. */
function melena(): string {
  const puntos: string[] = [];
  const n = 18;
  for (let i = 0; i < n * 2; i += 1) {
    const r = i % 2 === 0 ? 92 : 74;
    const a = (Math.PI * i) / n - Math.PI / 2;
    puntos.push(`${(150 + r * Math.cos(a)).toFixed(1)} ${(146 + r * Math.sin(a)).toFixed(1)}`);
  }
  return `<path d="M${puntos.join(' L')} Z" ${NEGRO}/>`;
}

const ANIMALES: AvatarOption[] = [
  {
    label: 'Gato',
    svg:
      '<path d="M98 120 L100 68 L138 96 Z"/><path d="M202 120 L200 68 L162 96 Z"/>' +
      trazo('M106 104 L107 82 L126 96 M194 104 L193 82 L174 96') +
      elipse(150, 146, 62, 56) +
      `<path d="M143 163 L157 163 L150 171 Z" ${NEGRO} stroke-width="3"/>` +
      BIGOTES,
  },
  {
    label: 'Perro',
    svg:
      elipse(150, 144, 58, 62) +
      `<path d="M102 96 C74 94 64 140 78 178 C90 188 102 168 104 148 Z" ${NEGRO}/>` +
      `<path d="M198 96 C226 94 236 140 222 178 C210 188 198 168 196 148 Z" ${NEGRO}/>` +
      elipse(150, 178, 28, 22, 'stroke-width="4"') +
      elipse(150, 166, 11, 8, `${NEGRO} stroke-width="3"`),
  },
  {
    label: 'Zorro',
    svg:
      '<path d="M150 206 C120 206 92 180 86 150 C84 128 96 108 112 100 L104 62 L134 92 Q150 88 166 92 L196 62 L188 100 C204 108 216 128 214 150 C208 180 180 206 150 206 Z"/>' +
      `<path d="M112 88 L109 72 L126 88 Z" ${NEGRO} stroke-width="3"/><path d="M188 88 L191 72 L174 88 Z" ${NEGRO} stroke-width="3"/>` +
      trazo('M88 150 Q118 156 134 178 M212 150 Q182 156 166 178') +
      elipse(150, 170, 9, 6, `${NEGRO} stroke-width="3"`),
  },
  {
    label: 'Búho',
    svg:
      '<path d="M102 102 L94 64 L126 88 Z"/><path d="M198 102 L206 64 L174 88 Z"/>' +
      '<path d="M150 82 C190 82 214 108 214 148 C214 184 186 210 150 210 C114 210 86 184 86 148 C86 108 110 82 150 82 Z"/>' +
      circulo(128, 142, 21, 'stroke-width="4"') + circulo(172, 142, 21, 'stroke-width="4"') +
      `<path d="M143 158 L157 158 L150 174 Z" ${NEGRO} stroke-width="3"/>` +
      trazo('M128 200 l5 5 l5 -5 M146 202 l4 4 l4 -4 M162 200 l5 5 l5 -5'),
  },
  {
    label: 'Oso',
    svg:
      circulo(102, 96, 21) + circulo(198, 96, 21) +
      circulo(102, 96, 9, `${NEGRO} ${SIN_TRAZO}`) + circulo(198, 96, 9, `${NEGRO} ${SIN_TRAZO}`) +
      elipse(150, 146, 64, 60) +
      elipse(150, 178, 30, 22, 'stroke-width="4"') +
      elipse(150, 166, 11, 8, `${NEGRO} stroke-width="3"`),
  },
  {
    label: 'Conejo',
    svg:
      '<path d="M122 102 C104 42 110 18 124 20 C138 22 142 60 138 100 Z"/>' +
      '<path d="M178 102 C196 42 190 18 176 20 C162 22 158 60 162 100 Z"/>' +
      trazo('M126 88 C116 56 118 38 124 36 M174 88 C184 56 182 38 176 36') +
      elipse(150, 148, 58, 56) +
      `<path d="M145 164 L155 164 L150 170 Z" ${NEGRO} stroke-width="3"/>` +
      trazo('M120 170 L96 166 M120 177 L96 180 M180 170 L204 166 M180 177 L204 180'),
  },
  {
    label: 'Panda',
    svg:
      circulo(104, 98, 19, NEGRO) + circulo(196, 98, 19, NEGRO) +
      elipse(150, 146, 64, 58) +
      elipse(126, 144, 17, 21, `${NEGRO} ${SIN_TRAZO} transform="rotate(25 126 144)"`) +
      elipse(174, 144, 17, 21, `${NEGRO} ${SIN_TRAZO} transform="rotate(-25 174 144)"`) +
      circulo(128, 142, 10, `fill="#fff" ${SIN_TRAZO}`) + circulo(172, 142, 10, `fill="#fff" ${SIN_TRAZO}`) +
      elipse(150, 168, 9, 6, `${NEGRO} stroke-width="3"`),
  },
  {
    label: 'León',
    svg:
      melena() +
      circulo(108, 104, 14) + circulo(192, 104, 14) +
      elipse(150, 148, 58, 56) +
      elipse(150, 178, 26, 19, 'stroke-width="4"') +
      `<path d="M142 163 L158 163 L150 172 Z" ${NEGRO} stroke-width="3"/>`,
  },
  {
    label: 'Pingüino',
    svg:
      elipse(150, 146, 66, 64, NEGRO) +
      `<path d="M150 104 C160 92 192 96 197 124 C203 156 184 194 150 202 C116 194 97 156 103 124 C108 96 140 92 150 104 Z" ${SIN_TRAZO}/>` +
      '<path d="M138 162 L162 162 L150 177 Z" fill="#FFD166" stroke-width="4"/>',
  },
  {
    label: 'Koala',
    svg:
      circulo(94, 114, 31) + circulo(206, 114, 31) +
      circulo(94, 116, 16, `${SIN_RELLENO} stroke-width="3"`) + circulo(206, 116, 16, `${SIN_RELLENO} stroke-width="3"`) +
      elipse(150, 150, 60, 56) +
      elipse(150, 162, 11, 15, `${NEGRO} stroke-width="3"`),
  },
  {
    label: 'Mono',
    svg:
      circulo(90, 146, 18) + circulo(210, 146, 18) +
      circulo(91, 146, 9, `${SIN_RELLENO} stroke-width="3"`) + circulo(209, 146, 9, `${SIN_RELLENO} stroke-width="3"`) +
      elipse(150, 142, 58, 62) +
      `<path d="M150 118 C162 102 196 106 192 140 C190 160 184 166 182 176 C180 200 164 206 150 206 C136 206 120 200 118 176 C116 166 110 160 108 140 C104 106 138 102 150 118 Z" ${SIN_RELLENO} stroke-width="3"/>` +
      circulo(146, 167, 2.5, `${NEGRO} ${SIN_TRAZO}`) + circulo(154, 167, 2.5, `${NEGRO} ${SIN_TRAZO}`) +
      trazo('M140 84 Q148 66 154 84 Q162 70 168 86', 4),
  },
];

/** Bocas pensadas para el hocico de los animales (más arriba y más pequeñas). */
const BOCAS_ANIMAL: AvatarOption[] = [
  { label: 'Gatuna', svg: trazo('M138 182 Q144 190 150 182 Q156 190 162 182', 4) },
  { label: 'Sonrisa', svg: trazo('M136 183 Q150 196 164 183', 4) },
  { label: 'Abierta', svg: `<path d="M137 182 Q150 204 163 182 Z" ${NEGRO} stroke-width="4"/>` },
  {
    label: 'Lengua',
    svg:
      `<path d="M137 182 Q150 200 163 182 Z" ${NEGRO} stroke-width="4"/>` +
      '<path d="M144 190 Q150 205 156 190 Z" fill="#F7A1B5" stroke-width="3"/>',
  },
  { label: 'Neutral', svg: trazo('M142 187 L158 187', 4) },
  { label: 'Sorpresa', svg: elipse(150, 189, 5, 7, `${NEGRO} ${SIN_TRAZO}`) },
];

/** Categorías del editor de ANIMAL (agentes). */
export const CATEGORIAS_ANIMAL: AvatarCategory[] = [
  { id: 'animal', label: 'Animal', title: 'Animales', options: ANIMALES, thumbViewBox: '50 14 200 210' },
  { id: 'ojos', label: 'Ojos', title: 'Ojos', options: OJOS_OPCIONES, thumbViewBox: '106 120 88 44' },
  { id: 'boca', label: 'Boca', title: 'Bocas', options: BOCAS_ANIMAL, thumbViewBox: '126 168 48 48' },
  { id: 'ropa', label: 'Ropa', title: 'Ropa', options: ROPA_OPCIONES, thumbViewBox: '50 200 200 100' },
  { id: 'gafas', label: 'Gafas', title: 'Gafas', options: GAFAS, thumbViewBox: '90 110 120 60', optional: true },
  { id: 'accesorios', label: 'Accesorios', title: 'Accesorios', options: ACCESORIOS_ANIMAL, thumbViewBox: '40 20 220 260', optional: true },
];

export const ORDEN_ANIMAL = ['cuello', 'ropa', 'animal', 'ojos', 'boca', 'gafas', 'accesorios'] as const;
