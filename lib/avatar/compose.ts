import { CATEGORIAS_ANIMAL, ORDEN_ANIMAL, capaAnimal } from './parts-animal';
import { CATEGORIAS_CONSTELACION, ORDEN_CONSTELACION, capaConstelacion } from './parts-constelacion';
import { CATEGORIAS_PERSONA, ORDEN_PERSONA } from './parts-persona';
import { CATEGORIAS_PLANETA, ORDEN_PLANETA, capaPlaneta } from './parts-planeta';
import { sugerenciaCruda } from './sugerencias';
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

interface DefTipo {
  label: string;
  categorias: AvatarCategory[];
  /** Capas de atrás hacia adelante (ids de categoría). */
  orden: readonly string[];
  /** Ajuste de una capa según el resto de la configuración (posición, color). */
  capa?: (config: AvatarConfig, id: string, svg: string) => string;
}

const TIPOS: Record<AvatarKind, DefTipo> = {
  persona: { label: 'Persona', categorias: CATEGORIAS_PERSONA, orden: ORDEN_PERSONA },
  animal: { label: 'Animal', categorias: CATEGORIAS_ANIMAL, orden: ORDEN_ANIMAL, capa: capaAnimal },
  planeta: { label: 'Planeta', categorias: CATEGORIAS_PLANETA, orden: ORDEN_PLANETA, capa: capaPlaneta },
  constelacion: {
    label: 'Constelación',
    categorias: CATEGORIAS_CONSTELACION,
    orden: ORDEN_CONSTELACION,
    capa: capaConstelacion,
  },
};

/** Todos los tipos, en el orden en que se muestran en el editor de agentes. */
export const AVATAR_KINDS: readonly AvatarKind[] = ['animal', 'planeta', 'constelacion', 'persona'];

export const esTipoAvatar = (t: unknown): t is AvatarKind => typeof t === 'string' && t in TIPOS;

export function etiquetaTipo(tipo: AvatarKind): string {
  return TIPOS[tipo].label;
}

export function categoriasDe(tipo: AvatarKind): AvatarCategory[] {
  return TIPOS[tipo].categorias;
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
  if (!esTipoAvatar(o.tipo)) return null;
  const tipo = o.tipo;
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
  '<g fill="#fff" stroke="#000" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" filter="url(#halo)">';

/**
 * Halo blanco alrededor de todo el dibujo (como notion-avatar): lo despega
 * del fondo y lo hace legible sobre cualquier color, incluso a 28 px.
 */
const HALO =
  '<defs><filter id="halo" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">' +
  '<feMorphology operator="dilate" radius="5" in="SourceAlpha" result="borde"/>' +
  '<feFlood flood-color="#fff" result="blanco"/>' +
  '<feComposite in="blanco" in2="borde" operator="in" result="halo"/>' +
  '<feMerge><feMergeNode in="halo"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>';

function capa(config: AvatarConfig, id: string): string {
  const def = TIPOS[config.tipo];
  const cat = def.categorias.find((c) => c.id === id);
  if (!cat) return '';
  const opcion = cat.options[config.partes[id] ?? 0] ?? cat.options[0];
  const svg = opcion.svg;
  return def.capa ? def.capa(config, id, svg) : svg;
}

/**
 * SVG completo del avatar (300×300). `size` fija width/height; sin él, el
 * SVG se estira a su contenedor.
 */
export function composeAvatarSvg(config: AvatarConfig, opts: { size?: number; title?: string } = {}): string {
  const fondo = AVATAR_BACKGROUNDS[config.fondo]?.color ?? null;
  const medidas = opts.size ? ` width="${opts.size}" height="${opts.size}"` : '';
  const titulo = opts.title ? `<title>${escapeXml(opts.title)}</title>` : '';
  const capas = TIPOS[config.tipo].orden.map((id) => capa(config, id)).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"${medidas}>` +
    titulo +
    HALO +
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
  const cuerpo = (cat.thumbBase ?? '') + opcion.svg;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${cat.thumbViewBox}">` +
    ABRE_GRUPO.replace(' filter="url(#halo)"', '') +
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

/**
 * Avatar sugerido para un asistente por su nombre (Orión → constelación de
 * Orión, Mercurio → planeta Mercurio…), ya validado. Null si no hay.
 */
export function sugerenciaParaAgente(nombre: string): AvatarConfig | null {
  const s = sugerenciaCruda(nombre);
  return s ? parseAvatarConfig({ ...s, fondo: FONDO_INICIAL }) : null;
}
