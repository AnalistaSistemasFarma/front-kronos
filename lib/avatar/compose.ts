import { createAvatar } from '@dicebear/core';
import * as lorelei from '@dicebear/lorelei';
import type { AvatarConfig, ColorAvatar, ParteFija, ParteOpcional } from './types';

/**
 * Avatar estilo Notion con DiceBear + Lorelei.
 *
 * - Librería: @dicebear/core (MIT) y @dicebear/lorelei (código MIT; diseño
 *   "Lorelei" de Lisa Wischofsky, CC0 1.0). El SVG generado lleva la
 *   atribución en su <metadata>.
 * - Código PURO (sin React ni base de datos): lo usan igual el editor del
 *   navegador (vista previa) y los endpoints /api/avatar/... (imagen servida),
 *   y se prueba con Vitest.
 * - Los catálogos (variantes de cada parte) salen del ESQUEMA de la versión
 *   instalada de Lorelei, no de una lista copiada a mano.
 */

/* ───────────────────────────── Catálogo ───────────────────────────── */

type EsquemaPropiedad = { items?: { enum?: string[] } };
const propiedades = (lorelei.schema.properties ?? {}) as Record<string, EsquemaPropiedad>;

/** Variantes de una parte, ordenadas (variant01, variant02… / happy01…, sad01…). */
function variantes(parte: string): readonly string[] {
  const lista = [...(propiedades[parte]?.items?.enum ?? [])];
  return lista.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

export const PARTES_FIJAS: readonly ParteFija[] = ['hair', 'head', 'eyes', 'eyebrows', 'mouth', 'nose'];
export const PARTES_OPCIONALES: readonly ParteOpcional[] = ['glasses', 'beard', 'earrings', 'freckles', 'hairAccessories'];
export const COLORES: readonly ColorAvatar[] = ['hairColor', 'skinColor', 'backgroundColor'];

export const CATALOGO: Readonly<Record<ParteFija | ParteOpcional, readonly string[]>> = Object.fromEntries(
  [...PARTES_FIJAS, ...PARTES_OPCIONALES].map((p) => [p, variantes(p)])
) as Record<ParteFija | ParteOpcional, readonly string[]>;

/**
 * Paletas. Por defecto el avatar queda en blanco y negro (piel blanca, cabello
 * negro, fondo gris claro): el mismo estilo de línea de Notion. El resto son
 * opciones para quien quiera color.
 */
export const PALETAS: Readonly<Record<ColorAvatar, ReadonlyArray<{ label: string; color: string }>>> = {
  hairColor: [
    { label: 'Negro', color: '000000' },
    { label: 'Castaño oscuro', color: '4a312c' },
    { label: 'Castaño', color: '724133' },
    { label: 'Cobrizo', color: 'a55728' },
    { label: 'Rubio', color: 'd6b370' },
    { label: 'Canoso', color: 'b1b1b1' },
    { label: 'Azul', color: '2c1b8f' },
  ],
  skinColor: [
    { label: 'Blanco (línea)', color: 'ffffff' },
    { label: 'Claro', color: 'f8d9ce' },
    { label: 'Trigueño claro', color: 'f2d3b1' },
    { label: 'Trigueño', color: 'ecad80' },
    { label: 'Moreno', color: 'd08b5b' },
    { label: 'Moreno oscuro', color: 'ae5d29' },
    { label: 'Oscuro', color: '614335' },
  ],
  backgroundColor: [
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

/** Colores con los que arranca un avatar nuevo (blanco y negro, fondo gris). */
export const COLORES_INICIALES: Readonly<Record<ColorAvatar, string>> = {
  hairColor: '000000',
  skinColor: 'ffffff',
  backgroundColor: 'f2f2f2',
};

/** Tope del JSON guardado (columna NVARCHAR(1000)). Una configuración ocupa ~330. */
export const MAX_CONFIG_JSON = 1000;
const MAX_SEED = 64;

/* ───────────────────────── Validación ───────────────────────── */

const HEX = /^[0-9a-f]{6}$/;
const esColorValido = (c: unknown, admiteTransparente: boolean): c is string =>
  typeof c === 'string' && (HEX.test(c) || (admiteTransparente && c === 'transparent'));

/**
 * Valida una configuración que llega de afuera (cuerpo de la petición o la
 * base). Devuelve una copia LIMPIA o null. Estricta a propósito:
 *   - solo la versión 2 / estilo 'lorelei';
 *   - solo claves conocidas (una clave desconocida invalida todo);
 *   - cada parte debe existir en el esquema de Lorelei instalado;
 *   - colores hexadecimales de 6 dígitos (minúsculas).
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
  if (o.v !== 2 || o.estilo !== 'lorelei') return null;

  const permitidas = new Set<string>(['v', 'estilo', 'seed', 'flip', ...PARTES_FIJAS, ...PARTES_OPCIONALES, ...COLORES]);
  for (const clave of Object.keys(o)) if (!permitidas.has(clave)) return null;

  if (typeof o.seed !== 'string' || o.seed.length > MAX_SEED) return null;
  if (typeof o.flip !== 'boolean') return null;

  const limpia: Record<string, unknown> = { v: 2, estilo: 'lorelei', seed: o.seed, flip: o.flip };
  for (const p of PARTES_FIJAS) {
    const v = o[p];
    if (typeof v !== 'string' || !CATALOGO[p].includes(v)) return null;
    limpia[p] = v;
  }
  for (const p of PARTES_OPCIONALES) {
    const v = o[p] ?? null;
    if (v !== null && (typeof v !== 'string' || !CATALOGO[p].includes(v))) return null;
    limpia[p] = v;
  }
  for (const c of COLORES) {
    if (!esColorValido(o[c], c === 'backgroundColor')) return null;
    limpia[c] = o[c];
  }
  return limpia as unknown as AvatarConfig;
}

/** JSON compacto para guardar (orden de claves estable). */
export function serializeAvatarConfig(config: AvatarConfig): string {
  const salida: Record<string, unknown> = { v: 2, estilo: 'lorelei', seed: config.seed };
  for (const p of PARTES_FIJAS) salida[p] = config[p];
  for (const p of PARTES_OPCIONALES) salida[p] = config[p] ?? null;
  for (const c of COLORES) salida[c] = config[c];
  salida.flip = config.flip;
  return JSON.stringify(salida);
}

/* ───────────────────────── DiceBear ───────────────────────── */

/** Configuración → opciones de createAvatar(lorelei, …). Todo explícito. */
export function opcionesLorelei(config: AvatarConfig): Record<string, unknown> {
  const op: Record<string, unknown> = {
    seed: config.seed,
    flip: config.flip,
    hairColor: [config.hairColor],
    skinColor: [config.skinColor],
    backgroundColor: [config.backgroundColor],
  };
  for (const p of PARTES_FIJAS) op[p] = [config[p]];
  for (const p of PARTES_OPCIONALES) {
    const v = config[p];
    op[p] = [v ?? CATALOGO[p][0]];
    op[`${p}Probability`] = v ? 100 : 0;
  }
  return op;
}

/**
 * Avatar a partir de una SEMILLA, con el azar propio de DiceBear (incluidas
 * sus probabilidades: gafas 10 %, barba 5 %, aretes 10 %…). Lo que DiceBear
 * elige se vuelve configuración explícita (toJson().extra), así que lo que se
 * ve en el editor es exactamente lo que se guarda y lo que sirve el endpoint.
 */
export function configDesdeSemilla(seed: string, colores: Partial<Record<ColorAvatar, string>> = {}): AvatarConfig {
  const semilla = seed.slice(0, MAX_SEED);
  const base = { ...COLORES_INICIALES, ...colores };
  const extra = createAvatar(lorelei, {
    seed: semilla,
    hairColor: [base.hairColor],
    skinColor: [base.skinColor],
    backgroundColor: [base.backgroundColor],
  }).toJson().extra as Record<string, unknown>;

  const config: Record<string, unknown> = { v: 2, estilo: 'lorelei', seed: semilla, flip: false, ...base };
  for (const p of PARTES_FIJAS) {
    const v = extra[p];
    config[p] = typeof v === 'string' && CATALOGO[p].includes(v) ? v : CATALOGO[p][0];
  }
  for (const p of PARTES_OPCIONALES) {
    const v = extra[p];
    config[p] = typeof v === 'string' && CATALOGO[p].includes(v) ? v : null;
  }
  return config as unknown as AvatarConfig;
}

/** Semilla aleatoria (no criptográfica: solo elige un dibujo). */
export function semillaAleatoria(): string {
  return Math.random().toString(36).slice(2, 12);
}

/** Avatar aleatorio; conserva los colores que se le pasen (p. ej. los ya elegidos). */
export function randomAvatarConfig(colores: Partial<Record<ColorAvatar, string>> = {}): AvatarConfig {
  return configDesdeSemilla(semillaAleatoria(), colores);
}

/**
 * Avatar SUGERIDO para un asistente: Lorelei con la semilla de su nombre
 * (Atlas, Galileo, Kepler…). Siempre el mismo para el mismo nombre. Solo es un
 * punto de partida; nada se guarda hasta pulsar "Guardar".
 */
export function sugerenciaParaAgente(nombre: string): AvatarConfig {
  return configDesdeSemilla(nombre.trim() || 'asistente');
}

/**
 * SVG completo del avatar con createAvatar(lorelei, …). `size` fija
 * width/height; sin él se estira a su contenedor. `title` agrega <title>
 * (escapado) para accesibilidad.
 */
export function composeAvatarSvg(config: AvatarConfig, opts: { size?: number; title?: string } = {}): string {
  const op = opcionesLorelei(config);
  if (opts.size) op.size = opts.size;
  const svg = createAvatar(lorelei, op).toString();
  if (!opts.title) return svg;
  return svg.replace(/^<svg([^>]*)>/, (m) => `${m}<title>${escapeXml(opts.title as string)}</title>`);
}

/**
 * Recortes (viewBox sobre el lienzo de 980 de Lorelei) para las miniaturas
 * del editor: cada botón muestra solo la zona de su parte.
 */
export const RECORTES: Readonly<Record<ParteFija | ParteOpcional | ColorAvatar, string>> = {
  hair: '60 20 860 860',
  hairAccessories: '100 0 720 720',
  head: '150 220 680 680',
  eyes: '360 380 360 200',
  eyebrows: '360 290 360 200',
  glasses: '330 300 420 260',
  nose: '470 440 200 200',
  mouth: '440 520 230 190',
  beard: '250 420 580 440',
  earrings: '100 360 380 380',
  freckles: '300 420 360 220',
  hairColor: '60 20 860 860',
  skinColor: '150 220 680 680',
  backgroundColor: '0 0 980 980',
};

/** Miniatura: el avatar actual con UNA parte cambiada, recortado a su zona. */
export function composePartThumbSvg(
  config: AvatarConfig,
  parte: ParteFija | ParteOpcional | ColorAvatar,
  valor: string | null
): string {
  const variante = { ...config, [parte]: valor, backgroundColor: 'transparent' } as AvatarConfig;
  if (parte === 'backgroundColor') variante.backgroundColor = valor ?? 'transparent';
  const svg = composeAvatarSvg(variante);
  return svg.replace(/viewBox="[^"]*"/, `viewBox="${RECORTES[parte]}"`);
}


/* ───────────────────────── Editor ───────────────────────── */

export type CategoriaId = ParteFija | ParteOpcional | ColorAvatar;

/** Una categoría del editor (un círculo con su selector). */
export interface CategoriaEditor {
  id: CategoriaId;
  /** Texto del botón (singular). */
  label: string;
  /** Título del selector (plural). */
  title: string;
  /** Valores posibles; null = "Ninguno". */
  opciones: ReadonlyArray<string | null>;
  esColor: boolean;
}

const NUMERO = /(\d+)$/;
const numero = (v: string) => Number(NUMERO.exec(v)?.[1] ?? 0);

/** Nombre visible (español) de un valor de una categoría. */
export function etiquetaOpcion(cat: CategoriaId, valor: string | null): string {
  if (valor === null) return 'Ninguno';
  if (cat === 'hairColor' || cat === 'skinColor' || cat === 'backgroundColor') {
    return PALETAS[cat].find((p) => p.color === valor)?.label ?? `#${valor}`;
  }
  if (cat === 'mouth') return `${valor.startsWith('sad') ? 'Seria' : 'Sonrisa'} ${numero(valor)}`;
  if (cat === 'hairAccessories') return 'Flores';
  const nombres: Record<string, string> = {
    hair: 'Cabello',
    head: 'Cara',
    eyes: 'Ojos',
    eyebrows: 'Cejas',
    nose: 'Nariz',
    glasses: 'Lentes',
    beard: 'Barba',
    earrings: 'Aretes',
    freckles: 'Pecas',
  };
  return `${nombres[cat] ?? cat} ${numero(valor)}`;
}

const fija = (id: ParteFija, label: string, title: string): CategoriaEditor => ({
  id,
  label,
  title,
  opciones: CATALOGO[id],
  esColor: false,
});
const opcional = (id: ParteOpcional, label: string, title: string): CategoriaEditor => ({
  id,
  label,
  title,
  opciones: [null, ...CATALOGO[id]],
  esColor: false,
});
const color = (id: ColorAvatar, label: string, title: string): CategoriaEditor => ({
  id,
  label,
  title,
  opciones: PALETAS[id].map((p) => p.color),
  esColor: true,
});

/** Categorías del editor, en el orden de los círculos. */
export const CATEGORIAS_EDITOR: readonly CategoriaEditor[] = [
  fija('hair', 'Cabello', 'Cabellos'),
  fija('head', 'Cara', 'Caras'),
  fija('eyes', 'Ojos', 'Ojos'),
  fija('eyebrows', 'Cejas', 'Cejas'),
  fija('mouth', 'Boca', 'Bocas'),
  fija('nose', 'Nariz', 'Narices'),
  opcional('glasses', 'Lentes', 'Lentes'),
  opcional('beard', 'Barba', 'Barbas'),
  opcional('earrings', 'Aretes', 'Aretes'),
  opcional('freckles', 'Pecas', 'Pecas'),
  opcional('hairAccessories', 'Accesorio', 'Accesorios del cabello'),
  color('hairColor', 'Color de cabello', 'Colores de cabello'),
  color('skinColor', 'Color de piel', 'Colores de piel'),
  color('backgroundColor', 'Fondo', 'Fondos'),
];

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
