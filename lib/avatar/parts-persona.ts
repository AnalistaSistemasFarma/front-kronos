import type { AvatarCategory, AvatarOption } from './types';

/**
 * CATÁLOGO DE PARTES — PERSONA.
 *
 * Estilo: ilustración de línea en blanco y negro puro, trazo negro grueso y
 * parejo (6 px en el lienzo de 300, ≈2 px a 100 px), puntas redondas, pocas
 * líneas. La cabeza va en 3/4 (mira un poco hacia la derecha), con una sola
 * oreja visible a la izquierda, cuello sencillo y torso cortado a la altura
 * del pecho. Pelo, barba y gafas oscuras son manchas negras sólidas.
 *
 * Dibujo PROPIO de SynerLink: no se copió ningún SVG de Avatartion (sus
 * ilustraciones son de DrawKit y su licencia no permite usarlas en un creador
 * de avatares). Ver docs/avatar-notion.md.
 *
 * Rejilla del lienzo (300×300) que respetan todas las partes:
 *   - Cráneo entre x 108–208 y y 44–176. Oreja izquierda en x 92–119,
 *     y 96–146 (capa fija encima del cabello).
 *   - Ojos: cercano (155, 112) y lejano (182, 111). Nariz: bulto sobre el
 *     contorno derecho, x 203–223, y 112–137. Boca centrada en (168, 148).
 *   - Cuello x 131–169 hasta y≈188; escote en y≈186; torso hasta el borde.
 *   - Todo hereda del grupo raíz: relleno blanco, trazo negro de 6 px,
 *     puntas y uniones redondas.
 *
 * Contrato: la base guarda ÍNDICES. Hoy no hay datos (nada se ha desplegado),
 * pero desde el primer pase NO se reordenan ni se borran opciones: las nuevas
 * van al final.
 */

const NEGRO = 'fill="#000"';
const SIN_RELLENO = 'fill="none"';
const SIN_TRAZO = 'stroke="none"';

const linea = (d: string, ancho = 6) => `<path d="${d}" ${SIN_RELLENO} stroke-width="${ancho}"/>`;
const punto = (x: number, y: number, r = 5, color = '#000') =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" ${SIN_TRAZO}/>`;
const mancha = (d: string, ancho = 6) => `<path d="${d}" ${NEGRO} stroke-width="${ancho}"/>`;

/* ───────────────────────────── Cuello y torso ───────────────────────────── */

/** Cuello (capa fija): relleno blanco y solo sus dos bordes. */
export const CUELLO =
  `<path d="M128 140 L128 194 L172 194 L172 150 Z" ${SIN_TRAZO}/>` +
  linea('M131 150 L131 190 M169 164 L169 188');

/** Silueta del torso: hombros redondos y brazos que se salen del lienzo. */
// Sin cerrar (sin Z): el borde de arriba no se traza; el escote dibuja la línea.
const SILUETA = 'M128 186 C102 190 78 198 70 226 L58 312 L242 312 L230 226 C222 198 198 190 172 186';
/** Escote redondo bajo el cuello. */
const ESCOTE = 'M128 185 Q150 200 172 185';
/** Costados del pecho (donde termina el brazo). */
const COSTADOS = 'M86 266 L88 312 M214 266 L212 312';
/** Dobladillo de manga corta. */
const MANGAS_CORTAS = 'M67 264 L86 266 M233 264 L214 266';

const torso = (extra: string, relleno = '') => `<path d="${SILUETA}" ${relleno}/>${extra}`;

const ROPA: AvatarOption[] = [
  {
    label: 'Camiseta',
    svg: torso(linea(ESCOTE) + linea(COSTADOS) + linea(MANGAS_CORTAS)),
  },
  {
    label: 'Polo',
    svg: torso(
      linea(COSTADOS) + linea(MANGAS_CORTAS) +
        '<path d="M127 185 L139 207 L150 193 Z" stroke-width="5"/><path d="M173 185 L161 207 L150 193 Z" stroke-width="5"/>' +
        linea('M150 195 L150 226', 5) + punto(150, 206, 3.2) + punto(150, 219, 3.2)
    ),
  },
  {
    label: 'Cuello tortuga',
    svg: torso(
      linea(COSTADOS) +
        '<path d="M128 160 L126 194 Q150 208 174 194 L172 160 Z"/>' +
        linea('M127 180 Q150 192 173 180', 4)
    ),
  },
  {
    label: 'Buzo con capota',
    svg: torso(
      linea(COSTADOS) +
        '<path d="M112 190 C112 170 188 170 188 190 C176 206 124 206 112 190 Z"/>' +
        linea('M140 202 L138 240 M160 202 L162 240', 4) +
        punto(138, 242, 4) + punto(162, 242, 4) +
        linea('M104 312 L110 282 L190 282 L196 312', 5)
    ),
  },
  {
    label: 'Camisa con bolsillo',
    svg: torso(
      linea(COSTADOS) + linea(MANGAS_CORTAS) +
        '<path d="M126 184 L116 206 L146 200 Z" stroke-width="5"/><path d="M174 184 L184 206 L154 200 Z" stroke-width="5"/>' +
        linea('M150 200 L150 312', 5) + punto(150, 222, 3.2) + punto(150, 246, 3.2) + punto(150, 270, 3.2) +
        '<path d="M170 232 L198 232 L198 258 Q184 264 170 258 Z" stroke-width="5"/>' +
        linea('M170 240 L198 240', 4)
    ),
  },
  {
    label: 'Chaqueta de cuero',
    svg: torso(
      `<path d="M128 185 Q150 199 172 185 L166 312 L134 312 Z" fill="#fff" ${SIN_TRAZO}/>` +
        linea('M128 185 Q150 199 172 185', 6) +
        `<path d="M126 188 L106 228 L124 236 L134 312" ${SIN_RELLENO} stroke="#fff" stroke-width="4"/>` +
        `<path d="M174 188 L194 228 L176 236 L166 312" ${SIN_RELLENO} stroke="#fff" stroke-width="4"/>` +
        `<path d="M78 250 L80 312 M222 250 L220 312" ${SIN_RELLENO} stroke="#fff" stroke-width="4"/>`,
      NEGRO
    ),
  },
  {
    label: 'Suéter',
    svg: torso(
      linea(COSTADOS) +
        '<path d="M124 184 Q150 202 176 184 L182 190 Q150 216 118 190 Z" stroke-width="5"/>' +
        linea('M128 190 L126 196 M138 195 L136 201 M150 197 L150 204 M162 195 L164 201 M172 190 L174 196', 3)
    ),
  },
  {
    label: 'Blusa de puntos',
    svg:
      torso(linea(COSTADOS)) +
      `<path d="M98 200 L128 186 L150 226 L172 186 L202 200 L210 312 L90 312 Z" ${NEGRO} stroke-width="6"/>` +
      [
        [110, 222], [190, 222], [104, 248], [130, 244], [170, 244], [196, 248],
        [118, 270], [150, 262], [182, 270], [104, 294], [134, 290], [166, 290], [196, 294],
      ].map(([x, y]) => punto(x, y, 4, '#fff')).join(''),
  },
  {
    label: 'Bata',
    svg: torso(
      linea(COSTADOS) +
        '<path d="M128 185 L114 214 L150 264 Z" stroke-width="5"/><path d="M172 185 L186 214 L150 264 Z" stroke-width="5"/>' +
        mancha('M136 196 Q150 205 164 196 L150 240 Z', 4) +
        linea('M150 264 L150 312', 5) +
        '<path d="M98 242 L126 242 L126 268 L98 268 Z" stroke-width="5"/>' +
        mancha('M106 230 L111 230 L111 248 L106 248 Z', 3)
    ),
  },
];

/* ───────────────────────────────── Cara ───────────────────────────────── */

/**
 * Oreja izquierda (la única visible en 3/4), con su pliegue interior. Es una
 * capa FIJA que se pinta encima del cabello (como en las referencias: la
 * oreja siempre se ve). Trazo abierto: su relleno blanco tapa el borde de la
 * cara, así oreja y cara quedan como una sola figura.
 */
export const OREJA =
  '<path d="M117 108 C97 96 88 146 119 146"/>' + linea('M110 117 Q101 127 110 137', 4);

const CARAS: AvatarOption[] = [
  {
    label: 'Ovalada',
    svg: '<path d="M110 120 C106 84 122 56 158 54 C192 52 208 78 206 108 C205 130 200 150 186 162 C174 172 152 174 138 166 C122 158 112 142 110 120 Z"/>',
  },
  {
    label: 'Redonda',
    svg: '<path d="M108 118 C104 80 124 54 158 54 C194 54 211 80 209 112 C207 140 196 162 172 170 C152 176 128 170 118 154 C112 144 108 132 108 118 Z"/>',
  },
  {
    label: 'Alargada',
    svg: '<path d="M112 118 C108 80 124 52 158 50 C190 50 206 76 204 108 C203 134 198 160 184 172 C172 182 150 182 138 174 C122 164 114 144 112 118 Z"/>',
  },
];

/* ─────────────────────────────── Cabello ─────────────────────────────── */

const circulos = (lista: Array<[number, number, number]>) =>
  lista.map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}" ${NEGRO} stroke-width="6"/>`).join('');

/** Frente de casi todos los peinados: masa sobre el cráneo y flequillo corto. */
const FRENTE_CORTO =
  'M107 126 C95 92 102 58 136 45 C164 35 200 42 210 68 C215 81 213 94 208 102 C203 93 197 88 189 86 C175 94 153 95 136 89 C130 94 126 100 124 110 Z';
/** Frente de los peinados largos: raya al lado y mechón que baja por la sien. */
const FRENTE_LARGO =
  'M106 128 C93 84 118 46 162 45 C201 45 219 76 211 114 C209 126 207 134 205 142 C201 122 199 104 189 90 C171 98 147 96 130 88 C127 99 125 110 124 120 Z';

const CABELLOS: AvatarOption[] = [
  { label: 'Corto', peso: 3, svg: mancha(FRENTE_CORTO) },
  {
    label: 'Corto con copete',
    peso: 2,
    svg: mancha(
      'M107 126 C95 94 100 62 128 48 C148 30 186 24 208 38 C220 46 218 60 212 68 C216 78 214 90 208 102 C203 93 197 88 189 86 C175 94 153 95 136 89 C130 94 126 100 124 110 Z'
    ),
  },
  {
    label: 'Rizado',
    peso: 2,
    svg:
      circulos([
        [110, 112, 13], [108, 90, 15], [118, 68, 17], [140, 52, 18], [166, 46, 18], [190, 52, 17], [206, 70, 14], [210, 90, 10],
      ]) + mancha(FRENTE_CORTO),
  },
  {
    label: 'Moño',
    peso: 2,
    back: circulos([[124, 42, 20]]),
    svg: mancha(FRENTE_LARGO),
  },
  {
    label: 'Largo liso',
    peso: 2,
    back: mancha(
      'M114 66 C90 88 86 150 88 210 C96 224 118 226 130 212 C125 188 121 160 121 130 L204 128 C206 160 204 186 206 204 C216 212 228 206 232 196 C224 160 226 110 211 74 C195 44 134 42 114 66 Z'
    ),
    svg: mancha(FRENTE_LARGO),
  },
  {
    label: 'Ondulado',
    peso: 2,
    back: mancha(
      'M114 66 C90 84 92 116 96 136 C84 152 100 168 92 184 C88 200 100 214 116 210 C130 214 134 200 126 188 C120 170 121 150 121 130 L204 128 C206 148 200 164 208 178 C202 194 214 206 226 200 C236 192 230 180 228 170 C238 156 226 140 230 124 C232 104 224 84 211 72 C195 44 134 42 114 66 Z'
    ),
    svg: mancha(FRENTE_LARGO),
  },
  {
    label: 'Melena corta',
    peso: 2,
    back: mancha(
      'M114 66 C92 86 90 130 96 168 C104 178 122 178 128 170 C124 156 122 140 122 126 L204 126 C206 144 206 158 212 170 C222 172 230 166 228 156 C226 120 226 92 211 72 C195 44 134 42 114 66 Z'
    ),
    svg: mancha(FRENTE_LARGO),
  },
  {
    label: 'Cola de caballo',
    peso: 1,
    back: mancha('M112 80 C86 84 76 116 84 150 C90 176 82 196 94 206 C114 196 116 166 114 140 Z'),
    svg: mancha(FRENTE_CORTO),
  },
  {
    label: 'Cresta',
    peso: 1,
    svg: mancha(
      'M120 84 L104 64 L128 68 L120 42 L144 56 L148 28 L164 52 L178 30 L184 58 L206 46 L200 74 L214 76 L204 92 C190 82 172 78 156 80 C140 82 130 84 120 84 Z',
      5
    ),
  },
  {
    label: 'Rapado',
    peso: 1,
    svg: mancha('M108 118 C100 80 122 52 160 51 C192 51 210 72 207 96 C196 86 172 80 148 82 C134 84 124 92 120 106 Z'),
  },
  {
    label: 'Entradas',
    peso: 1,
    svg: mancha('M107 126 C99 104 104 80 120 66 C130 64 134 72 128 80 C120 92 120 106 122 118 Z'),
  },
  { label: 'Calvo', peso: 0.5, svg: '' },
];

/* ──────────────────────────────── Cejas ──────────────────────────────── */

const CEJAS: AvatarOption[] = [
  { label: 'Ninguna', peso: 2, svg: '' },
  { label: 'Cortas', peso: 2, svg: linea('M147 97 L161 95 M175 95 L187 97', 5) },
  { label: 'Arqueadas', peso: 1, svg: linea('M146 99 Q154 92 163 96 M174 96 Q182 92 188 98', 5) },
  { label: 'Fruncidas', peso: 0.5, svg: linea('M147 95 L162 100 M175 100 L188 95', 5) },
];

/* ──────────────────────────────── Ojos ──────────────────────────────── */

const OJOS: AvatarOption[] = [
  { label: 'Puntos', peso: 5, svg: punto(155, 112, 5.5) + punto(182, 111, 5.5) },
  { label: 'Felices', peso: 1, svg: linea('M148 114 Q155 105 162 114 M175 113 Q182 104 189 113', 5) },
  { label: 'Cerrados', peso: 1, svg: linea('M148 110 Q155 117 162 110 M175 109 Q182 116 189 109', 5) },
  { label: 'Guiño', peso: 0.5, svg: punto(155, 112, 5.5) + linea('M175 113 Q182 104 189 113', 5) },
];

/* ──────────────────────────────── Nariz ──────────────────────────────── */

/**
 * Nariz de perfil 3/4: un bulto que sale del contorno derecho de la cara.
 * Trazo abierto con relleno blanco: tapa el borde de la cara en ese tramo y
 * queda como parte del perfil.
 */
const NARICES: AvatarOption[] = [
  { label: 'Curva', peso: 3, svg: '<path d="M205 114 Q223 129 203 137"/>' },
  { label: 'Gancho', peso: 1, svg: '<path d="M205 112 L221 131 L203 136"/>' },
  { label: 'Ninguna', peso: 1, svg: '' },
];

/* ──────────────────────────────── Boca ──────────────────────────────── */

const BOCAS: AvatarOption[] = [
  { label: 'Sonrisa', peso: 4, svg: linea('M158 145 Q168 153 178 144', 5) },
  { label: 'Neutral', peso: 2, svg: linea('M160 149 L177 147', 5) },
  { label: 'Risa', peso: 1, svg: '<path d="M156 142 Q168 160 181 141 Z" fill="#000" stroke-width="4"/>' },
  { label: 'Ladeada', peso: 1, svg: linea('M159 149 Q171 151 178 142', 5) },
  { label: 'Seria', peso: 0.5, svg: linea('M160 151 Q168 145 177 150', 5) },
];

/* ──────────────────────────────── Barba ──────────────────────────────── */

const BIGOTE = 'M152 143 C154 132 165 127 175 132 C185 127 196 132 198 143 C190 139 182 138 175 139 C168 138 160 139 152 143 Z';

const BARBAS: AvatarOption[] = [
  { label: 'Ninguna', peso: 6, svg: '' },
  { label: 'Bigote', peso: 1, svg: mancha(BIGOTE, 4) },
  {
    label: 'Barba completa',
    peso: 1,
    svg:
      mancha('M113 108 C108 140 122 168 148 176 C172 182 196 168 204 132 C198 138 192 138 186 134 C180 130 168 130 162 136 C154 142 142 140 134 132 C126 124 122 114 120 104 Z', 5) +
      `<path d="M160 151 Q170 157 180 149" ${SIN_RELLENO} stroke="#fff" stroke-width="5"/>`,
  },
  {
    label: 'Candado',
    peso: 1,
    svg: mancha(BIGOTE, 4) + mancha('M160 158 Q170 176 182 157 Q172 162 160 158 Z', 4),
  },
  {
    label: 'Barba corta',
    peso: 1,
    svg:
      mancha('M118 132 C122 158 138 172 156 174 C176 174 192 164 200 146 C192 150 186 156 176 158 C166 160 156 158 148 152 C136 148 126 142 118 132 Z', 4),
  },
];

/* ──────────────────────────────── Gafas ──────────────────────────────── */

const PATA = linea('M140 108 L114 104', 5);

export const GAFAS: AvatarOption[] = [
  { label: 'Ninguna', peso: 6, svg: '' },
  {
    label: 'Redondas',
    peso: 1,
    svg:
      `<circle cx="154" cy="112" r="14" ${SIN_RELLENO} stroke-width="5"/><ellipse cx="184" cy="111" rx="10" ry="13" ${SIN_RELLENO} stroke-width="5"/>` +
      linea('M168 110 Q171 106 174 110', 5) + PATA,
  },
  {
    label: 'Rectangulares',
    peso: 1,
    svg:
      `<rect x="139" y="100" width="31" height="24" rx="6" ${SIN_RELLENO} stroke-width="5"/><rect x="175" y="100" width="22" height="24" rx="6" ${SIN_RELLENO} stroke-width="5"/>` +
      linea('M170 108 L175 108', 5) + linea('M139 106 L114 103', 5),
  },
  {
    label: 'De sol',
    peso: 1,
    svg:
      mancha('M137 102 L171 102 C171 118 163 126 153 126 C143 126 137 118 137 102 Z', 4) +
      mancha('M175 102 L201 102 C201 118 195 125 187 125 C179 125 175 118 175 102 Z', 4) +
      linea('M133 102 L204 102', 6) + linea('M135 104 L114 102', 5),
  },
];

/* ───────────────────────────── Accesorios ───────────────────────────── */

const ACCESORIOS_PERSONA: AvatarOption[] = [
  { label: 'Ninguno', peso: 7, svg: '' },
  {
    label: 'Sombrero',
    peso: 1,
    svg:
      '<ellipse cx="160" cy="86" rx="80" ry="13" stroke-width="5"/>' +
      '<path d="M118 86 C114 38 206 34 202 86 Z" stroke-width="5"/>' +
      mancha('M118 68 C140 64 180 64 202 68 L202 82 C180 78 140 78 118 82 Z', 4),
  },
  {
    label: 'Gorra',
    peso: 1,
    svg:
      '<path d="M104 98 C100 58 130 38 162 40 C194 42 212 64 210 96 C176 88 136 88 104 98 Z" stroke-width="5"/>' +
      '<path d="M194 92 C214 88 236 90 244 98 C238 104 214 104 200 102 Z" stroke-width="5"/>' +
      linea('M158 42 L156 90', 4) + punto(158, 40, 4),
  },
  {
    label: 'Aretes',
    peso: 1,
    combinable: true,
    // Aro con halo blanco: se lee igual sobre la piel y sobre el cabello negro.
    svg:
      `<circle cx="112" cy="159" r="7" ${SIN_RELLENO} stroke="#fff" stroke-width="10"/>` +
      `<circle cx="112" cy="159" r="7" ${SIN_RELLENO} stroke-width="4"/>`,
  },
  {
    label: 'Tapabocas',
    peso: 0.5,
    svg:
      linea('M150 124 L113 110 M152 152 L114 128', 4) +
      '<path d="M148 120 C170 114 196 114 208 120 L206 148 C198 164 172 168 150 158 Z" stroke-width="5"/>' +
      linea('M156 132 C176 128 196 128 206 131 M156 145 C176 142 194 142 204 144', 3),
  },
];

/* ───────────────────────────── Categorías ───────────────────────────── */

/**
 * Categorías del editor de PERSONA, en el orden de los botones. Igual que
 * Avatartion: primero las partes principales y luego "las demás".
 */
export const CATEGORIAS_PERSONA: AvatarCategory[] = [
  { id: 'cara', label: 'Cara', title: 'Caras', options: CARAS, thumbViewBox: '84 40 140 150' },
  { id: 'cabello', label: 'Cabello', title: 'Cabellos', options: CABELLOS, thumbViewBox: '78 20 150 200', optional: true },
  { id: 'ojos', label: 'Ojos', title: 'Ojos', options: OJOS, thumbViewBox: '140 94 64 36' },
  { id: 'boca', label: 'Boca', title: 'Bocas', options: BOCAS, thumbViewBox: '152 128 40 34' },
  { id: 'ropa', label: 'Ropa', title: 'Ropa', options: ROPA, thumbViewBox: '40 160 220 150' },
  { id: 'cejas', label: 'Cejas', title: 'Cejas', options: CEJAS, thumbViewBox: '140 80 64 36', optional: true },
  { id: 'nariz', label: 'Nariz', title: 'Narices', options: NARICES, thumbViewBox: '150 84 84 66', thumbBase: CARAS[0].svg, optional: true },
  { id: 'barba', label: 'Barba', title: 'Barbas', options: BARBAS, thumbViewBox: '100 96 116 96', optional: true },
  { id: 'gafas', label: 'Gafas', title: 'Gafas', options: GAFAS, thumbViewBox: '106 80 110 56', optional: true },
  { id: 'accesorios', label: 'Accesorios', title: 'Accesorios', options: ACCESORIOS_PERSONA, thumbViewBox: '74 20 176 160', optional: true },
];

/**
 * Orden de PINTADO (de atrás hacia adelante). 'cuello' es la capa fija;
 * 'cabello:back' es el pelo que cae por detrás (sobre los hombros).
 */
export const ORDEN_PERSONA = [
  'cuello', 'ropa', 'cabello:back', 'cara', 'cejas', 'ojos', 'boca',
  'barba', 'cabello', 'nariz', 'oreja', 'gafas', 'accesorios',
] as const;
