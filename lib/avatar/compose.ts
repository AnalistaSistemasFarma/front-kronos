import { CATEGORIAS_ANIMAL, ORDEN_ANIMAL } from './parts-animal';
import { CATEGORIAS_PERSONA, CUELLO, ORDEN_PERSONA, OREJA } from './parts-persona';
import type { AvatarBackground, AvatarCategory, AvatarConfig, AvatarKind } from './types';

/**
 * Composición del avatar estilo Notion: de una configuración (índices) a SVG.
 *
 * Es código PURO (sin React, sin base de datos) para que lo usen igual el
 * editor del navegador y el endpoint que sirve la imagen, y para poder
 * probarlo con Vitest. Todo el marcado sale de los catálogos de este
 * repositorio; de la configuración solo se leen NÚMEROS ya validados.
 */

/**
 * Fondos: solo neutros (el estilo es blanco y negro puro). El primero, gris
 * muy claro, es el de arranque: se lee bien sobre la interfaz blanca.
 */
export const AVATAR_BACKGROUNDS: AvatarBackground[] = [
  { label: 'Gris claro', color: '#f2f2f2' },
  { label: 'Blanco', color: '#ffffff' },
  { label: 'Transparente', color: null },
];

/** Fondo con el que arranca el editor. */
export const FONDO_INICIAL = 0;

export const AVATAR_KINDS: readonly AvatarKind[] = ['persona', 'animal'];

export function categoriasDe(tipo: AvatarKind): AvatarCategory[] {
  return tipo === 'animal' ? CATEGORIAS_ANIMAL : CATEGORIAS_PERSONA;
}

function ordenDe(tipo: AvatarKind): readonly string[] {
  return tipo === 'animal' ? ORDEN_ANIMAL : ORDEN_PERSONA;
}

/** Tope del JSON guardado. Una configuración válida ocupa ~150 caracteres. */
export const MAX_CONFIG_JSON = 1000;

const esEnteroEnRango = (n: unknown, max: number): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < max;

/**
 * Valida una configuración que llega de afuera (cuerpo de la petición o la
 * base). Devuelve una copia LIMPIA o null. Estricta a propósito:
 *   - solo la versión 1 y los tipos conocidos;
 *   - solo las categorías del tipo (una clave desconocida invalida todo);
 *   - índices enteros dentro del catálogo. Una categoría que falte toma el
 *     índice 0, para que agregar categorías nuevas no rompa lo ya guardado.
 */
export function parseAvatarConfig(raw: unknown): AvatarConfig | null {
  let valor: unknown = raw;
  if (typeof valor === 'string') {
    if (valor.length > MAX_CONFIG_JSON) return null;
    try {
      valor = JSON.parse(valor);
    } catch {
      return null;
    }
  }
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null;
  const o = valor as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (o.tipo !== 'persona' && o.tipo !== 'animal') return null;
  const tipo = o.tipo as AvatarKind;
  if (!esEnteroEnRango(o.fondo, AVATAR_BACKGROUNDS.length)) return null;
  if (!o.partes || typeof o.partes !== 'object' || Array.isArray(o.partes)) return null;

  const partesIn = o.partes as Record<string, unknown>;
  const categorias = categoriasDe(tipo);
  const ids = new Set(categorias.map((c) => c.id));
  for (const clave of Object.keys(partesIn)) {
    if (!ids.has(clave)) return null;
  }

  const partes: Record<string, number> = {};
  for (const cat of categorias) {
    const v = partesIn[cat.id];
    if (v === undefined) {
      partes[cat.id] = 0;
      continue;
    }
    if (!esEnteroEnRango(v, cat.options.length)) return null;
    partes[cat.id] = v;
  }
  return { v: 1, tipo, partes, fondo: o.fondo as number };
}

/** JSON compacto para guardar (orden de claves estable). */
export function serializeAvatarConfig(config: AvatarConfig): string {
  const partes: Record<string, number> = {};
  for (const cat of categoriasDe(config.tipo)) partes[cat.id] = config.partes[cat.id] ?? 0;
  return JSON.stringify({ v: 1, tipo: config.tipo, partes, fondo: config.fondo });
}

/** Elige un índice al azar respetando el `peso` de cada opción (por defecto 1). */
function elegirConPeso(opciones: AvatarCategory['options'], rnd: () => number): number {
  const pesos = opciones.map((o) => Math.max(0, o.peso ?? 1));
  const total = pesos.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let r = rnd() * total;
  for (let i = 0; i < pesos.length; i += 1) {
    r -= pesos[i];
    if (r < 0) return i;
  }
  return pesos.length - 1;
}

/**
 * Avatar al azar, como el botón "Randomize" de Avatartion, pero SOBRIO: cada
 * opción sale según su `peso` (casi siempre sin barba, sin gafas y sin
 * accesorio) y nunca salen gafas y accesorio a la vez, salvo los
 * `combinable` (aretes).
 */
export function randomAvatarConfig(
  tipo: AvatarKind,
  overrides: Partial<Pick<AvatarConfig, 'fondo'>> = {},
  rnd: () => number = Math.random
): AvatarConfig {
  const categorias = categoriasDe(tipo);
  const partes: Record<string, number> = {};
  for (const cat of categorias) partes[cat.id] = elegirConPeso(cat.options, rnd);

  const gafas = categorias.find((c) => c.id === 'gafas');
  const acc = categorias.find((c) => c.id === 'accesorios');
  if (gafas && acc) {
    const conGafas = !!gafas.options[partes.gafas]?.svg;
    const opcionAcc = acc.options[partes.accesorios];
    if (conGafas && opcionAcc?.svg && !opcionAcc.combinable) {
      if (rnd() < 0.5) partes.gafas = gafas.options.findIndex((o) => !o.svg);
      else partes.accesorios = acc.options.findIndex((o) => !o.svg);
    }
  }
  return { v: 1, tipo, partes, fondo: overrides.fondo ?? FONDO_INICIAL };
}

const ABRE_GRUPO =
  '<g fill="#fff" stroke="#000" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">';

function capa(config: AvatarConfig, paso: string): string {
  if (paso === 'cuello') return CUELLO;
  if (paso === 'oreja') return OREJA;
  const [id, parte] = paso.split(':');
  const cat = categoriasDe(config.tipo).find((c) => c.id === id);
  if (!cat) return '';
  const opcion = cat.options[config.partes[id] ?? 0] ?? cat.options[0];
  const svg = parte === 'back' ? opcion.back ?? '' : opcion.svg;
  // Panda: los ojos van sobre el antifaz negro, así que se pintan en blanco.
  if (id === 'ojos' && config.tipo === 'animal') {
    const animal = categoriasDe('animal').find((c) => c.id === 'animal');
    if (animal?.options[config.partes.animal ?? 0]?.ojosBlancos) {
      return `<g stroke="#fff">${svg.replaceAll('fill="#000"', 'fill="#fff"')}</g>`;
    }
  }
  return svg;
}

/**
 * SVG completo del avatar (300×300). `size` fija width/height; sin él, el
 * SVG se estira a su contenedor.
 */
export function composeAvatarSvg(config: AvatarConfig, opts: { size?: number; title?: string } = {}): string {
  const fondo = AVATAR_BACKGROUNDS[config.fondo]?.color ?? null;
  const medidas = opts.size ? ` width="${opts.size}" height="${opts.size}"` : '';
  const titulo = opts.title ? `<title>${escapeXml(opts.title)}</title>` : '';
  const capas = ordenDe(config.tipo).map((paso) => capa(config, paso)).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"${medidas}>` +
    titulo +
    (fondo ? `<rect width="300" height="300" fill="${fondo}"/>` : '') +
    ABRE_GRUPO +
    capas +
    '</g></svg>'
  );
}

/** Miniatura de UNA opción de una categoría, recortada a su zona. */
export function composePartThumbSvg(tipo: AvatarKind, categoriaId: string, indice: number): string {
  const cat = categoriasDe(tipo).find((c) => c.id === categoriaId);
  if (!cat) return '';
  const opcion = cat.options[indice] ?? cat.options[0];
  const cuerpo = (cat.thumbBase ?? '') + (opcion.back ?? '') + opcion.svg;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${cat.thumbViewBox}">` +
    ABRE_GRUPO +
    cuerpo +
    '</g></svg>'
  );
}

/** data: URI para usar el SVG en un <img> (sin inyectarlo en el DOM). */
export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeXml(texto: string): string {
  return texto.replace(/[<>&"']/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === '"' ? '&quot;' : '&apos;'
  );
}

export {
  AVATAR_URL_PREFIX,
  agentAvatarNotionUrl,
  isNotionAvatarUrl,
  notionAvatarVersion,
  userAvatarUrl,
} from './urls';
