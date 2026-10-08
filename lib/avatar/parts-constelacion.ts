import { invertirBN } from './noto';
import type { AvatarCategory, AvatarConfig, AvatarOption } from './types';

/**
 * CATÁLOGO — CONSTELACIONES (avatares de asistentes). Dibujo propio.
 *
 * Cada constelación se define con las coordenadas REALES de sus estrellas
 * (ascensión recta en horas, declinación en grados, magnitud) y se proyecta
 * como se ve en el cielo (norte arriba, este a la izquierda). Así la figura
 * es la de verdad y se reconoce: el cinturón de Orión, la "W" de Casiopea, el
 * cucharón de la Osa Mayor.
 *
 * Estilo Notion en blanco y negro: líneas negras de trazo parejo y estrellas
 * como puntos (más grandes las más brillantes) con un anillo blanco que corta
 * la línea donde se cruzan. La estrella principal (Betelgeuse, Vega, Sirio…)
 * se destaca con un destello; puede llevar carita.
 *
 * Contrato: la base guarda ÍNDICES; las opciones nuevas van al final.
 */

type Estrella = [ra: number, dec: number, mag: number];
interface Constelacion {
  label: string;
  estrellas: Estrella[];
  lineas: Array<[number, number]>;
  /** Índice de la estrella que se destaca. */
  principal: number;
}

const CONSTELACIONES: Constelacion[] = [
  {
    label: 'Orión',
    // Betelgeuse, Bellatrix, Mintaka, Alnilam, Alnitak, Saiph, Rigel, Meissa
    estrellas: [
      [5.919, 7.41, 0.5], [5.419, 6.35, 1.6], [5.533, -0.3, 2.2], [5.604, -1.2, 1.7],
      [5.679, -1.94, 1.8], [5.796, -9.67, 2.1], [5.242, -8.2, 0.1], [5.585, 9.93, 3.4],
    ],
    lineas: [[7, 0], [7, 1], [0, 4], [1, 2], [2, 3], [3, 4], [4, 5], [2, 6], [5, 6]],
    principal: 0,
  },
  {
    label: 'Osa Mayor',
    // Dubhe, Merak, Phecda, Megrez, Alioth, Mizar, Alkaid
    estrellas: [
      [11.062, 61.75, 1.8], [11.031, 56.38, 2.4], [11.897, 53.69, 2.4], [12.257, 57.03, 3.3],
      [12.9, 55.96, 1.8], [13.399, 54.93, 2.2], [13.792, 49.31, 1.9],
    ],
    lineas: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]],
    principal: 0,
  },
  {
    label: 'Casiopea',
    // Caph, Schedar, Navi, Ruchbah, Segin
    estrellas: [[0.153, 59.15, 2.3], [0.675, 56.54, 2.2], [0.945, 60.72, 2.2], [1.43, 60.24, 2.7], [1.907, 63.67, 3.4]],
    lineas: [[0, 1], [1, 2], [2, 3], [3, 4]],
    principal: 1,
  },
  {
    label: 'Escorpio',
    // Antares, Graffias, Dschubba, π, σ, τ, ε, μ, ζ, η, θ, ι, κ, Shaula
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
    label: 'Lira (Vega)',
    // Vega, ε, ζ, δ, Sulafat, Sheliak
    estrellas: [[18.616, 38.78, 0.0], [18.739, 39.67, 4.7], [18.746, 37.61, 4.3], [18.908, 36.9, 4.3], [18.982, 32.69, 3.3], [18.835, 33.36, 3.5]],
    lineas: [[0, 1], [1, 2], [0, 2], [2, 5], [5, 4], [4, 3], [3, 2]],
    principal: 0,
  },
  {
    label: 'Can Mayor (Sirio)',
    // Sirio, Mirzam, Adhara, Wezen, Aludra, Furud, ο², Muliphein, θ
    estrellas: [
      [6.752, -16.72, -1.5], [6.378, -17.96, 2.0], [6.977, -28.97, 1.5], [7.14, -26.39, 1.8],
      [7.401, -29.3, 2.4], [6.338, -30.06, 3.0], [7.05, -23.83, 3.0], [7.063, -15.63, 4.1], [6.903, -12.04, 4.1],
    ],
    lineas: [[1, 0], [0, 6], [6, 3], [3, 4], [3, 2], [2, 5], [0, 7], [7, 8], [8, 0]],
    principal: 0,
  },
  {
    label: 'Cruz del Sur',
    // Acrux, Mimosa, Gacrux, δ, ε
    estrellas: [[12.443, -63.1, 0.8], [12.795, -59.69, 1.3], [12.519, -57.11, 1.6], [12.252, -58.75, 2.8], [12.356, -60.4, 3.6]],
    lineas: [[0, 2], [1, 3]],
    principal: 0,
  },
  {
    label: 'Leo',
    // Régulo, η, Algieba, ζ, μ, ε, Denébola, Zosma, Chertan
    estrellas: [
      [10.139, 11.97, 1.4], [10.122, 16.76, 3.5], [10.333, 19.84, 2.0], [10.278, 23.42, 3.4], [9.879, 26.01, 3.9],
      [9.764, 23.77, 3.0], [11.818, 14.57, 2.1], [11.235, 20.52, 2.6], [11.237, 15.43, 3.3],
    ],
    lineas: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [2, 7], [7, 6], [6, 8], [8, 0]],
    principal: 0,
  },
  {
    label: 'Cisne',
    // Deneb, Sadr, Albireo, δ, Gienah, ζ
    estrellas: [[20.69, 45.28, 1.3], [20.37, 40.26, 2.2], [19.512, 27.96, 3.1], [19.75, 45.13, 2.9], [20.77, 33.97, 2.5], [21.216, 30.23, 3.2]],
    lineas: [[0, 1], [1, 2], [1, 3], [1, 4], [4, 5]],
    principal: 0,
  },
  {
    label: 'Osa Menor',
    // Polar, Yildun, ε, ζ, Kochab, Pherkad, η
    estrellas: [[2.53, 89.26, 2.0], [17.537, 86.59, 4.4], [16.766, 82.04, 4.2], [15.734, 77.79, 4.3], [14.845, 74.16, 2.1], [15.345, 71.83, 3.0], [16.292, 75.76, 5.0]],
    lineas: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]],
    principal: 0,
  },
  {
    label: 'Pléyades (Atlas)',
    // Alcíone, Atlas, Electra, Maia, Mérope, Taygeta, Pléyone
    estrellas: [[3.791, 24.11, 2.9], [3.819, 24.05, 3.6], [3.747, 24.11, 3.7], [3.763, 24.37, 3.9], [3.772, 23.95, 4.2], [3.754, 24.47, 4.3], [3.819, 24.14, 5.0]],
    lineas: [[5, 3], [3, 2], [2, 4], [4, 0], [0, 1], [1, 6], [3, 0]],
    principal: 1,
  },
  {
    label: 'Géminis',
    // Pólux, Cástor, Alhena, Mebsuta, Tejat, Wasat, Mekbuda, Propus
    estrellas: [[7.755, 28.03, 1.1], [7.577, 31.89, 1.6], [6.629, 16.4, 1.9], [6.383, 25.13, 3.0], [6.383, 22.51, 2.9], [7.335, 21.98, 3.5], [7.068, 20.57, 3.9], [6.248, 22.51, 3.3]],
    lineas: [[1, 3], [3, 7], [0, 5], [5, 6], [6, 2], [0, 1], [3, 4]],
    principal: 0,
  },
];

/* ───────────────────────── Proyección y dibujo ───────────────────────── */

const RAD = Math.PI / 180;
const vector = ([ra, dec]: Estrella) => {
  const a = ra * 15 * RAD;
  const d = dec * RAD;
  return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)] as const;
};

/** Proyección gnomónica alrededor del centro de la figura, ajustada a la caja. */
function proyectar(c: Constelacion, lado = 168): Array<[number, number]> {
  const vs = c.estrellas.map(vector);
  const m = vs.reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]);
  const n = Math.hypot(m[0], m[1], m[2]);
  const cen = [m[0] / n, m[1] / n, m[2] / n];
  // Ejes locales: este (e) y norte (no) en el centro.
  const ra0 = Math.atan2(cen[1], cen[0]);
  const de0 = Math.asin(cen[2]);
  const e = [-Math.sin(ra0), Math.cos(ra0), 0];
  const no = [-Math.sin(de0) * Math.cos(ra0), -Math.sin(de0) * Math.sin(ra0), Math.cos(de0)];
  const pts = vs.map((v) => {
    const k = v[0] * cen[0] + v[1] * cen[1] + v[2] * cen[2];
    const xi = (v[0] * e[0] + v[1] * e[1] + v[2] * e[2]) / k;
    const eta = (v[0] * no[0] + v[1] * no[1] + v[2] * no[2]) / k;
    return [-xi, -eta] as [number, number]; // este a la izquierda, norte arriba
  });
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const escala = lado / Math.max(x1 - x0, y1 - y0);
  const dx = 150 - ((x0 + x1) / 2) * escala;
  const dy = 150 - ((y0 + y1) / 2) * escala;
  return pts.map(([x, y]) => [Math.round((x * escala + dx) * 10) / 10, Math.round((y * escala + dy) * 10) / 10]);
}

/** Radio del punto según el brillo (magnitud: menor = más brillante). */
const radio = (mag: number) => Math.max(5.5, Math.min(11, 10.5 - 1.3 * mag));

interface Figura {
  lineas: string;
  estrellas: string;
  principal: [number, number];
}

function figura(c: Constelacion): Figura {
  const p = proyectar(c);
  const d = c.lineas.map(([a, b]) => `M${p[a][0]} ${p[a][1]} L${p[b][0]} ${p[b][1]}`).join(' ');
  const lineas = `<path d="${d}" fill="none" stroke-width="6"/>`;
  // Anillo blanco alrededor de cada punto: corta la línea y da aire.
  const estrellas = c.estrellas
    .map((s, i) =>
      i === c.principal ? '' : `<circle cx="${p[i][0]}" cy="${p[i][1]}" r="${radio(s[2])}" fill="#000" stroke="#fff" stroke-width="5"/>`
    )
    .join('');
  return { lineas, estrellas, principal: p[c.principal] };
}

const FIGURAS = CONSTELACIONES.map(figura);

/* ──────────────────────────── Estrella principal ──────────────────────────── */

/** Destello de 4 puntas centrado en (150, 150). */
const DESTELLO =
  '<path d="M150 118 Q154 146 182 150 Q154 154 150 182 Q146 154 118 150 Q146 146 150 118 Z" fill="#000" stroke="#fff" stroke-width="6"/>' +
  '<path d="M150 118 Q154 146 182 150 Q154 154 150 182 Q146 154 118 150 Q146 146 150 118 Z" fill="#000" stroke="#000" stroke-width="2"/>';

const ESTRELLAS: AvatarOption[] = [
  { label: 'Destello', peso: 3, svg: DESTELLO },
  {
    label: 'Punto grande',
    peso: 1,
    svg: '<circle cx="150" cy="150" r="13" fill="#000" stroke="#fff" stroke-width="6"/>',
  },
  {
    label: 'Con carita',
    peso: 2,
    svg:
      '<path d="M150 112 L150 124 M150 176 L150 188 M112 150 L124 150 M176 150 L188 150 M124 124 L131 131 M176 124 L169 131 M124 176 L131 169 M176 176 L169 169" fill="none" stroke-width="5"/>' +
      '<circle cx="150" cy="150" r="22" fill="#fff" stroke-width="6"/>' +
      '<circle cx="142" cy="147" r="3.5" fill="#000" stroke="none"/><circle cx="158" cy="147" r="3.5" fill="#000" stroke="none"/>' +
      '<path d="M142 156 Q150 164 158 156" fill="none" stroke-width="4"/>',
  },
  {
    label: 'Guiño',
    peso: 1,
    svg:
      '<path d="M150 112 L150 124 M150 176 L150 188 M112 150 L124 150 M176 150 L188 150" fill="none" stroke-width="5"/>' +
      '<circle cx="150" cy="150" r="22" fill="#fff" stroke-width="6"/>' +
      '<circle cx="142" cy="147" r="3.5" fill="#000" stroke="none"/><path d="M154 147 L163 147" fill="none" stroke-width="4"/>' +
      '<path d="M141 156 Q151 166 159 154" fill="none" stroke-width="4"/>',
  },
];

/* ──────────────────────────────── Marco ──────────────────────────────── */

const MARCOS: AvatarOption[] = [
  { label: 'Círculo', peso: 2, svg: '<circle cx="150" cy="150" r="128" fill="#fff" stroke-width="6"/>' },
  { label: 'Cielo negro', peso: 2, oscuro: true, svg: '<circle cx="150" cy="150" r="131" fill="#000" stroke="none"/>' },
  { label: 'Sin marco', peso: 1, svg: '' },
];

/* ──────────────────────────────── Cielo ──────────────────────────────── */

const chispa = (x: number, y: number, r: number) =>
  `<path d="M${x} ${y - r} L${x} ${y + r} M${x - r} ${y} L${x + r} ${y}" fill="none" stroke-width="3.5"/>`;

const CIELOS: AvatarOption[] = [
  { label: 'Despejado', peso: 2, svg: '' },
  { label: 'Chispas', peso: 2, // Fuera de la caja de la figura (x 66–234) y dentro del marco.
    svg: chispa(44, 124, 7) + chispa(256, 176, 6) + chispa(60, 198, 5) + chispa(242, 98, 5) },
  {
    label: 'Luna',
    peso: 1,
    svg:
      '<path d="M246 84 A20 20 0 1 0 266 114 A15 15 0 1 1 246 84 Z" fill="#fff" stroke-width="5"/>' + chispa(44, 176, 6),
  },
];

/* ─────────────────────────────── Categorías ─────────────────────────────── */

const OPCIONES_CONSTELACION: AvatarOption[] = FIGURAS.map((f, i) => ({
  label: CONSTELACIONES[i].label,
  svg: f.lineas + f.estrellas + `<g transform="translate(${f.principal[0] - 150} ${f.principal[1] - 150}) scale(1)">${DESTELLO}</g>`,
}));

export const CATEGORIAS_CONSTELACION: AvatarCategory[] = [
  { id: 'constelacion', label: 'Constelación', title: 'Constelaciones', options: OPCIONES_CONSTELACION, thumbViewBox: '40 40 220 220' },
  { id: 'estrella', label: 'Estrella', title: 'Estrella principal', options: ESTRELLAS, thumbViewBox: '100 100 100 100' },
  { id: 'marco', label: 'Marco', title: 'Marcos', options: MARCOS, thumbViewBox: '10 10 280 280' },
  { id: 'cielo', label: 'Cielo', title: 'Cielo', options: CIELOS, thumbViewBox: '20 20 260 260', optional: true },
];

export const ORDEN_CONSTELACION = ['marco', 'cielo', 'constelacion', 'estrella'] as const;

/** Capa compuesta: la figura y la estrella dependen del marco (claro u oscuro). */
export function capaConstelacion(config: AvatarConfig, id: string, svg: string): string {
  const oscuro = !!MARCOS[config.partes.marco ?? 0]?.oscuro;
  const pinta = (s: string) => (oscuro ? invertirBN(`<g stroke="#000" fill="#fff">${s}</g>`) : s);
  if (id === 'constelacion') {
    const f = FIGURAS[config.partes.constelacion ?? 0] ?? FIGURAS[0];
    return pinta(f.lineas + f.estrellas);
  }
  if (id === 'estrella') {
    const f = FIGURAS[config.partes.constelacion ?? 0] ?? FIGURAS[0];
    return pinta(`<g transform="translate(${f.principal[0] - 150} ${f.principal[1] - 150})">${svg}</g>`);
  }
  if (id === 'cielo') return pinta(svg);
  return svg;
}
