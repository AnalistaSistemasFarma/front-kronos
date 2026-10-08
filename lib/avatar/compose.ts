import { Avatar, Style } from '@dicebear/core';
import loreleiDef from '@dicebear/styles/lorelei.json';
import type { AvatarConfig, AvatarOwner, ColorAvatar, FlipAvatar, ParteFija, ParteOpcional } from './types';

/**
 * Avatar estilo Notion con DiceBear 10 + Lorelei (@dicebear/styles).
 *
 * - @dicebear/core 10.7.0 (MIT) y @dicebear/styles 10.6.0; el diseño
 *   "Lorelei" es de Lisa Wischofsky, CC0 1.0. El SVG lleva la atribución en
 *   su <metadata>.
 * - Código PURO (sin React ni base de datos): lo usan igual el editor del
 *   navegador (vista previa, como <img src="data:…">) y los endpoints
 *   /api/avatar/... (imagen servida), y se prueba con Vitest.
 * - El catálogo (variantes de cada parte) se lee de la DEFINICIÓN de Lorelei
 *   instalada, no de una lista copiada a mano.
 */

const lorelei = new Style(loreleiDef as ConstructorParameters<typeof Style>[0]);

/* ───────────────────────────── Catálogo ───────────────────────────── */

type Definicion = { components?: Record<string, { variants?: Record<string, unknown>; probability?: number }> };
const componentes = (loreleiDef as Definicion).components ?? {};

/** Variantes de un componente, ordenadas (variant01… / happy01…, sad01…). */
function variantes(parte: string): readonly string[] {
  return Object.keys(componentes[parte]?.variants ?? {}).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

export const PARTES_FIJAS: readonly ParteFija[] = ['hair', 'head', 'eyes', 'eyebrows', 'mouth', 'nose'];
export const PARTES_OPCIONALES: readonly ParteOpcional[] = ['glasses', 'earrings', 'beard', 'freckles', 'hairAccessories'];
export const COLORES: readonly ColorAvatar[] = ['hairColor', 'skinColor', 'backgroundColor'];
export const FLIPS: readonly FlipAvatar[] = ['none', 'horizontal', 'vertical', 'both'];

export const CATALOGO: Readonly<Record<ParteFija | ParteOpcional, readonly string[]>> = Object.fromEntries(
  [...PARTES_FIJAS, ...PARTES_OPCIONALES].map((p) => [p, variantes(p)])
) as Record<ParteFija | ParteOpcional, readonly string[]>;

/** Bocas permitidas a los asistentes del chat: solo las sonrientes (happy*). */
export const BOCAS_ASISTENTE: readonly string[] = CATALOGO.mouth.filter((m) => m.startsWith('happy'));

/** Bocas válidas según el dueño del avatar. */
export function bocasPara(owner: AvatarOwner): readonly string[] {
  return owner === 'agent' ? BOCAS_ASISTENTE : CATALOGO.mouth;
}

/**
 * Paletas. Por defecto el avatar queda en blanco y negro (piel blanca, cabello
 * negro, fondo gris claro): el look de Notion. El resto son opciones.
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

/** Tope del JSON guardado (columna NVARCHAR(1000)). Una configuración ocupa ~340. */
export const MAX_CONFIG_JSON = 1000;
const MAX_SEED = 64;

/* ───────────────────────── Validación ───────────────────────── */

const HEX = /^[0-9a-f]{6}$/;
const esColorValido = (c: unknown, admiteTransparente: boolean): c is string =>
  typeof c === 'string' && (HEX.test(c) || (admiteTransparente && c === 'transparent'));

/**
 * Valida una configuración que llega de afuera (cuerpo de la petición o la
 * base). Devuelve una copia LIMPIA o null. Estricta a propósito:
 *   - solo la versión 3 / estilo 'lorelei' (las de motores anteriores no valen);
 *   - solo claves conocidas (una clave desconocida invalida todo);
 *   - cada parte debe existir en la definición de Lorelei instalada;
 *   - en los asistentes (owner 'agent'), la boca debe ser happy*;
 *   - colores hexadecimales de 6 dígitos (minúsculas).
 */
export function parseAvatarConfig(raw: unknown, owner: AvatarOwner = 'user'): AvatarConfig | null {
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
  if (o.v !== 3 || o.estilo !== 'lorelei') return null;

  const permitidas = new Set<string>(['v', 'estilo', 'seed', 'flip', ...PARTES_FIJAS, ...PARTES_OPCIONALES, ...COLORES]);
  for (const clave of Object.keys(o)) if (!permitidas.has(clave)) return null;

  if (typeof o.seed !== 'string' || o.seed.length > MAX_SEED) return null;
  if (typeof o.flip !== 'string' || !FLIPS.includes(o.flip as FlipAvatar)) return null;

  const limpia: Record<string, unknown> = { v: 3, estilo: 'lorelei', seed: o.seed, flip: o.flip };
  for (const p of PARTES_FIJAS) {
    const v = o[p];
    const validos = p === 'mouth' ? bocasPara(owner) : CATALOGO[p];
    if (typeof v !== 'string' || !validos.includes(v)) return null;
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
  const salida: Record<string, unknown> = { v: 3, estilo: 'lorelei', seed: config.seed };
  for (const p of PARTES_FIJAS) salida[p] = config[p];
  for (const p of PARTES_OPCIONALES) salida[p] = config[p] ?? null;
  for (const c of COLORES) salida[c] = config[c];
  salida.flip = config.flip;
  return JSON.stringify(salida);
}

/* ───────────────────────── DiceBear ───────────────────────── */

type Opciones = Record<string, unknown>;

/** Configuración → opciones de `new Avatar(lorelei, …)`. Todo explícito. */
export function opcionesLorelei(config: AvatarConfig): Opciones {
  const op: Opciones = {
    seed: config.seed,
    flip: config.flip,
    hairColor: config.hairColor,
    skinColor: config.skinColor,
    backgroundColor: config.backgroundColor === 'transparent' ? [] : config.backgroundColor,
  };
  for (const p of PARTES_FIJAS) op[`${p}Variant`] = config[p];
  for (const p of PARTES_OPCIONALES) {
    const v = config[p];
    op[`${p}Variant`] = v ?? CATALOGO[p][0];
    op[`${p}Probability`] = v ? 100 : 0;
  }
  return op;
}

const sinNumeral = (c: unknown) => (typeof c === 'string' ? c.replace(/^#/, '').toLowerCase() : undefined);

/**
 * Avatar a partir de una SEMILLA, con el azar propio de DiceBear (incluidas
 * las probabilidades de Lorelei: gafas 10 %, aretes 10 %, barba 5 %…). Lo que
 * DiceBear elige (toJSON().options) se vuelve configuración explícita, así que
 * lo que se ve en el editor es lo que se guarda y lo que sirve el endpoint.
 * En los asistentes la boca sale solo de las sonrientes (happy*).
 */
export function configDesdeSemilla(
  seed: string,
  colores: Partial<Record<ColorAvatar, string>> = {},
  owner: AvatarOwner = 'user'
): AvatarConfig {
  const semilla = seed.slice(0, MAX_SEED);
  const base = { ...COLORES_INICIALES, ...colores };
  const op: Opciones = {
    seed: semilla,
    hairColor: base.hairColor,
    skinColor: base.skinColor,
    backgroundColor: base.backgroundColor === 'transparent' ? [] : base.backgroundColor,
  };
  if (owner === 'agent') op.mouthVariant = [...BOCAS_ASISTENTE];
  const elegidas = new Avatar(lorelei, op).toJSON().options as Record<string, unknown>;

  const config: Record<string, unknown> = { v: 3, estilo: 'lorelei', seed: semilla, flip: 'none', ...base };
  for (const p of PARTES_FIJAS) {
    const v = elegidas[`${p}Variant`];
    const validos = p === 'mouth' ? bocasPara(owner) : CATALOGO[p];
    config[p] = typeof v === 'string' && validos.includes(v) ? v : validos[0];
  }
  for (const p of PARTES_OPCIONALES) {
    const v = elegidas[`${p}Variant`];
    config[p] = typeof v === 'string' && CATALOGO[p].includes(v) ? v : null;
  }
  // DiceBear devuelve los colores como "#rrggbb"; se guardan sin "#".
  for (const c of ['hairColor', 'skinColor'] as const) {
    const v = sinNumeral((elegidas[c] as unknown[] | undefined)?.[0]);
    if (v && HEX.test(v)) config[c] = v;
  }
  return config as unknown as AvatarConfig;
}

/** Semilla aleatoria (no criptográfica: solo elige un dibujo). */
export function semillaAleatoria(): string {
  return Math.random().toString(36).slice(2, 12);
}

/** Avatar aleatorio; conserva los colores que se le pasen (p. ej. los ya elegidos). */
export function randomAvatarConfig(
  colores: Partial<Record<ColorAvatar, string>> = {},
  owner: AvatarOwner = 'user'
): AvatarConfig {
  return configDesdeSemilla(semillaAleatoria(), colores, owner);
}

/**
 * Avatar de un ASISTENTE: Lorelei con la semilla = su nombre (Atlas,
 * Galileo, Kepler…) y solo bocas sonrientes. Siempre el mismo para el mismo
 * nombre; es con el que abre el editor si el asistente aún no tiene avatar.
 */
export function sugerenciaParaAgente(nombre: string): AvatarConfig {
  return configDesdeSemilla(nombre.trim() || 'asistente', {}, 'agent');
}

/**
 * SVG completo del avatar. `size` fija width/height; sin él se estira a su
 * contenedor. `title` lo agrega DiceBear como <title> (escapado).
 */
export function composeAvatarSvg(config: AvatarConfig, opts: { size?: number; title?: string } = {}): string {
  const op = opcionesLorelei(config);
  if (opts.size) op.size = opts.size;
  if (opts.title) op.title = opts.title;
  return new Avatar(lorelei, op).toString();
}

/** data: URI del avatar, para pintarlo con <img src> (nunca SVG en línea). */
export function avatarDataUri(config: AvatarConfig): string {
  return new Avatar(lorelei, opcionesLorelei(config)).toDataUri();
}

/**
 * Recortes (viewBox sobre el lienzo de 980 de Lorelei) para las miniaturas
 * del editor: cada botón muestra solo la zona de su parte.
 */
export const RECORTES: Readonly<Record<CategoriaId, string>> = {
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
  flip: '0 0 980 980',
};

/** Miniatura (data: URI): el avatar actual con UNA opción cambiada, recortado a su zona. */
export function thumbDataUri(config: AvatarConfig, cat: CategoriaId, valor: string | null): string {
  const variante = { ...config, [cat]: valor } as AvatarConfig;
  if (cat !== 'backgroundColor') variante.backgroundColor = 'transparent';
  const svg = composeAvatarSvg(variante).replace(/viewBox="[^"]*"/, `viewBox="${RECORTES[cat]}"`);
  return svgToDataUri(svg);
}

/* ───────────────────────── Editor ───────────────────────── */

export type CategoriaId = ParteFija | ParteOpcional | ColorAvatar | 'flip';

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

const numero = (v: string) => Number(/(\d+)$/.exec(v)?.[1] ?? 0);

const NOMBRES: Record<string, string> = {
  hair: 'Cabello',
  head: 'Cabeza',
  eyes: 'Ojos',
  eyebrows: 'Cejas',
  nose: 'Nariz',
  glasses: 'Gafas',
  beard: 'Barba',
  earrings: 'Aretes',
  freckles: 'Pecas',
};
const FLIP_ETIQUETAS: Record<FlipAvatar, string> = {
  none: 'Sin voltear',
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  both: 'Ambos',
};

/** Nombre visible (español) de un valor de una categoría. */
export function etiquetaOpcion(cat: CategoriaId, valor: string | null): string {
  if (valor === null) return 'Ninguno';
  if (cat === 'flip') return FLIP_ETIQUETAS[valor as FlipAvatar] ?? valor;
  if (cat === 'hairColor' || cat === 'skinColor' || cat === 'backgroundColor') {
    return PALETAS[cat].find((p) => p.color === valor)?.label ?? `#${valor}`;
  }
  if (cat === 'mouth') return `${valor.startsWith('sad') ? 'Seria' : 'Sonrisa'} ${numero(valor)}`;
  if (cat === 'hairAccessories') return 'Flores';
  return `${NOMBRES[cat] ?? cat} ${numero(valor)}`;
}

/**
 * Categorías del editor, en el orden de los círculos: exactamente las
 * opciones de Lorelei — cabello 48, cabeza 4, ojos 24, cejas 13, boca 27
 * (asistentes: solo las 18 sonrientes), nariz 6, gafas, aretes, barba, pecas,
 * flores, colores y flip.
 */
export function categoriasEditor(owner: AvatarOwner = 'user'): readonly CategoriaEditor[] {
  const fija = (id: ParteFija, label: string, title: string): CategoriaEditor => ({
    id,
    label,
    title,
    opciones: id === 'mouth' ? bocasPara(owner) : CATALOGO[id],
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
  return [
    fija('hair', 'Cabello', 'Cabellos'),
    fija('head', 'Cabeza', 'Cabezas'),
    fija('eyes', 'Ojos', 'Ojos'),
    fija('eyebrows', 'Cejas', 'Cejas'),
    fija('mouth', 'Boca', 'Bocas'),
    fija('nose', 'Nariz', 'Narices'),
    opcional('glasses', 'Gafas', 'Gafas'),
    opcional('earrings', 'Aretes', 'Aretes'),
    opcional('beard', 'Barba', 'Barbas'),
    opcional('freckles', 'Pecas', 'Pecas'),
    opcional('hairAccessories', 'Flores', 'Flores en el cabello'),
    color('hairColor', 'Color de cabello', 'Colores de cabello'),
    color('skinColor', 'Color de piel', 'Colores de piel'),
    color('backgroundColor', 'Fondo', 'Fondos'),
    { id: 'flip', label: 'Voltear', title: 'Voltear', opciones: FLIPS, esColor: false },
  ];
}

/** data: URI para usar un SVG en un <img> (sin inyectarlo en el DOM). */
export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export {
  AVATAR_URL_PREFIX,
  agentAvatarNotionUrl,
  isNotionAvatarUrl,
  notionAvatarVersion,
  userAvatarUrl,
} from './urls';
