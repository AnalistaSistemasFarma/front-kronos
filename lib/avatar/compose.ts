import { CATEGORIAS_ANIMAL, ORDEN_ANIMAL } from './parts-animal';
import { CATEGORIAS_PERSONA, CUELLO, ORDEN_PERSONA } from './parts-persona';
import type { AvatarBackground, AvatarCategory, AvatarConfig, AvatarKind } from './types';

/**
 * Composición del avatar estilo Notion: de una configuración (índices) a SVG.
 *
 * Es código PURO (sin React, sin base de datos) para que lo usen igual el
 * editor del navegador y el endpoint que sirve la imagen, y para poder
 * probarlo con Vitest. Todo el marcado sale de los catálogos de este
 * repositorio; de la configuración solo se leen NÚMEROS ya validados.
 */

/** Fondos: los mismos colores de Avatartion (Tailwind 300 + blanco + transparente). */
export const AVATAR_BACKGROUNDS: AvatarBackground[] = [
  { label: 'Transparente', color: null },
  { label: 'Blanco', color: '#ffffff' },
  { label: 'Rojo', color: '#fca5a5' },
  { label: 'Amarillo', color: '#fde047' },
  { label: 'Verde', color: '#86efac' },
  { label: 'Azul', color: '#93c5fd' },
  { label: 'Índigo', color: '#a5b4fc' },
  { label: 'Morado', color: '#d8b4fe' },
  { label: 'Rosado', color: '#f9a8d4' },
];

/** Fondo con el que arranca Avatartion ("bg-red-300"). */
export const FONDO_INICIAL = 2;

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

/** Avatar al azar, como el botón "Randomize" de Avatartion. */
export function randomAvatarConfig(
  tipo: AvatarKind,
  overrides: Partial<Pick<AvatarConfig, 'fondo'>> = {},
  rnd: () => number = Math.random
): AvatarConfig {
  const partes: Record<string, number> = {};
  for (const cat of categoriasDe(tipo)) {
    // En las categorías opcionales (barba, gafas, accesorios…) la mitad de las
    // veces sale "Ninguno": si no, casi todo avatar al azar sale recargado.
    const vacia = cat.optional ? cat.options.findIndex((o) => !o.svg && !o.back) : -1;
    if (vacia >= 0 && rnd() < 0.5) {
      partes[cat.id] = vacia;
      continue;
    }
    partes[cat.id] = Math.floor(rnd() * cat.options.length);
  }
  return {
    v: 1,
    tipo,
    partes,
    fondo: overrides.fondo ?? Math.floor(rnd() * AVATAR_BACKGROUNDS.length),
  };
}

const ABRE_GRUPO =
  '<g fill="#fff" stroke="#000" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">';

function capa(config: AvatarConfig, paso: string): string {
  if (paso === 'cuello') return CUELLO;
  const [id, parte] = paso.split(':');
  const cat = categoriasDe(config.tipo).find((c) => c.id === id);
  if (!cat) return '';
  const opcion = cat.options[config.partes[id] ?? 0] ?? cat.options[0];
  return parte === 'back' ? opcion.back ?? '' : opcion.svg;
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
  const cuerpo = (opcion.back ?? '') + opcion.svg;
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
