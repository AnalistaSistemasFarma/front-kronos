import { NOTO, bocaDeFrente, invertirBN, ojosDeFrente } from './noto';
import type { AvatarCategory, AvatarConfig, AvatarOption } from './types';

/**
 * CATÁLOGO — PLANETAS (avatares de asistentes). Dibujo propio, estilo Notion
 * en blanco y negro: círculo de trazo grueso y UN rasgo que lo identifica
 * (cráteres, nubes, continentes, bandas y la Gran Mancha, anillos…). La
 * carita es opcional y usa las mismas piezas de expresión de Noto que las
 * personas (ojos, cejas y boca), montadas de frente.
 *
 * Rejilla (300×300): planeta centrado en (150, 150), radio ≈ 100. La carita
 * va, por defecto, con los ojos en (150, 146); cada planeta puede moverla o
 * achicarla con `cara`.
 *
 * Contrato: la base guarda ÍNDICES; las opciones nuevas van al final.
 */

const NEGRO = 'fill="#000"';
const SIN_RELLENO = 'fill="none"';
const linea = (d: string, ancho = 5) => `<path d="${d}" ${SIN_RELLENO} stroke-width="${ancho}"/>`;
const circulo = (x: number, y: number, r: number, extra = '') => `<circle cx="${x}" cy="${y}" r="${r}" ${extra}/>`;
const crater = (x: number, y: number, r: number) => circulo(x, y, r, 'stroke-width="5"');

/** Cuerda horizontal del círculo (cx 150, r) a la altura y, con margen. */
function banda(y: number, r: number, cy = 150, margen = 0): string {
  const dy = y - cy;
  const m = Math.sqrt(Math.max(0, r * r - dy * dy)) - margen;
  return `M${Math.round(150 - m)} ${y} Q150 ${y + 6} ${Math.round(150 + m)} ${y}`;
}

const PLANETAS: AvatarOption[] = [
  {
    label: 'Mercurio',
    // El mensajero: planeta pequeño con alitas.
    cara: { x: 150, y: 150, k: 0.85 },
    svg:
      // Alas de mensajero a los lados.
      '<path d="M76 136 C64 112 44 96 18 92 Q26 104 34 108 Q26 116 34 124 Q30 132 44 140 Q44 148 62 152 Z" stroke-width="5"/>' +
      linea('M36 110 Q54 116 68 130 M42 126 Q56 132 66 142', 4) +
      '<path d="M 224 136 C 236 112 256 96 282 92 Q 274 104 266 108 Q 274 116 266 124 Q 270 132 256 140 Q 256 148 238 152 Z" stroke-width="5"/>' +
      linea('M 264 110 Q 246 116 232 130 M 258 126 Q 244 132 234 142', 4) +
      circulo(150, 156, 86) + crater(104, 112, 11) + crater(198, 104, 7) + crater(206, 206, 9) + crater(96, 204, 6),
  },
  {
    label: 'Venus',
    svg:
      circulo(150, 150, 100) +
      linea(`${banda(84, 100, 150, 14)} M78 108 Q120 96 160 106 T222 104 M70 206 Q110 196 150 210 T230 200 ${banda(232, 100, 150, 16)}`),
  },
  {
    label: 'Tierra',
    svg:
      circulo(150, 150, 100) +
      // Américas: norte arriba a la izquierda, sur abajo a la derecha.
      `<path d="M62 102 C70 76 96 58 122 62 C126 74 116 82 104 86 C98 96 104 108 92 118 C84 126 70 124 62 102 Z" ${NEGRO} stroke-width="4"/>` +
      `<path d="M176 196 C192 186 214 192 218 206 C222 224 204 236 194 246 C186 238 184 224 176 216 C170 208 170 200 176 196 Z" ${NEGRO} stroke-width="4"/>` +
      `<path d="M206 82 C220 80 232 92 236 108 C226 112 214 104 206 96 Z" ${NEGRO} stroke-width="4"/>`,
  },
  {
    label: 'Marte',
    oscuro: true,
    svg:
      circulo(150, 150, 100, NEGRO) +
      // Casquete polar y cráteres en blanco.
      `<path d="M112 58 Q150 74 188 58" ${SIN_RELLENO} stroke="#fff" stroke-width="6"/>` +
      circulo(92, 120, 10, 'fill="none" stroke="#fff" stroke-width="5"') +
      circulo(210, 214, 13, 'fill="none" stroke="#fff" stroke-width="5"') +
      circulo(214, 112, 5, 'fill="#fff" stroke="none"'),
  },
  {
    label: 'Júpiter',
    cara: { x: 150, y: 142 },
    svg:
      circulo(150, 150, 100) +
      linea(`${banda(82, 100)} ${banda(106, 100)} ${banda(214, 100)}`) +
      linea(banda(238, 100, 150, 4), 9) +
      // La Gran Mancha Roja.
      `<ellipse cx="206" cy="194" rx="22" ry="12" ${NEGRO} stroke-width="5"/>`,
  },
  {
    label: 'Saturno',
    cara: { x: 150, y: 136, k: 0.8 },
    svg:
      // Anillo de atrás, planeta y mitad delantera del anillo encima.
      `<g transform="rotate(-14 150 160)"><ellipse cx="150" cy="160" rx="140" ry="34" ${SIN_RELLENO} stroke-width="6"/>` +
      `<ellipse cx="150" cy="160" rx="118" ry="24" ${SIN_RELLENO} stroke-width="4"/></g>` +
      circulo(150, 150, 76) +
      `<g transform="rotate(-14 150 160)"><path d="M10 160 A140 34 0 0 0 290 160" ${SIN_RELLENO} stroke-width="6"/>` +
      `<path d="M32 160 A118 24 0 0 0 268 160" ${SIN_RELLENO} stroke-width="4"/></g>`,
  },
  {
    label: 'Urano',
    cara: { x: 150, y: 146, k: 0.9 },
    svg:
      // El que gira acostado: anillo casi vertical, por detrás.
      `<ellipse cx="150" cy="150" rx="30" ry="138" transform="rotate(14 150 150)" ${SIN_RELLENO} stroke-width="6"/>` +
      circulo(150, 150, 90) +
      linea('M88 96 Q118 86 138 90 M196 220 Q214 212 226 196', 4),
  },
  {
    label: 'Neptuno',
    svg:
      circulo(150, 150, 100) +
      `<ellipse cx="98" cy="96" rx="20" ry="12" transform="rotate(-18 98 96)" ${NEGRO} stroke-width="4"/>` +
      linea('M168 76 L214 84 M186 226 L232 210 M70 218 L108 230 M200 102 L228 110', 5),
  },
  {
    label: 'Luna',
    svg:
      circulo(150, 150, 96) +
      // Terminador: media luna en sombra a la derecha.
      `<path d="M150 54 A96 96 0 0 1 150 246 A62 96 0 0 0 150 54 Z" ${NEGRO} stroke-width="5"/>` +
      crater(96, 102, 10) + crater(84, 188, 7) + crater(124, 226, 5),
    cara: { x: 120, y: 146, k: 0.8 },
  },
  {
    label: 'Sol',
    cara: { x: 150, y: 146, k: 0.9 },
    svg:
      linea(
        Array.from({ length: 12 }, (_, i) => {
          const a = (i * 30 * Math.PI) / 180;
          const r0 = 92;
          const r1 = i % 2 ? 118 : 134;
          const p = (r: number) => `${Math.round(150 + r * Math.cos(a))} ${Math.round(150 + r * Math.sin(a))}`;
          return `M${p(r0)} L${p(r1)}`;
        }).join(' '),
        9
      ) + circulo(150, 150, 80),
  },
  {
    label: 'Plutón',
    cara: { x: 142, y: 140, k: 0.8 },
    svg:
      circulo(150, 156, 78) +
      // El corazón de Plutón (Tombaugh Regio).
      `<path d="M190 182 C190 172 204 170 206 180 C208 170 222 172 222 182 C222 194 206 202 206 206 C206 202 190 194 190 182 Z" ${NEGRO} stroke-width="4"/>` +
      crater(110, 112, 6),
  },
];

/* ──────────────────────────── Carita (Noto) ──────────────────────────── */

const S = 0.4;
const BAJA_BOCA = 40;

const CARITA: AvatarOption[] = [
  // Esta categoría no pinta nada por sí misma (activa o apaga las demás);
  // el dibujo de "Con carita" es solo para su miniatura.
  {
    label: 'Con carita',
    peso: 3,
    svg:
      '<circle cx="132" cy="140" r="6" fill="#000" stroke="none"/><circle cx="168" cy="140" r="6" fill="#000" stroke="none"/>' +
      linea('M128 168 Q150 186 172 168', 6),
  },
  { label: 'Sin carita', peso: 1, svg: '' },
];

const OJOS: AvatarOption[] = NOTO.ojos.map((svg, i) => ({ label: `Ojos ${i + 1}`, svg: ojosDeFrente(svg, 150, 146, S) }));
const CEJAS: AvatarOption[] = [
  { label: 'Sin cejas', peso: 6, svg: '' },
  ...NOTO.cejas.map((svg, i) => ({ label: `Cejas ${i + 1}`, svg: ojosDeFrente(svg, 150, 146, S) })),
];
const BOCAS: AvatarOption[] = NOTO.boca.map((svg, i) => ({ label: `Boca ${i + 1}`, svg: bocaDeFrente(svg, 150, 146, S, BAJA_BOCA) }));

/** Accesorios propios, de frente, para la carita centrada en (150, 146). */
const ACCESORIOS: AvatarOption[] = [
  { label: 'Ninguno', peso: 4, svg: '' },
  {
    label: 'Gafas de sol',
    peso: 1,
    svg:
      `<path d="M100 136 L144 136 Q144 162 122 162 Q100 162 100 136 Z M156 136 L200 136 Q200 162 178 162 Q156 162 156 136 Z" ${NEGRO} stroke-width="5"/>` +
      linea('M144 140 L156 140', 5),
  },
  {
    label: 'Monóculo',
    peso: 1,
    svg: circulo(178, 146, 18, `${SIN_RELLENO} stroke-width="5"`) + linea('M194 156 Q206 190 196 214', 3),
  },
  {
    label: 'Gorro de fiesta',
    peso: 1,
    svg:
      `<path d="M150 18 L120 74 L180 74 Z" stroke-width="5"/>` + linea('M138 40 L156 52 M128 60 L168 62', 4) + circulo(150, 16, 8, NEGRO),
  },
];

const CHISPAS = linea('M40 52 L40 72 M30 62 L50 62 M262 236 L262 252 M254 244 L270 244 M256 40 L256 52 M250 46 L262 46', 4);
const DECORADOS: AvatarOption[] = [
  { label: 'Ninguno', peso: 2, svg: '' },
  { label: 'Chispas', peso: 2, svg: CHISPAS },
  {
    label: 'Satélite',
    peso: 1,
    svg: `<path d="M184 26 Q238 26 252 66" ${SIN_RELLENO} stroke-width="4" stroke-dasharray="1 11"/>` + circulo(258, 80, 13, 'stroke-width="5"'),
  },
  {
    label: 'Cohete',
    peso: 1,
    svg:
      `<g transform="rotate(40 252 58)"><path d="M252 26 C266 40 266 70 260 84 L244 84 C238 70 238 40 252 26 Z" stroke-width="5"/>` +
      `<path d="M244 84 L236 96 L244 92 Z M260 84 L268 96 L260 92 Z" stroke-width="4"/>` +
      circulo(252, 52, 5, NEGRO) + `</g>`,
  },
];

export const CATEGORIAS_PLANETA: AvatarCategory[] = [
  { id: 'planeta', label: 'Planeta', title: 'Planetas', options: PLANETAS, thumbViewBox: '10 10 280 280' },
  { id: 'carita', label: 'Carita', title: 'Carita', options: CARITA, thumbViewBox: '90 100 120 100' },
  { id: 'ojos', label: 'Ojos', title: 'Ojos', options: OJOS, thumbViewBox: '100 120 100 52' },
  { id: 'cejas', label: 'Cejas', title: 'Cejas', options: CEJAS, thumbViewBox: '100 110 100 52', optional: true },
  { id: 'boca', label: 'Boca', title: 'Bocas', options: BOCAS, thumbViewBox: '110 160 80 60' },
  { id: 'accesorios', label: 'Accesorios', title: 'Accesorios', options: ACCESORIOS, thumbViewBox: '80 0 140 220', optional: true },
  { id: 'decorado', label: 'Decorado', title: 'Decorados', options: DECORADOS, thumbViewBox: '0 0 300 300', optional: true },
];

export const ORDEN_PLANETA = ['decorado', 'planeta', 'ojos', 'cejas', 'boca', 'accesorios'] as const;

const PARTES_CARITA = new Set(['ojos', 'cejas', 'boca', 'accesorios']);

/** Mueve la carita a su sitio en cada planeta y la invierte si es oscuro. */
export function capaPlaneta(config: AvatarConfig, id: string, svg: string): string {
  if (!PARTES_CARITA.has(id)) return svg;
  if ((config.partes.carita ?? 0) === 1) return '';
  const planeta = PLANETAS[config.partes.planeta ?? 0] ?? PLANETAS[0];
  const { x = 150, y = 146, k = 1 } = planeta.cara ?? {};
  let s = svg;
  if (planeta.oscuro && id !== 'accesorios') s = invertirBN(`<g stroke="#000" fill="#fff">${s}</g>`);
  if (x === 150 && y === 146 && k === 1) return s;
  const tx = Math.round((x - 150 * k) * 10) / 10;
  const ty = Math.round((y - 146 * k) * 10) / 10;
  return `<g transform="translate(${tx} ${ty}) scale(${k})">${s}</g>`;
}
