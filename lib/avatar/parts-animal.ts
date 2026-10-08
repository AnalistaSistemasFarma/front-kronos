import { NOTO, bocaDeFrente, invertirBN, ojosDeFrente } from './noto';
import type { AvatarCategory, AvatarConfig, AvatarOption } from './types';

/**
 * CATÁLOGO DE PARTES — ANIMALES (avatares de los asistentes del chat).
 *
 * Mismo lenguaje que las personas: blanco y negro puro, trazo grueso y parejo,
 * pocas líneas. Cabeza grande y redondeada, de frente, que se monta sobre un
 * cuerpo con camiseta; orejas con contorno y una línea interior; bigotes de
 * trazo; nariz y boca diminutas.
 *
 * Rejilla (300×300): cabeza centrada en (150, 140), entre x 72–228 y y 70–208.
 * Ojos en (122, 138) y (178, 138). Nariz en (150, 158) —la trae cada animal—
 * y boca justo debajo (y≈162–176). Hombros desde y≈190 hasta el borde.
 *
 * Contrato: la base guarda ÍNDICES; las opciones nuevas van al final.
 */

const NEGRO = 'fill="#000"';
const SIN_RELLENO = 'fill="none"';
const SIN_TRAZO = 'stroke="none"';
const linea = (d: string, ancho = 6) => `<path d="${d}" ${SIN_RELLENO} stroke-width="${ancho}"/>`;
const mancha = (d: string, ancho = 6) => `<path d="${d}" ${NEGRO} stroke-width="${ancho}"/>`;
const punto = (x: number, y: number, r: number, color = '#000') =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" ${SIN_TRAZO}/>`;

/** Cabeza base: redonda, un poco más ancha en los cachetes. */
const CABEZA = 'M150 68 C200 68 234 96 236 140 C238 184 200 212 150 212 C100 212 62 184 64 140 C66 96 100 68 150 68 Z';
const cabeza = (d = CABEZA, extra = '') => `<path d="${d}" ${extra}/>`;

/** Nariz de gato/conejo: triangulito redondeado, y el trazo hasta la boca. */
const NARIZ_PEQUENA = mancha('M143 154 Q150 151 157 154 Q154 160 150 161 Q146 160 143 154 Z', 3);
/** Nariz de perro/oso: óvalo negro. */
const NARIZ_GRANDE = `<ellipse cx="150" cy="156" rx="11" ry="7.5" ${NEGRO} stroke-width="3"/>`;

const BIGOTES = linea('M80 152 L36 146 M80 168 L40 176 M220 152 L264 146 M220 168 L260 176', 6);

const ANIMALES: AvatarOption[] = [
  {
    label: 'Gato',
    svg:
      '<path d="M78 122 L88 36 L142 80 Z"/><path d="M222 122 L212 36 L158 80 Z"/>' +
      linea('M98 60 L104 96 M202 60 L196 96', 6) +
      cabeza() + NARIZ_PEQUENA + BIGOTES,
  },
  {
    label: 'Perro',
    svg:
      // Orejas caídas DETRÁS de la cabeza: solo asoman a los lados.
      mancha('M100 82 C62 76 38 128 46 180 C52 202 80 202 88 180 Z') +
      mancha('M200 82 C238 76 262 128 254 180 C248 202 220 202 212 180 Z') +
      cabeza() +
      `<ellipse cx="150" cy="166" rx="32" ry="24" stroke-width="5"/>` + NARIZ_GRANDE,
  },
  {
    label: 'Zorro',
    svg:
      '<path d="M84 122 L84 40 L138 86 Z"/><path d="M216 122 L216 40 L162 86 Z"/>' +
      mancha('M90 62 L92 92 L112 82 Z', 3) + mancha('M210 62 L208 92 L188 82 Z', 3) +
      cabeza('M150 76 C194 76 226 100 228 136 C230 166 190 200 150 210 C110 200 70 166 72 136 C74 100 106 76 150 76 Z') +
      linea('M76 150 C104 146 128 152 142 170 M224 150 C196 146 172 152 158 170', 5) +
      NARIZ_PEQUENA,
  },
  {
    label: 'Búho',
    svg:
      '<path d="M88 104 L84 56 L124 82 Z"/><path d="M212 104 L216 56 L176 82 Z"/>' +
      cabeza() +
      `<circle cx="122" cy="138" r="24" stroke-width="5"/><circle cx="178" cy="138" r="24" stroke-width="5"/>` +
      mancha('M142 156 L158 156 L150 172 Z', 4) +
      linea('M138 72 Q150 84 162 72', 5),
  },
  {
    label: 'Oso',
    svg:
      '<circle cx="88" cy="84" r="25"/><circle cx="212" cy="84" r="25"/>' +
      linea('M80 94 Q80 76 96 74 M220 94 Q220 76 204 74', 5) +
      cabeza() +
      `<ellipse cx="150" cy="164" rx="30" ry="22" stroke-width="5"/>` + NARIZ_GRANDE,
  },
  {
    label: 'Conejo',
    svg:
      '<path d="M114 96 C98 46 104 12 122 12 C140 12 144 50 138 92 Z"/>' +
      '<path d="M186 96 C202 46 196 12 178 12 C160 12 156 50 162 92 Z"/>' +
      linea('M122 34 L126 80 M178 34 L174 80', 5) +
      cabeza() + NARIZ_PEQUENA + linea('M84 156 L50 152 M84 168 L54 174 M216 156 L250 152 M216 168 L246 174', 5),
  },
  {
    label: 'Panda',
    oscuro: true,
    svg:
      `<circle cx="88" cy="84" r="24" ${NEGRO}/><circle cx="212" cy="84" r="24" ${NEGRO}/>` +
      cabeza() +
      `<ellipse cx="120" cy="140" rx="20" ry="26" ${NEGRO} ${SIN_TRAZO} transform="rotate(28 120 140)"/>` +
      `<ellipse cx="180" cy="140" rx="20" ry="26" ${NEGRO} ${SIN_TRAZO} transform="rotate(-28 180 140)"/>` +
      NARIZ_GRANDE,
  },
  {
    label: 'León',
    svg:
      mancha(
        'M150 40 C176 40 188 56 200 58 C222 60 236 80 238 100 C252 118 254 150 242 170 C240 196 220 218 196 222 C182 236 118 236 104 222 C80 218 60 196 58 170 C46 150 48 118 62 100 C64 80 78 60 100 58 C112 56 124 40 150 40 Z'
      ) +
      '<circle cx="104" cy="94" r="14"/><circle cx="196" cy="94" r="14"/>' +
      cabeza('M150 82 C190 82 214 104 216 140 C218 176 190 200 150 200 C110 200 82 176 84 140 C86 104 110 82 150 82 Z') +
      `<ellipse cx="150" cy="166" rx="26" ry="19" stroke-width="5"/>` +
      mancha('M141 153 L159 153 L150 162 Z', 3),
  },
  {
    label: 'Pingüino',
    svg:
      cabeza(CABEZA, NEGRO) +
      `<path d="M150 104 C162 90 202 92 206 128 C210 166 184 196 150 200 C116 196 90 166 94 128 C98 92 138 90 150 104 Z" fill="#fff" ${SIN_TRAZO}/>` +
      '<path d="M138 152 L162 152 L150 166 Z" stroke-width="4"/>',
  },
  {
    label: 'Koala',
    svg:
      '<circle cx="80" cy="106" r="34"/><circle cx="220" cy="106" r="34"/>' +
      linea('M66 118 Q66 92 88 88 M234 118 Q234 92 212 88', 5) +
      cabeza() +
      `<ellipse cx="150" cy="152" rx="13" ry="19" ${NEGRO} stroke-width="3"/>`,
  },
  {
    label: 'Mono',
    svg:
      '<circle cx="62" cy="142" r="22"/><circle cx="238" cy="142" r="22"/>' +
      linea('M58 132 Q50 142 58 152 M242 132 Q250 142 242 152', 5) +
      cabeza() +
      `<path d="M150 112 C164 96 204 100 200 136 C198 152 190 158 190 170 C188 196 168 202 150 202 C132 202 112 196 110 170 C110 158 102 152 100 136 C96 100 136 96 150 112 Z" ${SIN_RELLENO} stroke-width="5"/>` +
      punto(145, 157, 3) + punto(155, 157, 3),
  },
];

/* ──────────────────────────────── Ojos ──────────────────────────────── */

// Expresión con las piezas de Noto (CC0), las mismas de las personas, de
// frente y centradas entre los ojos del animal (150, 138). Es lo que le da
// carácter: cejas arqueadas, ojos entrecerrados, guiño…
const S_ANIMAL = 0.38;
const OJOS_ANIMAL: AvatarOption[] = NOTO.ojos.map((svg, i) => ({
  label: `Ojos ${i + 1}`,
  svg: ojosDeFrente(svg, 150, 138, S_ANIMAL),
}));

const CEJAS_ANIMAL: AvatarOption[] = [
  { label: 'Sin cejas', peso: 4, svg: '' },
  ...NOTO.cejas.map((svg, i) => ({ label: `Cejas ${i + 1}`, svg: ojosDeFrente(svg, 150, 130, S_ANIMAL) })),
];

/* ──────────────────────────────── Boca ──────────────────────────────── */

const BOCAS_ANIMAL: AvatarOption[] = [
  { label: 'Gatuna', peso: 3, svg: linea('M150 161 L150 166 M138 168 Q144 174 150 166 Q156 174 162 168', 5) },
  { label: 'Sonrisa', peso: 2, svg: linea('M150 161 L150 166 M138 168 Q150 180 162 168', 5) },
  { label: 'Neutral', peso: 1, svg: linea('M150 161 L150 168 M142 170 L158 170', 5) },
  { label: 'Abierta', peso: 1, svg: '<path d="M139 166 Q150 186 161 166 Z" fill="#000" stroke-width="4"/>' },
  // Bocas de Noto, más abajo de la nariz.
  ...NOTO.boca.map((svg, i) => ({ label: `Boca ${i + 1}`, peso: 0.5, svg: bocaDeFrente(svg, 150, 138, 0.32, 42) })),
];

/* ──────────────────────────────── Ropa ──────────────────────────────── */

/** Cuerpo: hombros anchos y brazos que asoman abajo, como un busto. */
const CUERPO = 'M62 312 L66 238 C70 208 104 194 150 194 C196 194 230 208 234 238 L238 312 Z';
const BRAZOS = '<path d="M60 266 L54 312 L84 312 L86 270 Z" stroke-width="6"/><path d="M240 266 L246 312 L216 312 L214 270 Z" stroke-width="6"/>';
const cuerpo = (extra = '', relleno = '') => `<path d="${CUERPO}" ${relleno}/>${extra}`;

const ROPA_ANIMAL: AvatarOption[] = [
  { label: 'Camiseta negra', peso: 4, svg: cuerpo(BRAZOS, NEGRO) },
  {
    label: 'Camiseta blanca',
    peso: 1,
    svg: cuerpo(BRAZOS + linea('M88 250 L90 312 M212 250 L210 312')),
  },
  {
    label: 'Buzo con capota',
    peso: 1,
    svg: cuerpo(
      linea('M88 250 L90 312 M212 250 L210 312') +
        '<path d="M100 206 C110 186 190 186 200 206 C186 218 114 218 100 206 Z"/>' +
        linea('M138 214 L136 250 M162 214 L164 250', 4) + punto(136, 252, 4) + punto(164, 252, 4)
    ),
  },
  {
    label: 'Bata',
    peso: 1,
    svg: cuerpo(
      linea('M88 250 L90 312 M212 250 L210 312') +
        '<path d="M116 200 L104 226 L150 280 Z" stroke-width="5"/><path d="M184 200 L196 226 L150 280 Z" stroke-width="5"/>' +
        linea('M150 280 L150 312', 5) +
        '<path d="M98 254 L126 254 L126 280 L98 280 Z" stroke-width="5"/>'
    ),
  },
  {
    label: 'Corbatín',
    peso: 1,
    svg: cuerpo(
      BRAZOS +
        mancha('M150 212 L126 200 L126 226 Z', 4) + mancha('M150 212 L174 200 L174 226 Z', 4) +
        punto(150, 212, 6) +
        `<path d="M150 212 L126 200 L126 226 Z M150 212 L174 200 L174 226 Z" ${SIN_RELLENO} stroke="#fff" stroke-width="3"/>`,
      NEGRO
    ),
  },
];

/* ──────────────────────────────── Gafas ──────────────────────────────── */

const GAFAS_ANIMAL: AvatarOption[] = [
  { label: 'Ninguna', peso: 3, svg: '' },
  {
    label: 'De sol',
    peso: 1,
    svg:
      mancha('M90 126 L146 126 C146 148 134 160 118 160 C100 160 90 146 90 126 Z', 5) +
      mancha('M154 126 L210 126 C210 146 200 160 182 160 C166 160 154 148 154 126 Z', 5) +
      linea('M84 126 L216 126', 7) + linea('M216 128 L232 136', 6),
  },
  {
    label: 'Redondas',
    peso: 1,
    svg:
      `<circle cx="122" cy="138" r="21" ${SIN_RELLENO} stroke-width="5"/><circle cx="178" cy="138" r="21" ${SIN_RELLENO} stroke-width="5"/>` +
      linea('M143 136 Q150 130 157 136', 5),
  },
];

/* ───────────────────────────── Accesorios ───────────────────────────── */

const ACCESORIOS_ANIMAL: AvatarOption[] = [
  { label: 'Ninguno', peso: 4, svg: '' },
  {
    label: 'Sombrero',
    peso: 1,
    svg:
      '<ellipse cx="150" cy="80" rx="86" ry="14" stroke-width="5"/>' +
      '<path d="M104 80 C102 36 198 36 196 80 Z" stroke-width="5"/>' +
      mancha('M105 62 C130 58 170 58 195 62 L196 74 C170 70 130 70 104 74 Z', 4),
  },
  {
    label: 'Gorra',
    peso: 1,
    svg:
      '<path d="M90 100 C88 58 120 38 150 38 C180 38 212 58 210 100 C170 90 130 90 90 100 Z" stroke-width="5"/>' +
      '<path d="M90 100 C120 88 180 88 210 100 C200 114 100 114 90 100 Z" stroke-width="5"/>' +
      linea('M150 40 L150 90', 4) + punto(150, 38, 4.5),
  },
  {
    label: 'Audífonos',
    peso: 1,
    svg:
      linea('M78 128 C70 40 230 40 222 128', 9) +
      `<rect x="62" y="118" width="26" height="46" rx="12" ${NEGRO} stroke-width="5"/>` +
      `<rect x="212" y="118" width="26" height="46" rx="12" ${NEGRO} stroke-width="5"/>`,
  },
];

/** Categorías del editor de ANIMAL (asistentes). */
export const CATEGORIAS_ANIMAL: AvatarCategory[] = [
  { id: 'animal', label: 'Animal', title: 'Animales', options: ANIMALES, thumbViewBox: '30 4 240 240' },
  { id: 'ojos', label: 'Ojos', title: 'Ojos', options: OJOS_ANIMAL, thumbViewBox: '96 112 108 52' },
  { id: 'cejas', label: 'Cejas', title: 'Cejas', options: CEJAS_ANIMAL, thumbViewBox: '96 100 108 52', optional: true },
  { id: 'boca', label: 'Boca', title: 'Bocas', options: BOCAS_ANIMAL, thumbViewBox: '118 146 64 52' },
  { id: 'ropa', label: 'Ropa', title: 'Ropa', options: ROPA_ANIMAL, thumbViewBox: '40 180 220 130' },
  { id: 'gafas', label: 'Gafas', title: 'Gafas', options: GAFAS_ANIMAL, thumbViewBox: '76 100 160 72', optional: true },
  { id: 'accesorios', label: 'Accesorios', title: 'Accesorios', options: ACCESORIOS_ANIMAL, thumbViewBox: '50 20 200 160', optional: true },
];

export const ORDEN_ANIMAL = ['ropa', 'animal', 'ojos', 'cejas', 'boca', 'gafas', 'accesorios'] as const;

/** Panda: los ojos van sobre el antifaz negro, así que se pintan en blanco. */
export function capaAnimal(config: AvatarConfig, id: string, svg: string): string {
  if (id !== 'ojos') return svg;
  const animal = ANIMALES[config.partes.animal ?? 0];
  return animal?.oscuro ? invertirBN(`<g stroke="#000" fill="#fff">${svg}</g>`) : svg;
}
