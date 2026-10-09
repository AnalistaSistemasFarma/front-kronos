/**
 * FIGURAS para los avatares de los ASISTENTES del chat (animales, planetas,
 * constelaciones, estrellas y robots). Solo los asistentes las usan: los
 * avatares de las personas siguen siendo Lorelei (compose.ts) y no cambian.
 *
 * Dibujo PROPIO de SynerLink (sin dependencias ni piezas de terceros),
 * adaptado del motor de asistentes de la rama feat/avatar-avatartion
 * (commit 8c53716): misma geometría de animales y planetas y las mismas
 * coordenadas reales de las constelaciones, pero solo cabezas (como Lorelei)
 * y con caritas propias, siempre sonrientes. Licencia: la del repositorio.
 *
 * Estilo Notion/Lorelei: línea negra de trazo parejo, relleno blanco y un
 * color de "acento" para las manchas (por defecto negro): blanco y negro de
 * arranque, con los tres colores configurables (relleno, acento y fondo).
 *
 * Código PURO (sin React ni base de datos): lo usan igual el editor del
 * navegador (<img src="data:…">) y el endpoint /api/avatar/agent/<code>. En el
 * SVG solo entran textos de este archivo y colores ya validados (hexadecimal).
 */

/* ───────────────────────────── Modelo ───────────────────────────── */

/** Tipos de figura (además de 'persona', que es Lorelei). */
export type FiguraKind = 'animal' | 'planeta' | 'constelacion' | 'estrella' | 'robot';

/** Lo que se guarda en dbo.avatar_config.config_json para una figura (versión 4). */
export interface FiguraConfig {
  v: 4;
  kind: FiguraKind;
  /** Id de la figura dentro del tipo (p. ej. 'buho', 'saturno', 'orion'). */
  variante: string;
  /** Expresión de la carita (siempre sonriente); 'ninguna' solo en planetas y constelaciones. */
  cara: string;
  /** Accesorio o decorado; null = ninguno. */
  extra: string | null;
  /** Colores en hexadecimal de 6 dígitos sin "#"; el fondo admite 'transparent'. */
  relleno: string;
  acento: string;
  fondo: string;
}

export const FIGURA_KINDS: readonly FiguraKind[] = ['animal', 'planeta', 'constelacion', 'estrella', 'robot'];

export const ETIQUETA_KIND: Readonly<Record<FiguraKind, string>> = {
  animal: 'Animal',
  planeta: 'Planeta',
  constelacion: 'Constelación',
  estrella: 'Estrella',
  robot: 'Robot',
};

export const esFiguraKind = (k: unknown): k is FiguraKind =>
  typeof k === 'string' && (FIGURA_KINDS as readonly string[]).includes(k);

/* ───────────────────────────── Colores ───────────────────────────── */

export type ColorFigura = 'relleno' | 'acento' | 'fondo';
export const COLORES_FIGURA: readonly ColorFigura[] = ['relleno', 'acento', 'fondo'];

export const PALETAS_FIGURA: Readonly<Record<ColorFigura, ReadonlyArray<{ label: string; color: string }>>> = {
  relleno: [
    { label: 'Blanco', color: 'ffffff' },
    { label: 'Gris claro', color: 'e9e9e9' },
    { label: 'Crema', color: 'f6efe0' },
    { label: 'Azul cielo', color: 'b6e3f4' },
    { label: 'Lavanda', color: 'c0aede' },
    { label: 'Pervinca', color: 'd1d4f9' },
    { label: 'Rosa', color: 'ffd5dc' },
    { label: 'Durazno', color: 'ffdfbf' },
    { label: 'Menta', color: 'cdeedd' },
    { label: 'Negro', color: '000000' },
  ],
  acento: [
    { label: 'Negro', color: '000000' },
    { label: 'Gris', color: '6b6b6b' },
    { label: 'Azul', color: '2c1b8f' },
    { label: 'Cobrizo', color: 'a55728' },
    { label: 'Vino', color: '8e2c48' },
    { label: 'Verde', color: '2f6b4f' },
    { label: 'Blanco', color: 'ffffff' },
  ],
  // Los mismos fondos de Lorelei (compose.ts → PALETAS.backgroundColor).
  fondo: [
    { label: 'Gris claro', color: 'f2f2f2' },
    { label: 'Blanco', color: 'ffffff' },
    { label: 'Transparente', color: 'transparent' },
    { label: 'Azul cielo', color: 'b6e3f4' },
    { label: 'Lavanda', color: 'c0aede' },
    { label: 'Pervinca', color: 'd1d4f9' },
    { label: 'Rosa', color: 'ffd5dc' },
    { label: 'Durazno', color: 'ffdfbf' },
  ],
};

/** Blanco y negro de arranque (como Lorelei): relleno blanco, acento negro, fondo gris claro. */
export const COLORES_FIGURA_INICIALES: Readonly<Record<ColorFigura, string>> = {
  relleno: 'ffffff',
  acento: '000000',
  fondo: 'f2f2f2',
};

const HEX = /^[0-9a-f]{6}$/;

/** Tinta legible sobre un color (negro sobre claro, blanco sobre oscuro). */
function contraste(hex: string): string {
  if (!HEX.test(hex)) return '#000';
  const n = parseInt(hex, 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum < 0.5 ? '#fff' : '#000';
}

/* ─────────────────────────── Utilidades SVG ─────────────────────────── */
// Fichas de color dentro de los textos: %R relleno, %A acento,
// %T tinta sobre el relleno, %U tinta sobre el acento. Se reemplazan al final.

const r1 = (n: number) => Math.round(n * 10) / 10;
const linea = (d: string, ancho = 6, color = '') =>
  `<path d="${d}" fill="none" stroke-width="${ancho}"${color ? ` stroke="${color}"` : ''}/>`;
const mancha = (d: string, ancho = 5) => `<path d="${d}" fill="%A" stroke-width="${ancho}"/>`;
const circulo = (x: number, y: number, r: number, extra = '') =>
  `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r)}" ${extra}/>`;
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

/* ───────────────────────────── Caritas ───────────────────────────── */
// Coordenadas propias: punto medio entre los ojos en (0, 0), ojos en ±18; la
// boca se dibuja alrededor de (0, 0) y se baja `dy` (por defecto 22).
// %O = tinta de los ojos, %B = tinta de la boca.

interface Carita {
  label: string;
  ojos: string;
  boca: string;
  cejas?: string;
}

const OJOS_PUNTO = punto(-18, 0, 7, '%O') + punto(18, 0, 7, '%O');
const OJOS_ARCO = linea('M-28 4 Q-18 -10 -8 4 M8 4 Q18 -10 28 4', 6, '%O');
const OJOS_CERRADOS = linea('M-28 -3 Q-18 9 -8 -3 M8 -3 Q18 9 28 -3', 6, '%O');
const OJOS_GRANDES =
  circulo(-18, 0, 12, 'fill="%R" stroke="%O" stroke-width="5"') +
  circulo(18, 0, 12, 'fill="%R" stroke="%O" stroke-width="5"') +
  punto(-15, 2, 6.5, '%O') +
  punto(21, 2, 6.5, '%O');
const OJOS_GUINO = punto(-18, 0, 7, '%O') + linea('M8 3 Q18 -9 28 3', 6, '%O');

const BOCA_SONRISA = linea('M-16 -4 Q0 13 16 -4', 6, '%B');
const BOCA_ABIERTA = '<path d="M-17 -5 Q0 22 17 -5 Z" fill="%B" stroke="%B" stroke-width="5"/>';
const BOCA_PEQUENA = linea('M-10 -2 Q0 8 10 -2', 6, '%B');
const BOCA_PICARA = linea('M-15 -1 Q4 11 17 -6', 6, '%B');
const BOCA_GATUNA = linea('M-16 -4 Q-8 8 0 -1 Q8 8 16 -4', 6, '%B');

export const CARAS: Readonly<Record<string, Carita>> = {
  feliz: { label: 'Feliz', ojos: OJOS_PUNTO, boca: BOCA_SONRISA },
  alegre: { label: 'Alegre', ojos: OJOS_ARCO, boca: BOCA_ABIERTA },
  tranquilo: { label: 'Tranquilo', ojos: OJOS_CERRADOS, boca: BOCA_PEQUENA },
  tierno: {
    label: 'Tierno',
    ojos: OJOS_PUNTO,
    boca: BOCA_PEQUENA,
    // Chapetas de historieta: tres rayitas en cada mejilla.
    cejas: linea('M-38 18 L-35 11 M-31 18 L-28 11 M-24 18 L-21 11 M21 18 L24 11 M28 18 L31 11 M35 18 L38 11', 3.5, '%O'),
  },
  guino: { label: 'Guiño', ojos: OJOS_GUINO, boca: BOCA_PICARA },
  curioso: { label: 'Curioso', ojos: OJOS_GRANDES, boca: BOCA_PEQUENA },
  picaro: {
    label: 'Pícaro',
    ojos: OJOS_PUNTO,
    boca: BOCA_PICARA,
    cejas: linea('M-28 -15 Q-18 -19 -9 -16 M9 -21 Q18 -27 28 -19', 5.5, '%O'),
  },
  gatuno: { label: 'Gatuno', ojos: OJOS_ARCO, boca: BOCA_GATUNA },
  ninguna: { label: 'Sin carita', ojos: '', boca: '' },
};

const CARAS_CON_CARA = Object.keys(CARAS).filter((c) => c !== 'ninguna');

/* ───────────────────────────── Accesorios ───────────────────────────── */

interface Extra {
  label: string;
  /** Dónde se dibuja: sobre la carita, en la coronilla (y de la cabeza = 0) o en el lienzo. */
  en: 'cara' | 'tope' | 'figura';
  svg: string;
  /** Parte que va DETRÁS de la figura (anillos). */
  atras?: string;
}

const ANILLO_ROT = 'transform="rotate(-14 150 150)"';
const ORBITA = (d: string) => `<path d="${d}" fill="none" stroke-width="4" stroke-dasharray="1 11"/>`;

export const EXTRAS: Readonly<Record<string, Extra>> = {
  gafas: {
    label: 'Gafas',
    en: 'cara',
    svg:
      circulo(-18, 0, 13, 'fill="none" stroke-width="4"') +
      circulo(18, 0, 13, 'fill="none" stroke-width="4"') +
      linea('M-5 -2 Q0 -6 5 -2', 4),
  },
  'gafas-sol': {
    label: 'Gafas de sol',
    en: 'cara',
    svg:
      '<path d="M-33 -7 L-4 -7 Q-4 12 -18 12 Q-33 12 -33 -7 Z M4 -7 L33 -7 Q33 12 18 12 Q4 12 4 -7 Z" fill="%A" stroke-width="4"/>' +
      linea('M-4 -4 L4 -4', 4),
  },
  audifonos: {
    label: 'Audífonos',
    en: 'figura',
    svg:
      linea('M70 128 C62 36 238 36 230 128', 9) +
      '<rect x="54" y="116" width="28" height="50" rx="13" fill="%A" stroke-width="5"/>' +
      '<rect x="218" y="116" width="28" height="50" rx="13" fill="%A" stroke-width="5"/>',
  },
  sombrero: {
    label: 'Sombrero',
    en: 'tope',
    svg:
      '<ellipse cx="150" cy="10" rx="84" ry="14" stroke-width="5"/>' +
      '<path d="M106 10 C104 -34 196 -34 194 10 Z" stroke-width="5"/>' +
      mancha('M107 -8 C130 -12 170 -12 193 -8 L194 4 C170 0 130 0 106 4 Z', 4),
  },
  gorra: {
    label: 'Gorra',
    en: 'tope',
    svg:
      '<path d="M92 30 C90 -10 120 -30 150 -30 C180 -30 210 -10 208 30 C170 20 130 20 92 30 Z" stroke-width="5"/>' +
      '<path d="M92 30 C122 18 178 18 208 30 C198 44 102 44 92 30 Z" fill="%A" stroke-width="5"/>' +
      linea('M150 -28 L150 20', 4) +
      punto(150, -30, 5),
  },
  'gorro-fiesta': {
    label: 'Gorro de fiesta',
    en: 'tope',
    svg: '<path d="M150 -56 L124 6 L176 6 Z" stroke-width="5"/>' + linea('M140 -32 L158 -22 M132 -12 L168 -8', 4) + punto(150, -60, 9),
  },
  flor: {
    label: 'Flor',
    en: 'figura',
    svg:
      [0, 72, 144, 216, 288]
        .map((g) => {
          const a = (g * Math.PI) / 180;
          return circulo(214 + 12 * Math.cos(a), 80 + 12 * Math.sin(a), 10, 'stroke-width="4"');
        })
        .join('') + circulo(214, 80, 7, 'fill="%A" stroke-width="4"'),
  },
  luna: {
    label: 'Una luna',
    en: 'figura',
    svg: ORBITA('M190 26 Q240 22 254 62') + circulo(260, 78, 14, 'stroke-width="5"') + punto(256, 74, 3),
  },
  lunas: {
    label: 'Dos lunas',
    en: 'figura',
    svg:
      ORBITA('M190 26 Q240 22 254 62') +
      circulo(260, 78, 14, 'stroke-width="5"') +
      ORBITA('M104 278 Q56 276 44 238') +
      circulo(40, 224, 10, 'fill="%A" stroke-width="5"'),
  },
  anillo: {
    label: 'Anillo',
    en: 'figura',
    atras: `<ellipse cx="150" cy="150" rx="138" ry="30" ${ANILLO_ROT} fill="none" stroke-width="6"/>`,
    svg: `<path d="M12 150 A138 30 0 0 0 288 150" ${ANILLO_ROT} fill="none" stroke-width="6"/>`,
  },
  cohete: {
    label: 'Cohete',
    en: 'figura',
    svg:
      '<g transform="rotate(40 252 58)"><path d="M252 26 C266 40 266 70 260 84 L244 84 C238 70 238 40 252 26 Z" stroke-width="5"/>' +
      '<path d="M244 84 L236 96 L244 92 Z M260 84 L268 96 L260 92 Z" stroke-width="4"/>' +
      punto(252, 52, 5) +
      '</g>',
  },
  chispas: {
    label: 'Chispas',
    en: 'figura',
    svg: linea('M40 50 L40 72 M29 61 L51 61 M262 234 L262 254 M252 244 L272 244 M258 36 L258 50 M251 43 L265 43', 4),
  },
  'luna-cielo': {
    label: 'Luna',
    en: 'figura',
    svg:
      '<path d="M246 76 A20 20 0 1 0 266 106 A15 15 0 1 1 246 76 Z" fill="%R" stroke="%A" stroke-width="5"/>' +
      linea('M44 168 L44 184 M36 176 L52 176', 4, '%A'),
  },
  'chispas-cielo': {
    label: 'Chispas',
    en: 'figura',
    svg: linea(
      'M44 116 L44 132 M36 124 L52 124 M256 170 L256 182 M250 176 L262 176 M60 192 L60 202 M55 197 L65 197 M242 92 L242 102 M237 97 L247 97',
      3.5,
      '%A'
    ),
  },
};

export const etiquetaExtra = (id: string | null): string => (id === null ? 'Ninguno' : EXTRAS[id]?.label ?? id);
export const etiquetaCara = (id: string): string => CARAS[id]?.label ?? id;

/* ───────────────────────────── Variantes ───────────────────────────── */

interface Variante {
  id: string;
  label: string;
  svg: string;
  /** Posición de la carita: centro entre los ojos, escala y bajada de la boca. */
  cara: { x: number; y: number; k: number; dy?: number };
  /** Coronilla (y) para sombreros y gorros. */
  tope?: number;
  /** Los ojos van sobre una mancha de acento (panda). */
  ojosEnAcento?: boolean;
  /** Toda la carita va sobre el acento (pantalla del robot, planeta oscuro). */
  caraEnAcento?: boolean;
}

/* Animales: solo cabeza, de frente (geometría de 8c53716, sin el cuerpo). */

const CABEZA = 'M150 68 C200 68 234 96 236 140 C238 184 200 212 150 212 C100 212 62 184 64 140 C66 96 100 68 150 68 Z';
const cabeza = (d = CABEZA, extra = '') => `<path d="${d}" ${extra}/>`;
const NARIZ_PEQUENA = mancha('M143 154 Q150 151 157 154 Q154 160 150 161 Q146 160 143 154 Z', 3);
const NARIZ_GRANDE = '<ellipse cx="150" cy="156" rx="11" ry="7.5" fill="%A" stroke-width="3"/>';
const BIGOTES = linea('M78 156 L36 150 M78 170 L40 180 M222 156 L264 150 M222 170 L260 180', 5);
const CARA_ANIMAL = { x: 150, y: 134, k: 1.35, dy: 28 };

/** Tentáculos con borde: trazo negro grueso y, encima, el relleno. */
const TENTACULOS = (() => {
  const ds = [
    'M100 176 C70 190 44 202 40 232 C38 250 58 256 64 242',
    'M124 186 C108 214 92 238 96 260 C100 276 120 274 116 260',
    // Los mismos dos, en espejo (x → 300 − x), y uno al centro.
    'M200 176 C230 190 256 202 260 232 C262 250 242 256 236 242',
    'M176 186 C192 214 208 238 204 260 C200 276 180 274 184 260',
    'M150 190 C150 222 146 248 158 268 C164 276 176 268 168 258',
  ];
  return (
    ds.map((d) => `<path d="${d}" fill="none" stroke-width="26"/>`).join('') +
    ds.map((d) => `<path d="${d}" fill="none" stroke="%R" stroke-width="14"/>`).join('')
  );
})();

const ANIMALES: Variante[] = [
  {
    id: 'gato',
    label: 'Gato',
    svg:
      '<path d="M78 122 L88 36 L142 80 Z"/><path d="M222 122 L212 36 L158 80 Z"/>' +
      linea('M98 60 L104 96 M202 60 L196 96') +
      cabeza() +
      NARIZ_PEQUENA +
      BIGOTES,
    cara: { ...CARA_ANIMAL, dy: 26 },
  },
  {
    id: 'perro',
    label: 'Perro',
    svg:
      mancha('M100 82 C62 76 38 128 46 180 C52 202 80 202 88 180 Z', 6) +
      mancha('M200 82 C238 76 262 128 254 180 C248 202 220 202 212 180 Z', 6) +
      cabeza() +
      '<ellipse cx="150" cy="170" rx="34" ry="26" stroke-width="5"/>' +
      NARIZ_GRANDE,
    cara: { ...CARA_ANIMAL, dy: 30 },
  },
  {
    id: 'zorro',
    label: 'Zorro',
    svg:
      '<path d="M84 122 L84 40 L138 86 Z"/><path d="M216 122 L216 40 L162 86 Z"/>' +
      mancha('M90 62 L92 92 L112 82 Z', 3) +
      mancha('M210 62 L208 92 L188 82 Z', 3) +
      cabeza('M150 76 C194 76 226 100 228 136 C230 166 190 200 150 210 C110 200 70 166 72 136 C74 100 106 76 150 76 Z') +
      linea('M76 150 C104 146 124 152 136 168 M224 150 C196 146 176 152 164 168', 5) +
      NARIZ_PEQUENA,
    cara: { ...CARA_ANIMAL, k: 1.25, dy: 28 },
    tope: 76,
  },
  {
    id: 'buho',
    label: 'Búho',
    svg:
      '<path d="M88 104 L80 52 L126 82 Z"/><path d="M212 104 L220 52 L174 82 Z"/>' +
      cabeza() +
      circulo(116, 134, 30, 'stroke-width="5"') +
      circulo(184, 134, 30, 'stroke-width="5"') +
      mancha('M141 160 L159 160 L150 176 Z', 4) +
      linea('M134 74 Q150 88 166 74', 5),
    cara: { x: 150, y: 134, k: 1.6, dy: 32 },
  },
  {
    id: 'oso',
    label: 'Oso',
    svg:
      circulo(88, 84, 25) +
      circulo(212, 84, 25) +
      linea('M80 94 Q80 76 96 74 M220 94 Q220 76 204 74', 5) +
      cabeza() +
      '<ellipse cx="150" cy="168" rx="32" ry="24" stroke-width="5"/>' +
      NARIZ_GRANDE,
    cara: { ...CARA_ANIMAL, dy: 29 },
  },
  {
    id: 'conejo',
    label: 'Conejo',
    svg:
      '<path d="M114 96 C98 46 104 12 122 12 C140 12 144 50 138 92 Z"/>' +
      '<path d="M186 96 C202 46 196 12 178 12 C160 12 156 50 162 92 Z"/>' +
      linea('M122 34 L126 80 M178 34 L174 80', 5) +
      cabeza() +
      NARIZ_PEQUENA +
      linea('M84 158 L50 154 M84 170 L54 176 M216 158 L250 154 M216 170 L246 176', 5),
    cara: { ...CARA_ANIMAL, dy: 26 },
  },
  {
    id: 'panda',
    label: 'Panda',
    svg:
      circulo(88, 84, 24, 'fill="%A"') +
      circulo(212, 84, 24, 'fill="%A"') +
      cabeza() +
      '<ellipse cx="124" cy="136" rx="21" ry="26" fill="%A" stroke="none" transform="rotate(28 124 136)"/>' +
      '<ellipse cx="176" cy="136" rx="21" ry="26" fill="%A" stroke="none" transform="rotate(-28 176 136)"/>' +
      NARIZ_GRANDE,
    cara: { x: 150, y: 134, k: 1.45, dy: 27 },
    ojosEnAcento: true,
  },
  {
    id: 'leon',
    label: 'León',
    svg:
      mancha(
        'M150 40 C176 40 188 56 200 58 C222 60 236 80 238 100 C252 118 254 150 242 170 C240 196 220 218 196 222 C182 236 118 236 104 222 C80 218 60 196 58 170 C46 150 48 118 62 100 C64 80 78 60 100 58 C112 56 124 40 150 40 Z',
        6
      ) +
      circulo(104, 94, 14) +
      circulo(196, 94, 14) +
      cabeza('M150 82 C190 82 214 104 216 140 C218 176 190 200 150 200 C110 200 82 176 84 140 C86 104 110 82 150 82 Z') +
      '<ellipse cx="150" cy="170" rx="27" ry="20" stroke-width="5"/>' +
      mancha('M141 156 L159 156 L150 165 Z', 3),
    cara: { x: 150, y: 134, k: 1.2, dy: 32 },
    tope: 44,
  },
  {
    id: 'pinguino',
    label: 'Pingüino',
    svg:
      cabeza(CABEZA, 'fill="%A"') +
      '<path d="M150 104 C162 90 202 92 206 128 C210 166 184 196 150 200 C116 196 90 166 94 128 C98 92 138 90 150 104 Z" stroke="none"/>' +
      '<path d="M139 154 L161 154 L150 167 Z" fill="%A" stroke-width="4"/>',
    cara: { x: 150, y: 136, k: 1.25, dy: 34 },
  },
  {
    id: 'koala',
    label: 'Koala',
    svg:
      circulo(78, 106, 36) +
      circulo(222, 106, 36) +
      linea('M62 118 Q62 90 86 86 M238 118 Q238 90 214 86', 5) +
      cabeza() +
      '<ellipse cx="150" cy="152" rx="14" ry="20" fill="%A" stroke-width="3"/>',
    cara: { x: 150, y: 132, k: 1.45, dy: 32 },
  },
  {
    id: 'mono',
    label: 'Mono',
    svg:
      circulo(62, 142, 22) +
      circulo(238, 142, 22) +
      linea('M58 132 Q50 142 58 152 M242 132 Q250 142 242 152', 5) +
      cabeza() +
      '<path d="M150 112 C164 96 204 100 200 136 C198 152 190 158 190 170 C188 196 168 202 150 202 C132 202 112 196 110 170 C110 158 102 152 100 136 C96 100 136 96 150 112 Z" fill="none" stroke-width="5"/>' +
      punto(145, 160, 3) +
      punto(155, 160, 3),
    cara: { x: 150, y: 136, k: 1.2, dy: 36 },
  },
  {
    id: 'pulpo',
    label: 'Pulpo',
    svg:
      TENTACULOS +
      cabeza('M150 46 C206 46 236 90 236 132 C236 170 200 192 150 192 C100 192 64 170 64 132 C64 90 94 46 150 46 Z') +
      punto(112, 82, 8) +
      punto(190, 90, 6) +
      punto(172, 66, 4.5),
    cara: { x: 150, y: 132, k: 1.4, dy: 24 },
    tope: 46,
  },
];

/* Planetas (geometría de 8c53716). */

const crater = (x: number, y: number, r: number) => circulo(x, y, r, 'stroke-width="5"');
function banda(y: number, r: number, cy = 150, margen = 0): string {
  const dy = y - cy;
  const m = Math.sqrt(Math.max(0, r * r - dy * dy)) - margen;
  return `M${Math.round(150 - m)} ${y} Q150 ${y + 6} ${Math.round(150 + m)} ${y}`;
}

const PLANETAS: Variante[] = [
  {
    id: 'mercurio',
    label: 'Mercurio',
    svg:
      '<path d="M76 136 C64 112 44 96 18 92 Q26 104 34 108 Q26 116 34 124 Q30 132 44 140 Q44 148 62 152 Z" stroke-width="5"/>' +
      linea('M36 110 Q54 116 68 130 M42 126 Q56 132 66 142', 4) +
      '<path d="M224 136 C236 112 256 96 282 92 Q274 104 266 108 Q274 116 266 124 Q270 132 256 140 Q256 148 238 152 Z" stroke-width="5"/>' +
      linea('M264 110 Q246 116 232 130 M258 126 Q244 132 234 142', 4) +
      circulo(150, 156, 86) +
      crater(104, 114, 10) +
      crater(196, 104, 7) +
      crater(206, 204, 9) +
      crater(98, 204, 6),
    cara: { x: 150, y: 150, k: 1.3 },
    tope: 70,
  },
  {
    id: 'venus',
    label: 'Venus',
    svg:
      circulo(150, 150, 100) +
      linea(
        `${banda(84, 100, 150, 14)} M78 108 Q120 96 160 106 T222 104 M70 206 Q110 196 150 210 T230 200 ${banda(232, 100, 150, 16)}`,
        5
      ),
    cara: { x: 150, y: 146, k: 1.5 },
    tope: 50,
  },
  {
    id: 'tierra',
    label: 'Tierra',
    svg:
      circulo(150, 150, 100) +
      mancha('M62 102 C70 76 96 58 122 62 C126 74 116 82 104 86 C98 96 104 108 92 118 C84 126 70 124 62 102 Z', 4) +
      mancha('M176 196 C192 186 214 192 218 206 C222 224 204 236 194 246 C186 238 184 224 176 216 C170 208 170 200 176 196 Z', 4) +
      mancha('M206 82 C220 80 232 92 236 108 C226 112 214 104 206 96 Z', 4),
    cara: { x: 146, y: 146, k: 1.45 },
    tope: 50,
  },
  {
    id: 'marte',
    label: 'Marte',
    svg:
      circulo(150, 150, 100, 'fill="%A"') +
      linea('M112 60 Q150 76 188 60', 6, '%U') +
      circulo(88, 196, 10, 'fill="none" stroke="%U" stroke-width="5"') +
      circulo(212, 210, 13, 'fill="none" stroke="%U" stroke-width="5"') +
      punto(216, 106, 5, '%U'),
    cara: { x: 150, y: 146, k: 1.5 },
    tope: 50,
    caraEnAcento: true,
  },
  {
    id: 'jupiter',
    label: 'Júpiter',
    svg:
      circulo(150, 150, 100) +
      linea(`${banda(82, 100)} ${banda(104, 100)} ${banda(214, 100)}`, 5) +
      linea(banda(238, 100, 150, 4), 9) +
      '<ellipse cx="206" cy="194" rx="22" ry="12" fill="%A" stroke-width="5"/>',
    cara: { x: 146, y: 144, k: 1.4 },
    tope: 50,
  },
  {
    id: 'saturno',
    label: 'Saturno',
    svg:
      '<g transform="rotate(-14 150 160)"><ellipse cx="150" cy="160" rx="140" ry="34" fill="none" stroke-width="6"/>' +
      '<ellipse cx="150" cy="160" rx="118" ry="24" fill="none" stroke-width="4"/></g>' +
      circulo(150, 150, 76) +
      '<g transform="rotate(-14 150 160)"><path d="M10 160 A140 34 0 0 0 290 160" fill="none" stroke-width="6"/>' +
      '<path d="M32 160 A118 24 0 0 0 268 160" fill="none" stroke-width="4"/></g>',
    cara: { x: 150, y: 128, k: 1.1, dy: 20 },
    tope: 74,
  },
  {
    id: 'urano',
    label: 'Urano',
    svg:
      '<ellipse cx="150" cy="150" rx="30" ry="138" transform="rotate(14 150 150)" fill="none" stroke-width="6"/>' +
      circulo(150, 150, 90) +
      linea('M88 96 Q118 86 138 90 M196 220 Q214 212 226 196', 4),
    cara: { x: 150, y: 146, k: 1.35 },
    tope: 60,
  },
  {
    id: 'neptuno',
    label: 'Neptuno',
    svg:
      circulo(150, 150, 100) +
      '<ellipse cx="98" cy="96" rx="20" ry="12" transform="rotate(-18 98 96)" fill="%A" stroke-width="4"/>' +
      linea('M168 76 L214 84 M186 226 L232 210 M70 218 L108 230 M200 102 L228 110', 5),
    cara: { x: 152, y: 150, k: 1.45 },
    tope: 50,
  },
  {
    id: 'pluton',
    label: 'Plutón',
    svg:
      circulo(150, 156, 80) +
      '<path d="M186 184 C186 174 200 172 202 182 C204 172 218 174 218 184 C218 196 202 204 202 208 C202 204 186 196 186 184 Z" fill="%A" stroke-width="4"/>' +
      crater(110, 110, 6),
    cara: { x: 142, y: 148, k: 1.15 },
    tope: 76,
  },
  {
    id: 'luna',
    label: 'Luna',
    svg:
      circulo(150, 150, 98) +
      '<path d="M150 52 A98 98 0 0 1 150 248 A60 98 0 0 0 150 52 Z" fill="%A" stroke-width="5"/>' +
      crater(98, 98, 10) +
      crater(86, 196, 7) +
      crater(130, 230, 5),
    cara: { x: 112, y: 146, k: 1.0 },
    tope: 52,
  },
];

/* Constelaciones: coordenadas REALES (ascensión recta h, declinación °, magnitud), de 8c53716. */

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

/** Proyección gnomónica alrededor del centro de la figura (norte arriba, este a la izquierda). */
function proyectar(c: Constelacion, lado = 168, radio = 76): Array<[number, number]> {
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
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // Centrada en su caja y escalada para que quepa en un círculo de radio
  // `radio`: así la estrella principal (con rayos) nunca pisa el borde del cielo.
  const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
  const lejos = Math.max(...pts.map(([x, y]) => Math.hypot(x - cx, y - cy)));
  const escala = Math.min(lado / Math.max(x1 - x0, y1 - y0), radio / lejos);
  return pts.map(([x, y]) => [r1(150 + (x - cx) * escala), r1(150 + (y - cy) * escala)] as [number, number]);
}

const radioEstrella = (mag: number) => Math.max(5.5, Math.min(11, 10.5 - 1.3 * mag));

/** Estrella principal de cada constelación (posición en el lienzo). */
const PRINCIPALES: Record<string, [number, number]> = {};

/** Cielo circular (relleno) con líneas y estrellas en el acento; la principal se dibuja aparte. */
const CONSTELACIONES_V: Variante[] = CONSTELACIONES.map((c) => {
  const p = proyectar(c);
  const d = c.lineas.map(([a, b]) => `M${p[a][0]} ${p[a][1]} L${p[b][0]} ${p[b][1]}`).join(' ');
  const estrellas = c.estrellas
    .map((s, i) =>
      i === c.principal ? '' : circulo(p[i][0], p[i][1], radioEstrella(s[2]), 'fill="%A" stroke="%R" stroke-width="5"')
    )
    .join('');
  PRINCIPALES[c.id] = p[c.principal];
  return {
    id: c.id,
    label: c.label,
    svg: circulo(150, 150, 130, 'stroke-width="6"') + linea(d, 6, '%A') + estrellas,
    cara: { x: p[c.principal][0], y: p[c.principal][1] - 2, k: 0.58, dy: 20 },
  };
});

/** Estrella principal: destello de 4 puntas (sin carita) o solecito con carita. */
function estrellaPrincipal(x: number, y: number, conCara: boolean): string {
  if (!conCara) {
    const d = `M${x} ${y - 34} Q${x + 5} ${y - 5} ${x + 34} ${y} Q${x + 5} ${y + 5} ${x} ${y + 34} Q${x - 5} ${y + 5} ${x - 34} ${y} Q${x - 5} ${y - 5} ${x} ${y - 34} Z`;
    return `<path d="${d}" fill="%A" stroke="%R" stroke-width="6"/><path d="${d}" fill="%A" stroke="%A" stroke-width="2"/>`;
  }
  const rayos = Array.from({ length: 8 }, (_, i) => {
    const a = (i * 45 * Math.PI) / 180;
    const p = (r: number) => `${r1(x + r * Math.cos(a))} ${r1(y + r * Math.sin(a))}`;
    return `M${p(31)} L${p(i % 2 ? 36 : 41)}`;
  }).join(' ');
  return linea(rayos, 5, '%A') + circulo(x, y, 26, 'stroke="%A" stroke-width="5"');
}

/* Estrellas y astros (propios). */

/** Media luna: círculo grande menos uno desplazado (puntos de corte calculados). */
const MEDIA_LUNA = (() => {
  const [cx1, cy1, R] = [150, 150, 112];
  const [cx2, cy2, r] = [214, 116, 96];
  const dx = cx2 - cx1;
  const dy = cy2 - cy1;
  const d = Math.hypot(dx, dy);
  const a = (R * R - r * r + d * d) / (2 * d);
  const h = Math.sqrt(R * R - a * a);
  const mx = cx1 + (a * dx) / d;
  const my = cy1 + (a * dy) / d;
  const p1 = [r1(mx + (h * dy) / d), r1(my - (h * dx) / d)];
  const p2 = [r1(mx - (h * dy) / d), r1(my + (h * dx) / d)];
  return `M${p1[0]} ${p1[1]} A${R} ${R} 0 1 0 ${p2[0]} ${p2[1]} A${r} ${r} 0 0 1 ${p1[0]} ${p1[1]} Z`;
})();

const SOL_RAYOS = linea(
  Array.from({ length: 12 }, (_, i) => {
    const a = (i * 30 * Math.PI) / 180;
    const p = (rad: number) => `${Math.round(150 + rad * Math.cos(a))} ${Math.round(150 + rad * Math.sin(a))}`;
    return `M${p(96)} L${p(i % 2 ? 120 : 136)}`;
  }).join(' '),
  9
);

const ESTRELLAS: Variante[] = [
  { id: 'sol', label: 'Sol', svg: SOL_RAYOS + circulo(150, 150, 82), cara: { x: 150, y: 144, k: 1.35 }, tope: 68 },
  {
    id: 'estrella',
    label: 'Estrella',
    svg: `<path d="${estrellaPath(150, 160, 126, 62)}" stroke-width="7"/>`,
    cara: { x: 150, y: 160, k: 1.15, dy: 20 },
    tope: 40,
  },
  {
    id: 'destello',
    label: 'Destello',
    svg: '<path d="M150 20 C160 112 188 140 280 150 C188 160 160 188 150 280 C140 188 112 160 20 150 C112 140 140 112 150 20 Z" stroke-width="7"/>',
    cara: { x: 150, y: 146, k: 1.0, dy: 20 },
    tope: 24,
  },
  {
    id: 'luna-creciente',
    label: 'Media luna',
    svg: `<path d="${MEDIA_LUNA}" stroke-width="7"/>` + crater(84, 214, 7) + crater(124, 244, 5),
    cara: { x: 84, y: 160, k: 1.0, dy: 21 },
    tope: 60,
  },
  {
    id: 'cometa',
    label: 'Cometa',
    svg:
      linea('M140 160 L42 258 M120 138 L36 196 M162 182 L104 266', 7) +
      `<path d="${estrellaPath(180, 124, 78, 38)}" stroke-width="7"/>`,
    cara: { x: 180, y: 126, k: 0.75, dy: 20 },
    tope: 48,
  },
];

/* Robots (propios). */

const ROBOTS: Variante[] = [
  {
    id: 'clasico',
    label: 'Robot clásico',
    svg:
      linea('M150 82 L150 48', 6) +
      circulo(150, 42, 10, 'fill="%A"') +
      '<rect x="50" y="118" width="24" height="48" rx="9"/><rect x="226" y="118" width="24" height="48" rx="9"/>' +
      '<rect x="70" y="80" width="160" height="142" rx="30"/>' +
      punto(92, 102, 4.5) +
      punto(208, 102, 4.5) +
      punto(92, 200, 4.5) +
      punto(208, 200, 4.5),
    cara: { x: 150, y: 142, k: 1.45, dy: 24 },
    tope: 80,
  },
  {
    id: 'pantalla',
    label: 'Robot pantalla',
    svg:
      linea('M118 76 L98 44 M182 76 L202 44', 6) +
      circulo(96, 40, 7, 'fill="%A"') +
      circulo(204, 40, 7, 'fill="%A"') +
      '<rect x="58" y="74" width="184" height="156" rx="24"/>' +
      '<rect x="78" y="94" width="144" height="112" rx="18" fill="%A" stroke-width="5"/>' +
      punto(88, 218, 4) +
      punto(104, 218, 4),
    cara: { x: 150, y: 140, k: 1.45, dy: 24 },
    tope: 74,
    caraEnAcento: true,
  },
  {
    id: 'redondo',
    label: 'Robot redondo',
    svg:
      linea('M150 64 L150 40', 6) +
      circulo(150, 34, 8, 'fill="%A"') +
      circulo(60, 150, 18) +
      circulo(240, 150, 18) +
      circulo(150, 150, 88) +
      '<rect x="86" y="104" width="128" height="80" rx="40" fill="%A" stroke-width="5"/>' +
      linea('M104 214 L196 214', 5),
    cara: { x: 150, y: 138, k: 1.25, dy: 22 },
    tope: 62,
    caraEnAcento: true,
  },
  {
    id: 'cubo',
    label: 'Robot cubo',
    svg:
      linea('M120 70 Q110 48 124 38 M180 70 Q190 48 176 38', 6) +
      '<path d="M66 70 L234 70 L234 226 L66 226 Z" stroke-width="7"/>' +
      linea('M66 186 L234 186', 5) +
      '<rect x="102" y="198" width="96" height="16" rx="6" fill="%A" stroke-width="4"/>' +
      linea('M122 198 L122 214 M150 198 L150 214 M178 198 L178 214', 3, '%R'),
    cara: { x: 150, y: 128, k: 1.5, dy: 24 },
    tope: 70,
  },
];

/* ─────────────────────────── Catálogo por tipo ─────────────────────────── */

interface DefKind {
  variantes: Variante[];
  caras: readonly string[];
  extras: readonly string[];
  /** Transformación de todo el dibujo (los animales bajan un poco: no tienen cuerpo). */
  transform?: string;
}

const KINDS: Readonly<Record<FiguraKind, DefKind>> = {
  animal: {
    variantes: ANIMALES,
    caras: CARAS_CON_CARA,
    extras: ['gafas', 'gafas-sol', 'audifonos', 'sombrero', 'gorra', 'flor'],
    transform: 'translate(0 14)',
  },
  planeta: { variantes: PLANETAS, caras: Object.keys(CARAS), extras: ['luna', 'lunas', 'anillo', 'chispas', 'cohete', 'gafas-sol'] },
  constelacion: { variantes: CONSTELACIONES_V, caras: Object.keys(CARAS), extras: ['chispas-cielo', 'luna-cielo'] },
  estrella: { variantes: ESTRELLAS, caras: CARAS_CON_CARA, extras: ['chispas', 'gafas-sol', 'gorro-fiesta'] },
  robot: { variantes: ROBOTS, caras: CARAS_CON_CARA, extras: ['chispas', 'gafas-sol', 'gorro-fiesta'] },
};

export const variantesDe = (kind: FiguraKind): readonly string[] => KINDS[kind].variantes.map((v) => v.id);
export const carasDe = (kind: FiguraKind): readonly string[] => KINDS[kind].caras;
export const extrasDe = (kind: FiguraKind): readonly string[] => KINDS[kind].extras;

function variante(config: FiguraConfig): Variante {
  const lista = KINDS[config.kind].variantes;
  return lista.find((v) => v.id === config.variante) ?? lista[0];
}

export function etiquetaVariante(kind: FiguraKind, id: string): string {
  return KINDS[kind].variantes.find((v) => v.id === id)?.label ?? id;
}

/* ───────────────────────────── Validación ───────────────────────────── */

const CLAVES = new Set(['v', 'kind', 'variante', 'cara', 'extra', 'relleno', 'acento', 'fondo']);

/**
 * Valida una figura que llega de afuera (ya como objeto). Devuelve una copia
 * LIMPIA o null. Estricta: solo claves conocidas; tipo, variante, carita y
 * accesorio del catálogo DE ESE TIPO; colores hexadecimales de 6 dígitos.
 */
export function parseFiguraConfig(valor: unknown): FiguraConfig | null {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null;
  const o = valor as Record<string, unknown>;
  if (o.v !== 4 || !esFiguraKind(o.kind)) return null;
  for (const clave of Object.keys(o)) if (!CLAVES.has(clave)) return null;
  const kind = o.kind;
  if (typeof o.variante !== 'string' || !variantesDe(kind).includes(o.variante)) return null;
  if (typeof o.cara !== 'string' || !carasDe(kind).includes(o.cara)) return null;
  const extra = o.extra ?? null;
  if (extra !== null && (typeof extra !== 'string' || !extrasDe(kind).includes(extra))) return null;
  for (const c of COLORES_FIGURA) {
    const v = o[c];
    if (typeof v !== 'string' || !(HEX.test(v) || (c === 'fondo' && v === 'transparent'))) return null;
  }
  return {
    v: 4,
    kind,
    variante: o.variante,
    cara: o.cara,
    extra: extra as string | null,
    relleno: o.relleno as string,
    acento: o.acento as string,
    fondo: o.fondo as string,
  };
}

/** JSON compacto para guardar (orden de claves estable, ~130 caracteres). */
export function serializeFiguraConfig(c: FiguraConfig): string {
  return JSON.stringify({
    v: 4,
    kind: c.kind,
    variante: c.variante,
    cara: c.cara,
    extra: c.extra ?? null,
    relleno: c.relleno,
    acento: c.acento,
    fondo: c.fondo,
  });
}

/* ─────────────────────── Por defecto (por nombre) ─────────────────────── */

const normalizar = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

/** FNV-1a de 32 bits: el mismo nombre da siempre la misma figura. */
function hash(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Los asistentes de OLP llevan nombres de astros y astrónomos: cada uno
 * arranca con lo suyo cuando el tipo lo permite (Orión → su constelación,
 * Vega → Lira, Sirio → Can Mayor, Atlas → Pléyades, Mercurio → su planeta,
 * Galileo → Júpiter, cuyas lunas descubrió; Kepler → Marte, de cuya órbita
 * sacó sus leyes). El resto sale del hash del nombre.
 */
const SUGERENCIAS: Partial<Record<FiguraKind, Record<string, string>>> = {
  constelacion: { orion: 'orion', vega: 'lira', sirio: 'can-mayor', atlas: 'pleyades' },
  planeta: { mercurio: 'mercurio', galileo: 'jupiter', kepler: 'marte' },
  estrella: { sirio: 'destello', vega: 'estrella' },
};

/** Figura por defecto de un asistente para un tipo: determinista por su nombre. */
export function figuraPorDefecto(
  kind: FiguraKind,
  nombre: string,
  colores: Partial<Record<ColorFigura, string>> = {}
): FiguraConfig {
  const n = normalizar(nombre) || 'asistente';
  const h = hash(`${kind}:${n}`);
  const variantes = variantesDe(kind);
  const sugerida = SUGERENCIAS[kind]?.[n.split(/\s+/)[0] ?? ''];
  const caras = carasDe(kind).filter((c) => c !== 'ninguna');
  return {
    v: 4,
    kind,
    variante: sugerida && variantes.includes(sugerida) ? sugerida : variantes[h % variantes.length],
    cara: caras[(h >>> 8) % caras.length],
    extra: null,
    ...COLORES_FIGURA_INICIALES,
    ...colores,
  };
}

/** Figura al azar del tipo, conservando los colores. Accesorio en ~1 de cada 3. */
export function figuraAleatoria(
  kind: FiguraKind,
  colores: Partial<Record<ColorFigura, string>> = {},
  rnd: () => number = Math.random
): FiguraConfig {
  const elegir = <T,>(lista: readonly T[]): T => lista[Math.floor(rnd() * lista.length) % lista.length];
  const extras = extrasDe(kind);
  return {
    v: 4,
    kind,
    variante: elegir(variantesDe(kind)),
    cara: elegir(carasDe(kind).filter((c) => c !== 'ninguna')),
    extra: rnd() < 0.35 ? elegir(extras) : null,
    ...COLORES_FIGURA_INICIALES,
    ...colores,
  };
}

/* ─────────────────────────────── Dibujo ─────────────────────────────── */

/** Centro de la carita en el lienzo de 300 (para recortar su miniatura). */
export function posicionCara(config: FiguraConfig): { x: number; y: number; k: number } {
  const v = variante(config);
  const t = config.kind === 'animal' ? 14 : 0;
  return { x: v.cara.x, y: v.cara.y + t, k: v.cara.k };
}

function carita(config: FiguraConfig, v: Variante): string {
  const cara = CARAS[config.cara] ?? CARAS.feliz;
  const { x, y, k, dy = 22 } = v.cara;
  const extra = config.extra ? EXTRAS[config.extra] : undefined;
  const sobreCara = extra?.en === 'cara' ? extra.svg : '';
  if (!cara.ojos && !sobreCara) return '';
  const tOjos = v.caraEnAcento || v.ojosEnAcento ? '%U' : '%T';
  const tBoca = v.caraEnAcento ? '%U' : '%T';
  const ojos = (cara.ojos + (cara.cejas ?? '')).replace(/%O/g, tOjos);
  const boca = cara.boca.replace(/%B/g, tBoca);
  return (
    `<g transform="translate(${r1(x)} ${r1(y)}) scale(${k})">` +
    ojos +
    (boca ? `<g transform="translate(0 ${dy})">${boca}</g>` : '') +
    sobreCara +
    '</g>'
  );
}

function pintar(svg: string, c: FiguraConfig): string {
  const colores: Record<string, string> = {
    R: `#${c.relleno}`,
    A: `#${c.acento}`,
    T: contraste(c.relleno),
    U: contraste(c.acento),
  };
  return svg.replace(/%([RATU])/g, (_m, k: string) => colores[k]);
}

/** Cuerpo del dibujo (sin <svg> ni fondo), en el lienzo de 300×300. */
export function figuraMarkup(config: FiguraConfig): string {
  const def = KINDS[config.kind];
  const v = variante(config);
  const extra = config.extra ? EXTRAS[config.extra] : undefined;
  let cuerpo = (extra?.atras ?? '') + v.svg;
  if (config.kind === 'constelacion') {
    const [px, py] = PRINCIPALES[v.id];
    cuerpo += estrellaPrincipal(px, py, config.cara !== 'ninguna');
  }
  cuerpo += carita(config, v);
  if (extra?.en === 'figura') cuerpo += extra.svg;
  if (extra?.en === 'tope') cuerpo += `<g transform="translate(0 ${v.tope ?? 68})">${extra.svg}</g>`;
  const grupo =
    '<g fill="%R" stroke="#000" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"' +
    (def.transform ? ` transform="${def.transform}"` : '') +
    `>${cuerpo}</g>`;
  return pintar(grupo, config);
}

function escapeXml(texto: string): string {
  return texto.replace(/[<>&"']/g, (ch) =>
    ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '&' ? '&amp;' : ch === '"' ? '&quot;' : '&apos;'
  );
}

/** SVG completo de la figura. `viewBox` permite recortar (miniaturas del editor). */
export function composeFiguraSvg(
  config: FiguraConfig,
  opts: { size?: number; title?: string; viewBox?: string; sinFondo?: boolean } = {}
): string {
  const medidas = opts.size ? ` width="${opts.size}" height="${opts.size}"` : '';
  const titulo = opts.title ? `<title>${escapeXml(opts.title)}</title>` : '';
  const fondo =
    !opts.sinFondo && config.fondo !== 'transparent' ? `<rect width="300" height="300" fill="#${config.fondo}"/>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${opts.viewBox ?? '0 0 300 300'}"${medidas}>` +
    titulo +
    '<metadata>Figura de asistente de SynerLink (dibujo propio).</metadata>' +
    fondo +
    figuraMarkup(config) +
    '</svg>'
  );
}
