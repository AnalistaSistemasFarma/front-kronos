import type { AvatarCategory, AvatarOption } from './types';

/**
 * CATÁLOGO DE PARTES — PERSONA (estilo Notion, trazo negro sobre blanco).
 *
 * Dibujo PROPIO de SynerLink, hecho a mano en el lienzo de 300×300. A propósito
 * NO se copiaron los SVG de Avatartion: el código de Avatartion es MIT, pero sus
 * ilustraciones son de DrawKit, cuya licencia prohíbe incluirlas en
 * "creadores de diseño o aplicaciones" (ver docs/avatar-notion.md).
 *
 * Reglas del lienzo (todas las partes las respetan para encajar entre sí):
 *   - Cabeza centrada en (150, 142), entre x 94–206 y y 74–210.
 *   - Ojos en (128, 142) y (172, 142). Cejas en y≈118. Nariz en y≈150–172.
 *     Boca en y≈182–200. Cuello y hombros desde y≈190 hasta el borde inferior.
 *   - Cada parte hereda del grupo raíz: relleno blanco, trazo negro de 5 px y
 *     puntas redondeadas. Una parte solo declara lo que cambia.
 *
 * ⚠️ NO reordenar ni borrar opciones: la base guarda ÍNDICES. Si una opción
 * sobra, se reemplaza su dibujo; las nuevas se agregan al FINAL.
 */

const NEGRO = 'fill="#000"';
const SIN_RELLENO = 'fill="none"';
const SIN_TRAZO = 'stroke="none"';

/* ───────────────────────────── Cuello y torso ───────────────────────────── */

/** Cuello: va detrás de la ropa y de la cara (capa base, siempre presente). */
export const CUELLO = '<path d="M130 188 L130 240 L170 240 L170 188 Z"/>';

/** Silueta del torso con escote redondo; la comparte toda la ropa. */
const TORSO = 'M56 300 C58 262 86 238 128 232 Q150 250 172 232 C214 238 242 262 244 300 Z';

const torso = (extra = '', relleno = '') => `<path d="${TORSO}" ${relleno}/>${extra}`;

const ROPA: AvatarOption[] = [
  { label: 'Camiseta', svg: torso() },
  {
    label: 'Camiseta con bolsillo',
    svg: torso('<rect x="178" y="258" width="28" height="24" rx="3"/>'),
  },
  {
    label: 'Camisa con cuello',
    svg: torso(
      '<path d="M128 231 L150 250 L137 264 L118 239 Z"/>' +
        '<path d="M172 231 L150 250 L163 264 L182 239 Z"/>' +
        `<circle cx="150" cy="272" r="3.5" ${NEGRO} ${SIN_TRAZO}/>` +
        `<circle cx="150" cy="290" r="3.5" ${NEGRO} ${SIN_TRAZO}/>`
    ),
  },
  {
    label: 'Saco y corbata',
    svg: torso(
      `<path d="M130 233 Q150 249 170 233 L150 292 Z" ${SIN_TRAZO}/>` +
        `<path d="M145 246 L155 246 L158 276 L150 288 L142 276 Z" ${NEGRO} stroke-width="2"/>` +
        `<path d="M118 240 L150 300" ${SIN_RELLENO} stroke="#fff" stroke-width="3"/>` +
        `<path d="M182 240 L150 300" ${SIN_RELLENO} stroke="#fff" stroke-width="3"/>`,
      NEGRO
    ),
  },
  {
    label: 'Buzo con capucha',
    svg: torso(
      `<path d="M114 236 Q150 276 186 236" ${SIN_RELLENO}/>` +
        `<path d="M138 252 L136 280" ${SIN_RELLENO} stroke-width="3"/>` +
        `<path d="M162 252 L164 280" ${SIN_RELLENO} stroke-width="3"/>` +
        `<circle cx="136" cy="283" r="3" ${NEGRO} ${SIN_TRAZO}/>` +
        `<circle cx="164" cy="283" r="3" ${NEGRO} ${SIN_TRAZO}/>`
    ),
  },
  {
    label: 'Cuello tortuga',
    svg: torso(
      '<path d="M126 212 L174 212 L176 242 Q150 254 124 242 Z"/>' +
        `<path d="M136 218 L136 246 M150 218 L150 249 M164 218 L164 246" ${SIN_RELLENO} stroke-width="3"/>`
    ),
  },
  {
    label: 'Rayas',
    svg: torso(
      `<path d="M78 258 L222 258 M63 277 L237 277 M58 294 L242 294" ${SIN_RELLENO} stroke-width="6"/>`
    ),
  },
  {
    label: 'Bata',
    svg: torso(
      `<path d="M131 235 Q150 249 169 235 L150 276 Z" ${NEGRO} stroke-width="3"/>` +
        `<path d="M126 233 L150 282 L174 233" ${SIN_RELLENO} stroke-width="4"/>` +
        `<path d="M150 282 L150 300" ${SIN_RELLENO} stroke-width="3"/>` +
        '<rect x="96" y="262" width="28" height="22" rx="3" stroke-width="4"/>' +
        `<path d="M104 262 L104 250" ${SIN_RELLENO} stroke-width="4"/>`
    ),
  },
  {
    label: 'Tirantes',
    svg: torso(
      `<path d="M104 244 L112 300 M196 244 L188 300" ${SIN_RELLENO} stroke-width="7"/>` +
        `<circle cx="110" cy="288" r="4" ${NEGRO} ${SIN_TRAZO}/>` +
        `<circle cx="190" cy="288" r="4" ${NEGRO} ${SIN_TRAZO}/>`
    ),
  },
  {
    label: 'Suéter oscuro',
    svg: torso(
      `<path d="M122 240 Q150 262 178 240" ${SIN_RELLENO} stroke="#fff" stroke-width="4"/>`,
      NEGRO
    ),
  },
];

/* ───────────────────────────────── Cara ───────────────────────────────── */

/** Orejas a la altura de los ojos; `izq`/`der` = centro X de cada una. */
const orejas = (izq: number, der: number) =>
  `<ellipse cx="${izq}" cy="148" rx="12" ry="17"/>` +
  `<ellipse cx="${der}" cy="148" rx="12" ry="17"/>` +
  `<path d="M${izq + 1} 140 Q${izq - 5} 148 ${izq + 2} 156" ${SIN_RELLENO} stroke-width="3"/>` +
  `<path d="M${der - 1} 140 Q${der + 5} 148 ${der - 2} 156" ${SIN_RELLENO} stroke-width="3"/>`;

const cara = (izq: number, der: number, d: string) => `${orejas(izq, der)}<path d="${d}"/>`;

const CARAS: AvatarOption[] = [
  {
    label: 'Ovalada',
    svg: cara(96, 204, 'M150 74 C186 74 206 102 206 142 C206 184 182 210 150 210 C118 210 94 184 94 142 C94 102 114 74 150 74 Z'),
  },
  {
    label: 'Redonda',
    svg: cara(92, 208, 'M150 76 C190 76 210 104 210 144 C210 184 186 206 150 206 C114 206 90 184 90 144 C90 104 110 76 150 76 Z'),
  },
  {
    label: 'Mentón marcado',
    svg: cara(95, 205, 'M150 74 C188 74 207 102 207 140 C207 172 190 198 162 208 Q150 213 138 208 C110 198 93 172 93 140 C93 102 112 74 150 74 Z'),
  },
  {
    label: 'Cuadrada',
    svg: cara(98, 202, 'M150 74 C190 74 204 92 204 120 L204 166 C204 194 184 208 150 208 C116 208 96 194 96 166 L96 120 C96 92 110 74 150 74 Z'),
  },
  {
    label: 'Alargada',
    svg: cara(100, 200, 'M150 70 C184 70 202 98 202 142 C202 190 180 214 150 214 C120 214 98 190 98 142 C98 98 116 70 150 70 Z'),
  },
  {
    label: 'Mandíbula ancha',
    svg: cara(97, 203, 'M150 76 C186 76 204 100 205 132 C206 160 210 182 194 198 C180 210 164 212 150 212 C136 212 120 210 106 198 C90 182 94 160 95 132 C96 100 114 76 150 76 Z'),
  },
];

/* ─────────────────────────────── Detalles ─────────────────────────────── */

const punto = (x: number, y: number, r = 2) => `<circle cx="${x}" cy="${y}" r="${r}" ${NEGRO} ${SIN_TRAZO}/>`;

const DETALLES: AvatarOption[] = [
  { label: 'Ninguno', svg: '' },
  {
    label: 'Pecas',
    svg: [
      [114, 162], [122, 166], [118, 172], [128, 170],
      [186, 162], [178, 166], [182, 172], [172, 170],
    ].map(([x, y]) => punto(x, y)).join(''),
  },
  {
    label: 'Mejillas sonrojadas',
    svg: `<path d="M110 172 L116 162 M118 174 L124 164 M126 176 L132 166 M168 176 L174 166 M176 174 L182 164 M184 172 L190 162" ${SIN_RELLENO} stroke-width="3"/>`,
  },
  { label: 'Lunar', svg: punto(178, 178, 3) },
  {
    label: 'Curita',
    svg:
      '<rect x="164" y="158" width="26" height="11" rx="5" stroke-width="3" transform="rotate(-20 177 163)"/>' +
      punto(174, 165, 1.3) + punto(180, 162, 1.3),
  },
  {
    label: 'Ojeras',
    svg: `<path d="M118 156 Q128 162 138 156 M162 156 Q172 162 182 156" ${SIN_RELLENO} stroke-width="3"/>`,
  },
];

/* ─────────────────────────────── Cabello ─────────────────────────────── */

const pelo = (d: string) => `<path d="${d}" ${NEGRO}/>`;

/** Frente del cabello corto y peinado hacia atrás (la comparten moño y cola). */
const FRENTE_RECOGIDO = pelo('M92 132 C88 90 112 66 150 66 C188 66 212 90 208 132 C200 108 180 96 150 94 C120 96 100 108 92 132 Z');
/** Frente con raya al medio (cabello largo). */
const FRENTE_RAYA = pelo('M90 160 C84 100 108 62 150 62 C192 62 216 100 210 160 C204 124 186 100 152 88 L148 88 C120 102 100 122 90 160 Z');

const circulosNegros = (lista: Array<[number, number, number]>) =>
  lista.map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}" ${NEGRO}/>`).join('');

const CABELLOS: AvatarOption[] = [
  { label: 'Sin cabello', svg: '' },
  {
    label: 'Corto',
    svg: pelo('M90 140 C82 96 104 62 150 60 C198 58 220 96 210 140 C206 120 198 108 186 100 C170 110 130 112 104 102 C98 112 93 124 90 140 Z'),
  },
  {
    label: 'Peinado de lado',
    svg: pelo('M90 138 C84 92 110 60 154 60 C196 60 218 92 210 138 C206 116 198 102 188 96 C160 104 130 98 118 86 C110 100 98 112 90 138 Z'),
  },
  {
    label: 'Rizado',
    back: circulosNegros([
      [150, 118, 76], [92, 90, 26], [120, 62, 28], [150, 54, 28], [180, 62, 28], [208, 90, 26], [84, 126, 22], [216, 126, 22],
    ]),
    svg: circulosNegros([
      [104, 106, 15], [114, 88, 18], [136, 78, 19], [160, 77, 19], [184, 86, 18], [197, 104, 15],
    ]),
  },
  {
    label: 'Largo liso',
    back: pelo('M92 120 C92 80 116 60 150 60 C184 60 208 80 208 120 L214 246 Q150 262 86 246 Z'),
    svg: FRENTE_RAYA,
  },
  {
    label: 'Moño',
    back: `<circle cx="150" cy="58" r="24" ${NEGRO}/>`,
    svg: FRENTE_RECOGIDO,
  },
  {
    label: 'Cola de caballo',
    back: pelo('M194 96 C238 104 248 170 222 214 C230 172 222 132 196 122 Z'),
    svg: FRENTE_RECOGIDO,
  },
  {
    label: 'Flequillo',
    back: pelo('M90 120 C90 78 116 60 150 60 C184 60 210 78 210 120 L214 196 Q196 204 182 196 L118 196 Q104 204 86 196 Z'),
    svg: pelo('M90 150 C84 96 108 62 150 62 C192 62 216 96 210 150 L204 112 L96 112 Z'),
  },
  {
    label: 'Copete',
    svg: pelo('M92 136 C86 98 98 74 120 62 C136 44 182 40 200 64 C214 80 214 108 208 136 C204 118 196 106 184 100 C160 104 124 104 104 98 C98 108 94 120 92 136 Z'),
  },
  {
    label: 'Largo ondulado',
    back: pelo('M90 110 C88 76 116 58 150 58 C184 58 212 76 210 110 C222 140 206 160 220 190 C230 214 210 240 196 246 L104 246 C90 240 70 214 80 190 C94 160 78 140 90 110 Z'),
    svg: FRENTE_RAYA,
  },
  {
    label: 'Melena corta',
    back: pelo('M88 120 C88 78 114 60 150 60 C186 60 212 78 212 120 L214 200 Q196 212 178 200 L122 200 Q104 212 86 200 Z'),
    svg: pelo('M90 150 C84 96 110 62 150 62 C192 62 216 96 210 150 C200 116 176 96 132 94 C116 108 100 126 90 150 Z'),
  },
  {
    label: 'En puntas',
    svg: pelo('M92 134 L86 96 L104 100 L104 70 L124 82 L134 54 L150 76 L168 52 L176 80 L198 68 L196 98 L214 96 L208 134 C204 118 196 108 186 102 C164 110 132 110 106 102 C100 112 95 122 92 134 Z'),
  },
  {
    label: 'Cresta',
    svg: pelo('M136 100 C132 74 138 50 150 42 C162 50 168 74 164 100 Z'),
  },
  {
    label: 'Entradas',
    svg: pelo('M92 146 C88 126 92 110 101 100 L106 128 Z') + pelo('M208 146 C212 126 208 110 199 100 L194 128 Z'),
  },
];

/* ──────────────────────────────── Cejas ──────────────────────────────── */

const trazo = (d: string, ancho = 5) => `<path d="${d}" ${SIN_RELLENO} stroke-width="${ancho}"/>`;

const CEJAS: AvatarOption[] = [
  { label: 'Rectas', svg: trazo('M114 118 L138 116 M162 116 L186 118') },
  { label: 'Arqueadas', svg: trazo('M112 122 Q124 108 140 116 M160 116 Q176 108 188 122') },
  {
    label: 'Gruesas',
    svg:
      `<path d="M112 120 Q124 106 141 113 L140 121 Q125 116 113 126 Z" ${NEGRO} stroke-width="3"/>` +
      `<path d="M188 120 Q176 106 159 113 L160 121 Q175 116 187 126 Z" ${NEGRO} stroke-width="3"/>`,
  },
  { label: 'Decididas', svg: trazo('M114 112 L140 121 M160 121 L186 112') },
  { label: 'Preocupadas', svg: trazo('M114 121 L140 112 M160 112 L186 121') },
  { label: 'Ninguna', svg: '' },
];

/* ──────────────────────────────── Ojos ──────────────────────────────── */

const OJOS: AvatarOption[] = [
  { label: 'Puntos', svg: punto(128, 142, 6) + punto(172, 142, 6) },
  {
    label: 'Ovalados',
    svg: `<ellipse cx="128" cy="142" rx="5" ry="8" ${NEGRO} ${SIN_TRAZO}/><ellipse cx="172" cy="142" rx="5" ry="8" ${NEGRO} ${SIN_TRAZO}/>`,
  },
  { label: 'Felices', svg: trazo('M118 146 Q128 134 138 146 M162 146 Q172 134 182 146') },
  {
    label: 'Brillantes',
    svg:
      punto(128, 142, 9) + punto(172, 142, 9) +
      `<circle cx="131" cy="139" r="3" fill="#fff" ${SIN_TRAZO}/><circle cx="175" cy="139" r="3" fill="#fff" ${SIN_TRAZO}/>`,
  },
  { label: 'Cerrados', svg: trazo('M118 142 Q128 150 138 142 M162 142 Q172 150 182 142') },
  { label: 'Guiño', svg: punto(128, 142, 6) + trazo('M162 145 Q172 135 182 145') },
  {
    label: 'Grandes',
    svg:
      '<circle cx="128" cy="142" r="11" stroke-width="4"/><circle cx="172" cy="142" r="11" stroke-width="4"/>' +
      punto(130, 144, 5) + punto(174, 144, 5),
  },
  {
    label: 'Con pestañas',
    svg:
      punto(128, 143, 6) + punto(172, 143, 6) +
      trazo('M120 136 L115 130 M126 133 L124 126 M180 136 L185 130 M174 133 L176 126', 3),
  },
];

/* ──────────────────────────────── Nariz ──────────────────────────────── */

const NARICES: AvatarOption[] = [
  { label: 'Curva', svg: trazo('M150 150 Q138 168 154 170', 4) },
  { label: 'Angular', svg: trazo('M150 148 L142 168 L156 168', 4) },
  { label: 'Redonda', svg: trazo('M140 166 Q150 178 160 166', 4) },
  { label: 'Botón', svg: punto(145, 166, 2.6) + punto(155, 166, 2.6) },
  { label: 'Larga', svg: trazo('M152 140 C150 156 138 166 146 172 Q152 174 158 170', 4) },
  { label: 'Ninguna', svg: '' },
];

/* ──────────────────────────────── Boca ──────────────────────────────── */

const BOCAS: AvatarOption[] = [
  { label: 'Sonrisa', svg: trazo('M136 186 Q150 198 164 186') },
  { label: 'Sonrisa abierta', svg: `<path d="M134 184 Q150 208 166 184 Z" ${NEGRO} stroke-width="4"/>` },
  { label: 'Neutral', svg: trazo('M140 190 L160 190') },
  { label: 'Sorpresa', svg: `<ellipse cx="150" cy="191" rx="6" ry="8" ${NEGRO} ${SIN_TRAZO}/>` },
  {
    label: 'Dientes',
    svg:
      `<path d="M132 184 Q150 210 168 184 Z" ${NEGRO} stroke-width="4"/>` +
      `<path d="M137 186 L163 186 L160 193 L140 193 Z" fill="#fff" ${SIN_TRAZO}/>`,
  },
  { label: 'Ladeada', svg: trazo('M138 190 Q156 194 166 182') },
  { label: 'Triste', svg: trazo('M138 195 Q150 184 162 195') },
  {
    label: 'Lengua',
    svg:
      `<path d="M136 184 Q150 202 164 184 Z" ${NEGRO} stroke-width="4"/>` +
      '<path d="M143 192 Q150 208 157 192 Z" stroke-width="3"/>',
  },
];

/* ──────────────────────────────── Barba ──────────────────────────────── */

/** Ventana blanca alrededor de la boca: la barba va DEBAJO de la boca. */
const VENTANA_BOCA = `<ellipse cx="150" cy="190" rx="19" ry="12" fill="#fff" ${SIN_TRAZO}/>`;
const BIGOTE = 'M132 182 C138 172 148 174 150 178 C152 174 162 172 168 182 C160 180 154 182 150 184 C146 182 140 180 132 182 Z';

const BARBAS: AvatarOption[] = [
  { label: 'Ninguna', svg: '' },
  { label: 'Bigote', svg: `<path d="${BIGOTE}" ${NEGRO} stroke-width="3"/>` },
  {
    label: 'Barba completa',
    svg:
      `<path d="M96 148 C98 196 122 224 150 224 C178 224 202 196 204 148 C200 166 190 176 176 178 C166 172 134 172 124 178 C110 176 100 166 96 148 Z" ${NEGRO}/>` +
      VENTANA_BOCA,
  },
  {
    label: 'Candado',
    svg:
      `<path d="${BIGOTE}" ${NEGRO} stroke-width="3"/>` +
      `<path d="M138 200 Q150 220 162 200 L157 197 Q150 206 143 197 Z" ${NEGRO} stroke-width="3"/>`,
  },
  {
    label: 'Barba de días',
    svg: [
      [108, 176], [114, 186], [122, 194], [130, 200], [140, 204], [150, 206], [160, 204], [170, 200],
      [178, 194], [186, 186], [192, 176], [118, 180], [182, 180], [140, 196], [160, 196], [150, 198],
    ].map(([x, y]) => punto(x, y, 1.8)).join(''),
  },
  {
    label: 'Barba corta',
    svg:
      `<path d="M104 168 C108 200 128 214 150 214 C172 214 192 200 196 168 C188 180 178 184 168 182 C160 176 140 176 132 182 C122 184 112 180 104 168 Z" ${NEGRO}/>` +
      VENTANA_BOCA,
  },
];

/* ──────────────────────────────── Gafas ──────────────────────────────── */

const PATAS = trazo('M112 139 L96 134 M188 139 L204 134', 4);

export const GAFAS: AvatarOption[] = [
  { label: 'Ninguna', svg: '' },
  {
    label: 'Redondas',
    svg:
      `<circle cx="128" cy="142" r="16" ${SIN_RELLENO} stroke-width="4"/><circle cx="172" cy="142" r="16" ${SIN_RELLENO} stroke-width="4"/>` +
      trazo('M144 140 Q150 134 156 140', 4) + PATAS,
  },
  {
    label: 'Rectangulares',
    svg:
      `<rect x="110" y="130" width="36" height="25" rx="6" ${SIN_RELLENO} stroke-width="4"/><rect x="154" y="130" width="36" height="25" rx="6" ${SIN_RELLENO} stroke-width="4"/>` +
      trazo('M146 139 L154 139', 4) + PATAS,
  },
  {
    label: 'De sol',
    svg:
      `<rect x="110" y="130" width="36" height="25" rx="8" ${NEGRO} stroke-width="4"/><rect x="154" y="130" width="36" height="25" rx="8" ${NEGRO} stroke-width="4"/>` +
      trazo('M146 139 L154 139', 4) + PATAS +
      trazo('M118 136 L126 136 M162 136 L170 136', 2).replace('stroke-width="2"', 'stroke-width="2" stroke="#fff"'),
  },
  {
    label: 'Media montura',
    svg:
      trazo('M110 131 L146 131 M154 131 L190 131', 7) +
      trazo('M111 133 Q128 160 145 133 M155 133 Q172 160 189 133', 3) +
      trazo('M146 132 L154 132', 4) + PATAS,
  },
  {
    label: 'Ojo de gato',
    svg:
      `<path d="M106 130 Q128 124 146 134 Q144 156 128 156 Q112 156 106 130 Z" ${SIN_RELLENO} stroke-width="4"/>` +
      `<path d="M194 130 Q172 124 154 134 Q156 156 172 156 Q188 156 194 130 Z" ${SIN_RELLENO} stroke-width="4"/>` +
      trazo('M146 137 L154 137', 4),
  },
];

/* ───────────────────────────── Accesorios ───────────────────────────── */

const ACC = {
  ninguno: { label: 'Ninguno', svg: '' },
  aretes: {
    label: 'Aretes',
    svg: `<circle cx="95" cy="171" r="5" ${SIN_RELLENO} stroke-width="3"/><circle cx="205" cy="171" r="5" ${SIN_RELLENO} stroke-width="3"/>`,
  },
  audifonos: {
    label: 'Audífonos',
    svg:
      trazo('M94 136 C90 60 210 60 206 136', 9) +
      `<rect x="82" y="124" width="22" height="38" rx="9" ${NEGRO}/><rect x="196" y="124" width="22" height="38" rx="9" ${NEGRO}/>`,
  },
  gorra: {
    label: 'Gorra',
    svg:
      `<path d="M90 112 C88 60 212 60 210 112 Z" ${NEGRO}/>` +
      `<path d="M92 110 L234 113 Q240 121 230 124 L92 120 Z" ${NEGRO}/>` +
      `<circle cx="150" cy="64" r="4" fill="#fff" ${SIN_TRAZO}/>`,
  },
  gorroLana: {
    label: 'Gorro de lana',
    svg:
      '<path d="M90 114 C88 58 212 58 210 114 Z"/>' +
      '<rect x="84" y="102" width="132" height="22" rx="9"/>' +
      trazo('M104 104 L104 122 M124 104 L124 122 M144 104 L144 122 M164 104 L164 122 M184 104 L184 122 M200 104 L200 122', 3) +
      '<circle cx="150" cy="54" r="13"/>',
  },
  lapiz: {
    label: 'Lápiz en la oreja',
    svg:
      `<path d="M190 128 L226 92" ${SIN_RELLENO} stroke-width="11"/>` +
      `<path d="M190 128 L226 92" ${SIN_RELLENO} stroke="#fff" stroke-width="4"/>` +
      `<path d="M186 132 L192 126" ${SIN_RELLENO} stroke-width="5"/>`,
  },
  flor: {
    label: 'Flor',
    svg:
      [[198, 76], [210, 84], [206, 98], [192, 98], [188, 84]]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="8" stroke-width="3"/>`)
        .join('') + punto(199, 88, 5),
  },
  mono: {
    label: 'Moño',
    svg:
      `<path d="M186 78 L166 64 L166 92 Z" ${NEGRO} stroke-width="3"/><path d="M186 78 L206 64 L206 92 Z" ${NEGRO} stroke-width="3"/>` +
      '<circle cx="186" cy="78" r="5" stroke-width="3"/>',
  },
  collar: {
    label: 'Collar',
    svg: trazo('M124 236 Q150 266 176 236', 3) + '<circle cx="150" cy="255" r="5" stroke-width="3"/>',
  },
  tapabocas: {
    label: 'Tapabocas',
    svg:
      trazo('M120 166 L96 146 M180 166 L204 146', 3) +
      '<path d="M118 162 Q150 154 182 162 L180 198 Q150 214 120 198 Z" stroke-width="4"/>' +
      trazo('M124 174 Q150 168 176 174 M124 186 Q150 180 176 186', 3),
  },
  corbatin: {
    label: 'Corbatín',
    svg:
      `<path d="M150 242 L132 232 L132 254 Z" ${NEGRO} stroke-width="3"/><path d="M150 242 L168 232 L168 254 Z" ${NEGRO} stroke-width="3"/>` +
      `<circle cx="150" cy="243" r="5" ${NEGRO} stroke-width="3"/>`,
  },
  corona: {
    label: 'Corona',
    svg:
      '<path d="M112 84 L118 50 L135 70 L150 42 L165 70 L182 50 L188 84 Z" stroke-width="4"/>' +
      punto(150, 66, 3) + punto(128, 74, 2.4) + punto(172, 74, 2.4),
  },
} satisfies Record<string, AvatarOption>;

const ACCESORIOS_PERSONA: AvatarOption[] = [
  ACC.ninguno, ACC.aretes, ACC.audifonos, ACC.gorra, ACC.gorroLana, ACC.lapiz,
  ACC.flor, ACC.mono, ACC.collar, ACC.tapabocas, ACC.corbatin, ACC.corona,
];

/** Accesorios que también sirven a los animales (sin aretes, lápiz ni tapabocas). */
export const ACCESORIOS_ANIMAL: AvatarOption[] = [
  ACC.ninguno, ACC.audifonos, ACC.gorra, ACC.gorroLana, ACC.flor,
  ACC.mono, ACC.collar, ACC.corbatin, ACC.corona,
];

/* ───────────────────────────── Categorías ───────────────────────────── */

export const ROPA_OPCIONES = ROPA;
export const OJOS_OPCIONES = OJOS;

/**
 * Categorías del editor de PERSONA, en el orden en que aparecen los botones.
 * Mismo reparto que Avatartion: las principales a la izquierda (Cara, Cabello,
 * Ojos, Boca, Ropa) y las "otras" a la derecha.
 */
export const CATEGORIAS_PERSONA: AvatarCategory[] = [
  { id: 'cara', label: 'Cara', title: 'Caras', options: CARAS, thumbViewBox: '76 60 148 160' },
  { id: 'cabello', label: 'Cabello', title: 'Cabellos', options: CABELLOS, thumbViewBox: '50 30 200 230', optional: true },
  { id: 'ojos', label: 'Ojos', title: 'Ojos', options: OJOS, thumbViewBox: '106 120 88 44' },
  { id: 'cejas', label: 'Cejas', title: 'Cejas', options: CEJAS, thumbViewBox: '106 98 88 44', optional: true },
  { id: 'nariz', label: 'Nariz', title: 'Narices', options: NARICES, thumbViewBox: '126 136 48 48', optional: true },
  { id: 'boca', label: 'Boca', title: 'Bocas', options: BOCAS, thumbViewBox: '124 168 52 52' },
  { id: 'ropa', label: 'Ropa', title: 'Ropa', options: ROPA, thumbViewBox: '50 200 200 100' },
  { id: 'barba', label: 'Barba', title: 'Barbas', options: BARBAS, thumbViewBox: '90 140 120 90', optional: true },
  { id: 'gafas', label: 'Gafas', title: 'Gafas', options: GAFAS, thumbViewBox: '90 110 120 60', optional: true },
  { id: 'accesorios', label: 'Accesorios', title: 'Accesorios', options: ACCESORIOS_PERSONA, thumbViewBox: '40 20 220 260', optional: true },
  { id: 'detalles', label: 'Detalles', title: 'Detalles', options: DETALLES, thumbViewBox: '100 140 100 60', optional: true },
];

/**
 * Orden de PINTADO (de atrás hacia adelante). 'cabello:back' es la capa de
 * atrás del cabello y 'cuello' la capa fija del cuello.
 */
export const ORDEN_PERSONA = [
  'cabello:back', 'cuello', 'ropa', 'cara', 'detalles', 'cejas', 'ojos', 'nariz',
  'barba', 'boca', 'cabello', 'gafas', 'accesorios',
] as const;
