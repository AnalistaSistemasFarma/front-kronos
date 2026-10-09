import * as lorelei from '@dicebear/lorelei';
import { aPincel, pincel } from './pincel';

/**
 * CABEZAS-FIGURA para los avatares de los ASISTENTES: animales, planetas,
 * constelaciones, estrellas y robots como OPCIONES ADICIONALES del selector
 * "Cabezas" de Lorelei (después de Cabeza 1…4). Sobre la figura se siguen
 * componiendo TODAS las demás partes de Lorelei —ojos, cejas, boca, nariz,
 * gafas, aretes, pecas, barba, flores y pelo (o "Ninguno")— con sus colores.
 *
 * Cómo (y por qué así):
 *   - @dicebear/lorelei 9.4.3 NO exporta sus componentes (su package.json solo
 *     expone lib/index.js), así que no se puede "extender" su componente head
 *     sin copiar ~150 KB de Lorelei. En su lugar, `loreleiCabezas` es un STYLE
 *     de DiceBear propio (meta/schema/create) que se usa con el mismo
 *     createAvatar de @dicebear/core 9.4.3 y que, por dentro, llama al
 *     `create` de la Lorelei instalada: mismos componentes, mismas anclas y el
 *     mismo fondo/flip/tamaño/metadata del core.
 *   - Lorelei dibuja la cabeza DENTRO del pelo: pelo = [pelo de atrás] +
 *     cabeza + [pelo de adelante], y cabeza = trazos de la cabeza + ojos,
 *     cejas, aretes, pecas, nariz, barba, boca y gafas. Para separar esas
 *     piezas sin adivinar se le piden a Lorelei renders auxiliares con alguna
 *     parte vacía (un valor que no está en su catálogo: pickComponent no la
 *     dibuja) y se recortan por igualdad EXACTA de texto (ni regex ni
 *     coordenadas). Cada recorte se verifica; si algo no cuadra, se lanza un
 *     error (las pruebas recorren todas las cabezas-figura y los 48 pelos).
 *   - Los avatares Lorelei de siempre (Cabeza 1…4) NO pasan por aquí: siguen
 *     saliendo de createAvatar(lorelei, …), byte a byte igual.
 *
 * Dibujo de las figuras: propio de SynerLink (la geometría de las figuras del
 * #554, sin sus caritas). Se dibuja en un lienzo de 300 que se lleva al grupo
 * de la cabeza de Lorelei (lienzo 980, dentro de su translate(10 -60)), con
 * relleno = color de piel y acentos = color de cabello, en relleno plano.
 * TRAZO DE LORELEI (pedido de Nicolás, msg 15787): las figuras se escriben con
 * stroke por comodidad, pero al componerse cada contorno se convierte
 * (pincel.ts) en lo que hace Lorelei: formas rellenas de #000 de grosor
 * variable, partidas con pequeños huecos y con las puntas afinadas, del mismo
 * grosor medido en Lorelei (≈ 12,5 en su lienzo de 980). El SVG final no
 * lleva ni stroke, ni degradados, ni transparencias.
 * Código PURO: lo usan el editor (navegador) y el endpoint.
 */

/* ───────────────────────────── Modelo ───────────────────────────── */

export type GrupoFigura = 'animal' | 'planeta' | 'constelacion' | 'estrella' | 'robot';

/** Prefijo del valor de `head` de una cabeza-figura en la configuración (p. ej. 'figura:zorro'). */
export const PREFIJO_FIGURA = 'figura:';

interface CabezaFigura {
  id: string;
  label: string;
  grupo: GrupoFigura;
  /** Dibujo en el lienzo de 300 (fichas: %R relleno, %A acento). */
  svg: string;
  /** El pelo de Lorelei tiene sentido encima (si no, al elegirla el pelo queda en "Ninguno"). */
  pelo?: boolean;
}

/* ─────────────────────────── Utilidades SVG ─────────────────────────── */

const r1 = (n: number) => Math.round(n * 10) / 10;
const linea = (d: string, ancho = 3.6, color = '') =>
  `<path d="${d}" fill="none" stroke-width="${ancho}"${color ? ` stroke="${color}"` : ''}/>`;
const mancha = (d: string, ancho = 3) => `<path d="${d}" fill="%A" stroke-width="${ancho}"/>`;
const circulo = (x: number, y: number, r: number, extra = '') =>
  `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r)}"${extra ? ` ${extra}` : ''}/>`;
const punto = (x: number, y: number, r: number, color = '%A') => circulo(x, y, r, `fill="${color}" stroke="none"`);

/** Estrella de n puntas centrada en (cx, cy). */
function estrellaPath(cx: number, cy: number, R: number, r: number, n = 5, giro = -90): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i += 1) {
    const a = ((giro + (i * 180) / n) * Math.PI) / 180;
    const rad = i % 2 ? r : R;
    pts.push(`${r1(cx + rad * Math.cos(a))} ${r1(cy + rad * Math.sin(a))}`);
  }
  return `M${pts.join(' L')} Z`;
}

/*
 * Zona de la cara de Lorelei en el lienzo de 300 (todas las variantes de
 * ojos, cejas, nariz, boca y gafas): x ≈ 100…225, y ≈ 92…205, con la cara a
 * 3/4 hacia la derecha. Cada figura cubre esa zona con su relleno.
 */

/* Animales: solo cabeza, de frente; sin nariz ni boca (las pone Lorelei). */

const CABEZA = 'M152 46 C214 46 250 86 250 140 C250 196 210 232 152 232 C94 232 54 196 54 140 C54 86 90 46 152 46 Z';
const cabeza = (d = CABEZA, extra = '') => `<path d="${d}"${extra ? ` ${extra}` : ''}/>`;
const BIGOTES = linea('M70 172 L28 166 M72 188 L32 198 M234 172 L276 166 M232 188 L272 198', 3);
/** Hocico alrededor de la nariz y la boca de Lorelei. */
const HOCICO = '<ellipse cx="180" cy="178" rx="44" ry="34" stroke-width="3"/>';

const TENTACULOS = (() => {
  const ds = [
    'M98 204 C68 218 42 230 38 260 C36 278 56 284 62 270',
    'M122 214 C106 242 90 266 94 288 C98 298 116 298 114 288',
    'M206 204 C236 218 262 230 266 260 C268 278 248 284 242 270',
    'M182 214 C198 242 214 266 210 288 C206 298 188 298 190 288',
    'M152 222 C152 252 148 274 160 292 C166 298 176 292 170 284',
  ];
  // Cuerpo de cada tentáculo: forma rellena que se adelgaza hacia la punta; su contorno lo pone el pincel.
  return ds.map((d) => `<path d="${pincel(d, { ancho: 15, variacion: 0, huecos: false, puntas: false, perfil: (u) => 1 - 0.5 * u })}"/>`).join('');
})();

const ANIMALES: CabezaFigura[] = [
  {
    id: 'gato',
    label: 'Gato',
    grupo: 'animal',
    svg:
      '<path d="M66 118 L76 14 L138 64 Z"/><path d="M238 118 L228 14 L166 64 Z"/>' +
      mancha('M84 40 L88 82 L114 66 Z', 2.5) +
      mancha('M220 40 L216 82 L190 66 Z', 2.5) +
      cabeza() +
      BIGOTES,
  },
  {
    id: 'perro',
    label: 'Perro',
    grupo: 'animal',
    svg:
      mancha('M96 62 C52 54 26 116 34 176 C40 202 70 204 80 178 Z', 3.6) +
      mancha('M208 62 C252 54 278 116 270 176 C264 202 234 204 224 178 Z', 3.6) +
      cabeza() +
      HOCICO,
    pelo: true,
  },
  {
    id: 'zorro',
    label: 'Zorro',
    grupo: 'animal',
    svg:
      '<path d="M70 120 L70 22 L136 70 Z"/><path d="M234 120 L234 22 L168 70 Z"/>' +
      mancha('M78 46 L80 84 L104 72 Z', 2.5) +
      mancha('M226 46 L224 84 L200 72 Z', 2.5) +
      cabeza('M152 52 C210 52 248 84 250 132 C252 172 210 214 152 236 C94 214 52 172 54 132 C56 84 94 52 152 52 Z') +
      linea('M58 160 C92 158 110 170 122 196 M246 160 C226 160 214 168 208 186', 3),
  },
  {
    id: 'buho',
    label: 'Búho',
    grupo: 'animal',
    svg:
      '<path d="M78 92 L66 22 L126 62 Z"/><path d="M226 92 L238 22 L178 62 Z"/>' +
      cabeza() +
      circulo(118, 140, 40, 'fill="none" stroke-width="3"') +
      circulo(196, 136, 40, 'fill="none" stroke-width="3"') +
      linea('M132 56 Q152 72 172 56', 3),
  },
  {
    id: 'oso',
    label: 'Oso',
    grupo: 'animal',
    svg:
      circulo(82, 64, 30) +
      circulo(222, 64, 30) +
      linea('M72 76 Q72 54 92 52 M232 76 Q232 54 212 52', 3) +
      cabeza() +
      HOCICO,
    pelo: true,
  },
  {
    id: 'conejo',
    label: 'Conejo',
    grupo: 'animal',
    svg:
      '<path d="M108 70 C94 30 98 -4 118 -4 C138 -4 144 30 136 66 Z"/>' +
      '<path d="M196 70 C210 30 206 -4 186 -4 C166 -4 160 30 168 66 Z"/>' +
      linea('M118 14 L122 54 M186 14 L182 54', 3) +
      cabeza() +
      linea('M68 176 L32 170 M70 192 L36 200 M236 176 L272 170 M234 192 L268 200', 3),
  },
  {
    id: 'panda',
    label: 'Panda',
    grupo: 'animal',
    svg:
      circulo(84, 62, 28, 'fill="%A"') +
      circulo(220, 62, 28, 'fill="%A"') +
      cabeza() +
      '<ellipse cx="122" cy="146" rx="28" ry="34" fill="%S" stroke="none" transform="rotate(24 122 146)"/>' +
      '<ellipse cx="194" cy="142" rx="28" ry="34" fill="%S" stroke="none" transform="rotate(-24 194 142)"/>',
  },
  {
    id: 'leon',
    label: 'León',
    grupo: 'animal',
    svg:
      mancha(
        'M152 4 C184 4 198 24 212 26 C240 28 258 52 260 76 C278 98 280 136 266 160 C264 192 240 220 210 226 C192 244 112 244 94 226 C64 220 40 192 38 160 C24 136 26 98 44 76 C46 52 64 28 92 26 C106 24 120 4 152 4 Z',
        3.6
      ) +
      circulo(86, 70, 18) +
      circulo(218, 70, 18) +
      cabeza('M152 50 C206 50 236 82 238 134 C240 186 206 222 152 222 C98 222 64 186 66 134 C68 82 98 50 152 50 Z'),
  },
  {
    id: 'pinguino',
    label: 'Pingüino',
    grupo: 'animal',
    svg:
      cabeza(CABEZA, 'fill="%A"') +
      '<path d="M156 84 C172 66 236 70 240 128 C244 178 208 218 156 222 C104 218 70 178 72 128 C76 70 140 66 156 84 Z" stroke="none"/>',
  },
  {
    id: 'koala',
    label: 'Koala',
    grupo: 'animal',
    svg:
      circulo(64, 86, 44) +
      circulo(240, 86, 44) +
      linea('M44 102 Q44 66 74 60 M260 102 Q260 66 230 60', 3) +
      cabeza(),
  },
  {
    id: 'mono',
    label: 'Mono',
    grupo: 'animal',
    svg:
      circulo(48, 146, 26) +
      circulo(256, 146, 26) +
      linea('M42 134 Q32 146 42 158 M262 134 Q272 146 262 158', 3) +
      cabeza() +
      '<path d="M154 92 C172 70 236 76 232 128 C230 150 222 158 222 172 C220 210 192 222 156 222 C120 222 92 210 90 172 C90 158 82 150 80 128 C76 76 136 70 154 92 Z" fill="none" stroke-width="3"/>',
  },
  {
    id: 'pulpo',
    label: 'Pulpo',
    grupo: 'animal',
    svg:
      TENTACULOS +
      cabeza('M152 22 C218 22 252 76 252 128 C252 184 210 220 152 220 C94 220 52 184 52 128 C52 76 86 22 152 22 Z') +
      punto(98, 70, 8) +
      punto(206, 70, 6) +
      punto(186, 44, 4.5),
  },
];

/* Planetas. */

const crater = (x: number, y: number, r: number) => circulo(x, y, r, 'fill="none" stroke-width="3"');
function banda(y: number, r: number, cy = 140, margen = 0, cx = 152): string {
  const dy = y - cy;
  const m = Math.sqrt(Math.max(0, r * r - dy * dy)) - margen;
  return `M${Math.round(cx - m)} ${y} Q${cx} ${y + 6} ${Math.round(cx + m)} ${y}`;
}
const PLANETA = circulo(152, 140, 104);

const PLANETAS: CabezaFigura[] = [
  {
    id: 'mercurio',
    label: 'Mercurio',
    grupo: 'planeta',
    svg:
      '<path d="M60 120 C46 92 22 74 -6 70 Q4 84 12 88 Q2 98 12 106 Q8 116 24 124 Q24 134 44 138 Z" stroke-width="3"/>' +
      linea('M14 90 Q34 98 50 114 M22 108 Q38 116 48 128', 2.5) +
      '<path d="M244 120 C258 92 282 74 310 70 Q300 84 292 88 Q302 98 292 106 Q296 116 280 124 Q280 134 260 138 Z" stroke-width="3"/>' +
      linea('M290 90 Q270 98 254 114 M282 108 Q266 116 256 128', 2.5) +
      PLANETA +
      crater(96, 92, 9) +
      crater(206, 70, 7) +
      crater(226, 200, 8) +
      crater(84, 196, 6),
  },
  {
    id: 'venus',
    label: 'Venus',
    grupo: 'planeta',
    svg: PLANETA + linea(`${banda(58, 104, 140, 14)} ${banda(78, 104, 140, 4)} ${banda(214, 104, 140, 6)} ${banda(232, 104, 140, 16)}`, 3),
  },
  {
    id: 'tierra',
    label: 'Tierra',
    grupo: 'planeta',
    svg:
      PLANETA +
      mancha('M54 112 C60 82 86 58 116 50 C122 62 110 72 98 76 C90 86 92 100 80 110 C72 118 60 120 54 112 Z') +
      mancha('M60 176 C72 172 86 182 92 198 C96 212 90 222 82 226 C70 214 60 196 60 176 Z') +
      mancha('M214 58 C232 64 246 82 252 104 C240 106 226 96 218 84 Z'),
  },
  {
    id: 'marte',
    label: 'Marte',
    grupo: 'planeta',
    svg:
      PLANETA +
      linea('M112 46 Q152 60 192 46', 3.6, '%A') +
      circulo(80, 196, 10, 'fill="none" stroke="%A" stroke-width="3"') +
      circulo(236, 206, 9, 'fill="none" stroke="%A" stroke-width="3"') +
      punto(232, 86, 5) +
      punto(70, 104, 4),
  },
  {
    id: 'jupiter',
    label: 'Júpiter',
    grupo: 'planeta',
    svg:
      PLANETA +
      linea(`${banda(60, 104)} ${banda(80, 104)} ${banda(216, 104)}`, 3) +
      linea(banda(234, 104, 140, 6), 5) +
      '<ellipse cx="206" cy="70" rx="17" ry="7" fill="%A" stroke-width="2.5"/>',
  },
  {
    id: 'saturno',
    label: 'Saturno',
    grupo: 'planeta',
    svg:
      '<g transform="rotate(-12 152 176)"><ellipse cx="152" cy="176" rx="150" ry="34" fill="none" stroke-width="3.6"/>' +
      '<ellipse cx="152" cy="176" rx="128" ry="24" fill="none" stroke-width="2.5"/></g>' +
      PLANETA +
      '<g transform="rotate(-12 152 176)"><path d="M2 176 A150 34 0 0 0 302 176" fill="none" stroke-width="3.6"/>' +
      '<path d="M24 176 A128 24 0 0 0 280 176" fill="none" stroke-width="2.5"/></g>',
  },
  {
    id: 'urano',
    label: 'Urano',
    grupo: 'planeta',
    svg:
      '<ellipse cx="152" cy="140" rx="30" ry="146" transform="rotate(16 152 140)" fill="none" stroke-width="3.6"/>' +
      PLANETA +
      linea('M70 82 Q100 70 122 74 M200 220 Q222 210 236 192', 2.5),
  },
  {
    id: 'neptuno',
    label: 'Neptuno',
    grupo: 'planeta',
    svg:
      PLANETA +
      '<ellipse cx="88" cy="78" rx="18" ry="11" transform="rotate(-18 88 78)" fill="%A" stroke-width="2.5"/>' +
      linea('M168 50 L216 60 M200 226 L238 210 M64 206 L100 222', 3),
  },
  {
    id: 'pluton',
    label: 'Plutón',
    grupo: 'planeta',
    svg:
      PLANETA +
      '<path d="M66 196 C66 184 82 182 84 194 C86 182 102 184 102 196 C102 210 84 218 84 224 C84 218 66 210 66 196 Z" fill="%A" stroke-width="2.5"/>' +
      crater(100, 76, 6) +
      crater(230, 188, 5),
  },
  {
    id: 'luna',
    label: 'Luna',
    grupo: 'planeta',
    svg: PLANETA + crater(90, 84, 12) + crater(76, 180, 8) + crater(124, 222, 6) + crater(226, 214, 9) + crater(212, 62, 6),
  },
];

/* Constelaciones: coordenadas REALES (ascensión recta h, declinación °, magnitud). */

type Astro = [ra: number, dec: number, mag: number];
interface Constelacion {
  id: string;
  label: string;
  estrellas: Astro[];
  lineas: Array<[number, number]>;
  principal: number;
}

const CONSTELACIONES: Constelacion[] = [
  {
    id: 'orion',
    label: 'Orión',
    estrellas: [
      [5.919, 7.41, 0.5], [5.419, 6.35, 1.6], [5.533, -0.3, 2.2], [5.604, -1.2, 1.7],
      [5.679, -1.94, 1.8], [5.796, -9.67, 2.1], [5.242, -8.2, 0.1], [5.585, 9.93, 3.4],
    ],
    lineas: [[7, 0], [7, 1], [0, 4], [1, 2], [2, 3], [3, 4], [4, 5], [2, 6], [5, 6]],
    principal: 0,
  },
  {
    id: 'osa-mayor',
    label: 'Osa Mayor',
    estrellas: [
      [11.062, 61.75, 1.8], [11.031, 56.38, 2.4], [11.897, 53.69, 2.4], [12.257, 57.03, 3.3],
      [12.9, 55.96, 1.8], [13.399, 54.93, 2.2], [13.792, 49.31, 1.9],
    ],
    lineas: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]],
    principal: 0,
  },
  {
    id: 'casiopea',
    label: 'Casiopea',
    estrellas: [[0.153, 59.15, 2.3], [0.675, 56.54, 2.2], [0.945, 60.72, 2.2], [1.43, 60.24, 2.7], [1.907, 63.67, 3.4]],
    lineas: [[0, 1], [1, 2], [2, 3], [3, 4]],
    principal: 1,
  },
  {
    id: 'escorpio',
    label: 'Escorpio',
    estrellas: [
      [16.49, -26.43, 1.0], [16.091, -19.81, 2.6], [16.006, -22.62, 2.3], [15.981, -26.11, 2.9],
      [16.353, -25.59, 2.9], [16.598, -28.22, 2.8], [16.836, -34.29, 2.3], [16.864, -38.05, 3.0],
      [16.91, -42.36, 3.6], [17.203, -43.24, 3.3], [17.622, -43.0, 1.9], [17.793, -40.13, 3.0],
      [17.708, -39.03, 2.4], [17.56, -37.1, 1.6],
    ],
    lineas: [[1, 2], [2, 3], [2, 4], [4, 0], [0, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 13]],
    principal: 0,
  },
  {
    id: 'lira',
    label: 'Lira (Vega)',
    estrellas: [[18.616, 38.78, 0.0], [18.739, 39.67, 4.7], [18.746, 37.61, 4.3], [18.908, 36.9, 4.3], [18.982, 32.69, 3.3], [18.835, 33.36, 3.5]],
    lineas: [[0, 1], [1, 2], [0, 2], [2, 5], [5, 4], [4, 3], [3, 2]],
    principal: 0,
  },
  {
    id: 'can-mayor',
    label: 'Can Mayor (Sirio)',
    estrellas: [
      [6.752, -16.72, -1.5], [6.378, -17.96, 2.0], [6.977, -28.97, 1.5], [7.14, -26.39, 1.8],
      [7.401, -29.3, 2.4], [6.338, -30.06, 3.0], [7.05, -23.83, 3.0], [7.063, -15.63, 4.1], [6.903, -12.04, 4.1],
    ],
    lineas: [[1, 0], [0, 6], [6, 3], [3, 4], [3, 2], [2, 5], [0, 7], [7, 8], [8, 0]],
    principal: 0,
  },
  {
    id: 'cruz-del-sur',
    label: 'Cruz del Sur',
    estrellas: [[12.443, -63.1, 0.8], [12.795, -59.69, 1.3], [12.519, -57.11, 1.6], [12.252, -58.75, 2.8], [12.356, -60.4, 3.6]],
    lineas: [[0, 2], [1, 3]],
    principal: 0,
  },
  {
    id: 'leo',
    label: 'Leo',
    estrellas: [
      [10.139, 11.97, 1.4], [10.122, 16.76, 3.5], [10.333, 19.84, 2.0], [10.278, 23.42, 3.4], [9.879, 26.01, 3.9],
      [9.764, 23.77, 3.0], [11.818, 14.57, 2.1], [11.235, 20.52, 2.6], [11.237, 15.43, 3.3],
    ],
    lineas: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [2, 7], [7, 6], [6, 8], [8, 0]],
    principal: 0,
  },
  {
    id: 'cisne',
    label: 'Cisne',
    estrellas: [[20.69, 45.28, 1.3], [20.37, 40.26, 2.2], [19.512, 27.96, 3.1], [19.75, 45.13, 2.9], [20.77, 33.97, 2.5], [21.216, 30.23, 3.2]],
    lineas: [[0, 1], [1, 2], [1, 3], [1, 4], [4, 5]],
    principal: 0,
  },
  {
    id: 'osa-menor',
    label: 'Osa Menor',
    estrellas: [[2.53, 89.26, 2.0], [17.537, 86.59, 4.4], [16.766, 82.04, 4.2], [15.734, 77.79, 4.3], [14.845, 74.16, 2.1], [15.345, 71.83, 3.0], [16.292, 75.76, 5.0]],
    lineas: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]],
    principal: 0,
  },
  {
    id: 'pleyades',
    label: 'Pléyades (Atlas)',
    estrellas: [[3.791, 24.11, 2.9], [3.819, 24.05, 3.6], [3.747, 24.11, 3.7], [3.763, 24.37, 3.9], [3.772, 23.95, 4.2], [3.754, 24.47, 4.3], [3.819, 24.14, 5.0]],
    lineas: [[5, 3], [3, 2], [2, 4], [4, 0], [0, 1], [1, 6], [3, 0]],
    principal: 1,
  },
  {
    id: 'geminis',
    label: 'Géminis',
    estrellas: [[7.755, 28.03, 1.1], [7.577, 31.89, 1.6], [6.629, 16.4, 1.9], [6.383, 25.13, 3.0], [6.383, 22.51, 2.9], [7.335, 21.98, 3.5], [7.068, 20.57, 3.9], [6.248, 22.51, 3.3]],
    lineas: [[1, 3], [3, 7], [0, 5], [5, 6], [6, 2], [0, 1], [3, 4]],
    principal: 0,
  },
];

const RAD = Math.PI / 180;
const vector = ([ra, dec]: Astro) => {
  const a = ra * 15 * RAD;
  const d = dec * RAD;
  return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)] as const;
};

/** Proyección gnomónica (norte arriba, este a la izquierda), centrada en (cx0, cy0) y dentro de un círculo de `radio`. */
function proyectar(c: Constelacion, cx0: number, cy0: number, radio: number): Array<[number, number]> {
  const vs = c.estrellas.map(vector);
  const m = vs.reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]);
  const n = Math.hypot(m[0], m[1], m[2]);
  const cen = [m[0] / n, m[1] / n, m[2] / n];
  const ra0 = Math.atan2(cen[1], cen[0]);
  const de0 = Math.asin(cen[2]);
  const e = [-Math.sin(ra0), Math.cos(ra0), 0];
  const no = [-Math.sin(de0) * Math.cos(ra0), -Math.sin(de0) * Math.sin(ra0), Math.cos(de0)];
  const pts = vs.map((v) => {
    const k = v[0] * cen[0] + v[1] * cen[1] + v[2] * cen[2];
    const xi = (v[0] * e[0] + v[1] * e[1] + v[2] * e[2]) / k;
    const eta = (v[0] * no[0] + v[1] * no[1] + v[2] * no[2]) / k;
    return [-xi, -eta] as [number, number];
  });
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [cx, cy] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  const lejos = Math.max(...pts.map(([x, y]) => Math.hypot(x - cx, y - cy)));
  const escala = radio / lejos;
  return pts.map(([x, y]) => [r1(cx0 + (x - cx) * escala), r1(cy0 + (y - cy) * escala)] as [number, number]);
}

const radioEstrella = (mag: number) => Math.max(3, Math.min(6, 5.8 - 0.8 * mag));

/** Destello de 4 puntas (la estrella principal de cada constelación). */
function destello(x: number, y: number, r: number): string {
  const q = r * 0.15;
  const d = [
    `M${r1(x)} ${r1(y - r)}`,
    `Q${r1(x + q)} ${r1(y - q)} ${r1(x + r)} ${r1(y)}`,
    `Q${r1(x + q)} ${r1(y + q)} ${r1(x)} ${r1(y + r)}`,
    `Q${r1(x - q)} ${r1(y + q)} ${r1(x - r)} ${r1(y)}`,
    `Q${r1(x - q)} ${r1(y - q)} ${r1(x)} ${r1(y - r)} Z`,
  ].join(' ');
  return `<path d="${d}" fill="%A" stroke-width="2"/>`;
}

/**
 * Cabeza redonda con la constelación en la FRENTE (encima de las cejas, como
 * una diadema de estrellas): la cara de Lorelei queda limpia debajo. Líneas
 * y estrellas en el acento; la principal, con su destello.
 */
const CONSTELACIONES_C: CabezaFigura[] = CONSTELACIONES.map((c) => {
  const p = proyectar(c, 150, 64, 42);
  const d = c.lineas.map(([a, b]) => `M${p[a][0]} ${p[a][1]} L${p[b][0]} ${p[b][1]}`).join(' ');
  const estrellas = c.estrellas.map((s, i) => (i === c.principal ? '' : punto(p[i][0], p[i][1], radioEstrella(s[2])))).join('');
  const [px, py] = p[c.principal];
  return {
    id: c.id,
    label: c.label,
    grupo: 'constelacion' as const,
    svg: circulo(152, 140, 118) + linea(d, 2.6, '%A') + estrellas + destello(px, py, 12),
  };
});

/* Estrellas y astros. */

/**
 * Media luna: el disco completo (para que la cara quepa) con la parte en
 * sombra en el acento muy tenue y la línea del terminador; lo iluminado es
 * la media luna de la izquierda.
 */
const MEDIA_LUNA = (() => {
  const [cx1, cy1, R] = [152, 142, 116];
  const [cx2, cy2, r] = [226, 104, 104];
  const dx = cx2 - cx1;
  const dy = cy2 - cy1;
  const d = Math.hypot(dx, dy);
  const a = (R * R - r * r + d * d) / (2 * d);
  const h = Math.sqrt(R * R - a * a);
  const mx = cx1 + (a * dx) / d;
  const my = cy1 + (a * dy) / d;
  const p1 = `${r1(mx + (h * dy) / d)} ${r1(my - (h * dx) / d)}`;
  const p2 = `${r1(mx - (h * dy) / d)} ${r1(my + (h * dx) / d)}`;
  const sombra = `M${p1} A${R} ${R} 0 0 1 ${p2} A${r} ${r} 0 0 1 ${p1} Z`;
  return (
    circulo(cx1, cy1, R) +
    `<path d="${sombra}" fill="%s" stroke="none"/>` +
    linea(`M${p2} A${r} ${r} 0 0 1 ${p1}`, 2.5)
  );
})();

const SOL_RAYOS = linea(
  Array.from({ length: 12 }, (_, i) => {
    const a = (i * 30 * Math.PI) / 180;
    const p = (rad: number) => `${Math.round(152 + rad * Math.cos(a))} ${Math.round(140 + rad * Math.sin(a))}`;
    return `M${p(114)} L${p(i % 2 ? 132 : 146)}`;
  }).join(' '),
  5
);

const ESTRELLAS: CabezaFigura[] = [
  { id: 'sol', label: 'Sol', grupo: 'estrella', svg: SOL_RAYOS + circulo(152, 140, 102), pelo: true },
  {
    id: 'estrella',
    label: 'Estrella',
    grupo: 'estrella',
    svg: `<path d="${estrellaPath(154, 152, 156, 98)}" stroke-width="4"/>`,
  },
  {
    id: 'destello',
    label: 'Destello',
    grupo: 'estrella',
    // Destello de 4 puntas alrededor de un disco (la cara cabe en el disco).
    svg:
      '<path d="M154 -4 C166 70 200 106 300 142 C200 178 166 214 154 290 C142 214 108 178 8 142 C108 106 142 70 154 -4 Z" stroke-width="4"/>' +
      circulo(154, 142, 98, 'stroke-width="4"'),
  },
  {
    id: 'luna-creciente',
    label: 'Media luna',
    grupo: 'estrella',
    svg: MEDIA_LUNA + crater(66, 186, 8) + crater(98, 226, 6) + crater(78, 92, 6),
  },
  {
    id: 'cometa',
    label: 'Cometa',
    grupo: 'estrella',
    svg: linea('M84 190 L-6 290 M70 156 L-14 214 M118 216 L66 300', 4.5) + `<path d="${estrellaPath(158, 146, 150, 96)}" stroke-width="4"/>`,
  },
];

/* Robots. */

const ROBOTS: CabezaFigura[] = [
  {
    id: 'clasico',
    label: 'Robot clásico',
    grupo: 'robot',
    svg:
      linea('M154 54 L154 14', 3.6) +
      circulo(154, 10, 10, 'fill="%A"') +
      '<rect x="30" y="104" width="28" height="64" rx="10"/><rect x="250" y="104" width="28" height="64" rx="10"/>' +
      '<rect x="52" y="54" width="204" height="182" rx="38"/>' +
      punto(76, 78, 4.5) +
      punto(232, 78, 4.5) +
      punto(76, 212, 4.5) +
      punto(232, 212, 4.5),
  },
  {
    id: 'pantalla',
    label: 'Robot pantalla',
    grupo: 'robot',
    svg:
      linea('M112 46 L92 12 M196 46 L216 12', 3.6) +
      circulo(90, 8, 7, 'fill="%A"') +
      circulo(218, 8, 7, 'fill="%A"') +
      '<rect x="40" y="42" width="228" height="204" rx="30"/>' +
      '<rect x="62" y="64" width="184" height="160" rx="22" fill="none" stroke="%A" stroke-width="5"/>' +
      punto(72, 236, 3.5) +
      punto(86, 236, 3.5),
  },
  {
    id: 'redondo',
    label: 'Robot redondo',
    grupo: 'robot',
    svg:
      linea('M154 36 L154 8', 3.6) +
      circulo(154, 4, 8, 'fill="%A"') +
      circulo(40, 142, 20) +
      circulo(268, 142, 20) +
      circulo(154, 140, 110) +
      '<path d="M84 84 Q154 60 224 84" fill="none" stroke="%A" stroke-width="4"/>' +
      linea('M104 232 L204 232', 3),
  },
  {
    id: 'cubo',
    label: 'Robot cubo',
    grupo: 'robot',
    svg:
      linea('M154 44 L154 18', 3.6) +
      '<rect x="144" y="4" width="20" height="16" rx="4" fill="%A"/>' +
      '<path d="M46 44 L262 44 L262 244 L46 244 Z" stroke-width="4"/>' +
      linea('M46 226 L262 226', 3) +
      linea('M70 62 L70 86 M58 74 L82 74', 2.5, '%A'),
  },
];

/* ─────────────────────────────── Catálogo ─────────────────────────────── */

export const CABEZAS_FIGURA: readonly CabezaFigura[] = [...ANIMALES, ...PLANETAS, ...CONSTELACIONES_C, ...ESTRELLAS, ...ROBOTS];
const POR_ID = new Map(CABEZAS_FIGURA.map((c) => [c.id, c]));

/** Valores de `head` de las cabezas-figura, en el orden del selector ('figura:gato', …). */
export const VALORES_CABEZA_FIGURA: readonly string[] = CABEZAS_FIGURA.map((c) => PREFIJO_FIGURA + c.id);

function figuraDe(valor: unknown): CabezaFigura | undefined {
  return typeof valor === 'string' && valor.startsWith(PREFIJO_FIGURA) ? POR_ID.get(valor.slice(PREFIJO_FIGURA.length)) : undefined;
}

export const esCabezaFigura = (valor: unknown): valor is string => figuraDe(valor) !== undefined;

/** Nombre visible de una cabeza-figura ('figura:zorro' → 'Zorro'). */
export function etiquetaCabezaFigura(valor: string): string | undefined {
  return figuraDe(valor)?.label;
}

/** ¿El pelo de Lorelei tiene sentido sobre esta figura? (si no, al elegirla el pelo queda en "Ninguno"). */
export function figuraLlevaPelo(valor: string): boolean {
  return figuraDe(valor)?.pelo === true;
}

/* ─────────────────────────────── Dibujo ─────────────────────────────── */

/*
 * Lienzo de 300 → grupo de la cabeza de Lorelei (lienzo 980, dentro de su
 * translate(10 -60)): el punto (152, 140) cae en (505, 470) del avatar, el
 * centro de la zona de la cara; escala 2.85 (las figuras quedan del
 * tamaño de una cabeza de Lorelei y caben en el círculo del avatar).
 */
const ESCALA = 2.85;
const A_LORELEI = `matrix(${ESCALA} 0 0 ${ESCALA} ${r1(495 - 152 * ESCALA)} ${r1(530 - 140 * ESCALA)})`;

const HEX = /^#[0-9a-f]{6}$/i;
const colorValido = (c: unknown, porDefecto: string) => (typeof c === 'string' && HEX.test(c) ? c : porDefecto);

/** Markup de una cabeza-figura en el grupo de la cabeza de Lorelei (colores con "#"); para pruebas y muestras. */
export function cabezaFiguraMarkup(valor: string, piel: string, cabello: string): string {
  const fig = figuraDe(valor);
  if (!fig) throw new Error('Cabeza-figura desconocida.');
  return figuraMarkup(fig, piel, cabello);
}

/**
 * Grosor del trazo de Lorelei 9.4.3 medido en su lienzo de 980 (contornos de
 * las cabezas variant01…04: 2·área/perímetro entre 9,8 y 14) llevado al
 * lienzo de 300 de las figuras (÷ ESCALA).
 */
export const GROSOR_LORELEI = 12.5;
const GROSOR = GROSOR_LORELEI / ESCALA;

/** Dibujo de cada figura ya con el trazo de Lorelei (fichas de color sin resolver), calculado una vez. */
const CON_PINCEL = new Map<string, string>();
function conPincel(fig: CabezaFigura): string {
  let svg = CON_PINCEL.get(fig.id);
  if (svg === undefined) {
    svg = aPincel(fig.svg, GROSOR);
    CON_PINCEL.set(fig.id, svg);
  }
  return svg;
}

/** Mezcla plana de dos colores "#rrggbb" (t = peso del segundo): tonos de sombra sin transparencias. */
function mezcla(a: string, b: string, t: number): string {
  const ca = parseInt(a.slice(1), 16);
  const cb = parseInt(b.slice(1), 16);
  const canal = (sh: number) => Math.round(((ca >> sh) & 255) * (1 - t) + ((cb >> sh) & 255) * t);
  return '#' + ((canal(16) << 16) | (canal(8) << 8) | canal(0)).toString(16).padStart(6, '0');
}

/** Markup de la figura en el grupo de la cabeza de Lorelei (relleno = piel, acento = cabello). */
function figuraMarkup(fig: CabezaFigura, piel: string, cabello: string): string {
  const colores: Record<string, string> = { R: piel, A: cabello, S: mezcla(piel, cabello, 0.28), s: mezcla(piel, cabello, 0.16) };
  const cuerpo = conPincel(fig).replace(/%([RASs])/g, (_m, k: string) => colores[k]);
  return `<g transform="${A_LORELEI}" fill="${piel}">` + cuerpo + '</g>';
}

type EntradaLorelei = Parameters<typeof lorelei.create>[0];
type Resultado = ReturnType<typeof lorelei.create>;
type Opciones = Record<string, unknown>;

/** Valor que no existe en el catálogo de Lorelei: esa parte no se dibuja. */
const VACIO = ['__ninguno__'];
const GRUPO = '<g transform="translate(10 -60)">';

function falla(paso: string): never {
  throw new Error(`[avatar] No se pudo componer la cabeza-figura (${paso}).`);
}

/** Contenido del primer grupo de Lorelei (pelo, cabeza y cara). */
function interior(r: Resultado, cola: string): string {
  if (!r.body.startsWith(GRUPO) || !r.body.endsWith(cola)) falla('estructura');
  return r.body.slice(GRUPO.length, r.body.length - cola.length);
}

/**
 * Style DiceBear "Lorelei con cabezas-figura". Con una cabeza de Lorelei
 * (variant01…04) es exactamente Lorelei; con `head: ['figura:<id>']` cambia la
 * cabeza por la figura y conserva todo lo demás. `hair: []` = sin pelo.
 */
export const loreleiCabezas = {
  meta: lorelei.meta,
  schema: lorelei.schema,
  create({ prng, options }: EntradaLorelei): Resultado {
    const head = (options.head as string[] | undefined)?.[0];
    const fig = figuraDe(head);
    if (!fig) return lorelei.create({ prng, options });

    const pelo = (options.hair as string[] | undefined)?.[0];
    const conPelo = typeof pelo === 'string' && pelo.length > 0;
    const base: Opciones = { ...options, head: ['variant01'], hair: conPelo ? [pelo] : ['variant01'] };
    const render = (cambios: Opciones = {}) => lorelei.create({ prng, options: { ...base, ...cambios } } as EntradaLorelei);

    // 1. Render completo con una cabeza de Lorelei (la que se va a cambiar).
    const completo = render();
    // 2. Cola del cuerpo (cierre del grupo del pelo + flores): render sin pelo.
    const sinPelo = render({ hair: VACIO });
    if (!sinPelo.body.startsWith(GRUPO)) falla('grupo');
    const cola = sinPelo.body.slice(GRUPO.length);
    // 3. Trazos de la cabeza: el pelo variant01 empieza por la cabeza, así que
    //    [cabeza sin cara + pelo01] menos [pelo01] = trazos de la cabeza.
    const sinCara: Opciones = {
      hair: ['variant01'],
      eyes: VACIO,
      eyebrows: VACIO,
      nose: VACIO,
      mouth: VACIO,
      earringsProbability: 0,
      frecklesProbability: 0,
      beardProbability: 0,
      glassesProbability: 0,
    };
    const conCabeza = interior(render(sinCara), cola);
    const pelo01 = interior(render({ ...sinCara, head: VACIO }), cola);
    if (conCabeza.length <= pelo01.length || !conCabeza.endsWith(pelo01)) falla('cabeza');
    const trazos = conCabeza.slice(0, conCabeza.length - pelo01.length);
    // 4. Completo = [pelo de atrás] + trazos + cara + [pelo de adelante];
    //    sin cabeza = [pelo de atrás] + [pelo de adelante].
    const todo = interior(completo, cola);
    const i = todo.indexOf(trazos);
    if (i < 0 || todo.lastIndexOf(trazos) !== i) falla('ubicación');
    const soloPelo = interior(render({ head: VACIO }), cola);
    const atras = todo.slice(0, i);
    if (!soloPelo.startsWith(atras)) falla('pelo de atrás');
    const adelante = soloPelo.slice(i);
    if (todo.length - adelante.length < i + trazos.length || !todo.endsWith(adelante)) falla('pelo de adelante');
    const cara = todo.slice(i + trazos.length, todo.length - adelante.length);

    const extra = (completo.extra?.() ?? {}) as Record<string, unknown>;
    const figura = figuraMarkup(fig, colorValido(extra.skinColor, '#ffffff'), colorValido(extra.hairColor, '#000000'));
    return {
      ...completo,
      body: GRUPO + (conPelo ? atras : '') + figura + cara + (conPelo ? adelante : '') + cola,
      extra: () => ({ ...extra, head, hair: conPelo ? pelo : undefined }),
    };
  },
};
