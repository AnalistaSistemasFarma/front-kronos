import { createAvatar } from '@dicebear/core';
import * as lorelei from '@dicebear/lorelei';
import { VALORES_CABEZA_FIGURA, esCabezaFigura, etiquetaCabezaFigura, figuraLlevaPelo, loreleiCabezas } from './cabezas';
import type { AvatarConfig, AvatarOwner, ColorAvatar, ParteFija, ParteOpcional } from './types';

/**
 * Avatar estilo Notion con DiceBear 9 + Lorelei.
 *
 * - @dicebear/core 9.4.3 y @dicebear/lorelei 9.4.3 (código MIT; diseño
 *   "Lorelei" de Lisa Wischofsky, CC0 1.0). Versión 9 a propósito: la 10
 *   exige Node 22 y los servidores (.230 y serfarma05) corren Node 20. El SVG
 *   lleva la atribución en su <metadata>.
 * - Código PURO (sin React ni base de datos): lo usan igual el editor del
 *   navegador (vista previa, como <img src="data:…">) y los endpoints
 *   /api/avatar/... (imagen servida), y se prueba con Vitest.
 * - El catálogo (variantes de cada parte) se lee del ESQUEMA de la versión
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
export const PARTES_OPCIONALES: readonly ParteOpcional[] = ['glasses', 'earrings', 'beard', 'freckles', 'hairAccessories'];
export const COLORES: readonly ColorAvatar[] = ['hairColor', 'skinColor', 'backgroundColor'];
/** Valores del selector "Voltear" del editor (en DiceBear 9 `flip` es un booleano). */
export const FLIP_OPCIONES = ['normal', 'volteado'] as const;

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
 * Cabezas de los asistentes: las 4 de Lorelei y, DESPUÉS, las cabezas-figura
 * (animales, planetas, constelaciones, estrellas, robots: cabezas.ts).
 */
export const CABEZAS_ASISTENTE: readonly string[] = [...CATALOGO.head, ...VALORES_CABEZA_FIGURA];

/** Cabezas válidas según el dueño del avatar (las personas: solo las de Lorelei). */
export function cabezasPara(owner: AvatarOwner): readonly string[] {
  return owner === 'agent' ? CABEZAS_ASISTENTE : CATALOGO.head;
}

export { esCabezaFigura };

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
 *   - en los asistentes (owner 'agent'), la boca debe ser happy*; además
 *     pueden tener una cabeza-figura ('figura:<id>') y, solo con ella, pelo
 *     null ("Ninguno"). Las personas no aceptan ninguna de las dos cosas;
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
  if (typeof o.flip !== 'boolean') return null;

  const limpia: Record<string, unknown> = { v: 3, estilo: 'lorelei', seed: o.seed, flip: o.flip };
  const conFigura = owner === 'agent' && esCabezaFigura(o.head);
  for (const p of PARTES_FIJAS) {
    const v = o[p];
    if (p === 'hair' && v === null && conFigura) {
      limpia[p] = null;
      continue;
    }
    const validos = p === 'mouth' ? bocasPara(owner) : p === 'head' ? cabezasPara(owner) : CATALOGO[p];
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

/**
 * Configuración → opciones de `createAvatar(lorelei, …)`. Todo explícito.
 * Sin pelo (solo cabezas-figura): `hair: []`.
 */
export function opcionesLorelei(config: AvatarConfig): Opciones {
  const op: Opciones = {
    seed: config.seed,
    flip: config.flip,
    hairColor: [config.hairColor],
    skinColor: [config.skinColor],
    backgroundColor: [config.backgroundColor],
  };
  for (const p of PARTES_FIJAS) op[p] = config[p] === null ? [] : [config[p]];
  for (const p of PARTES_OPCIONALES) {
    const v = config[p];
    op[p] = [v ?? CATALOGO[p][0]];
    op[`${p}Probability`] = v ? 100 : 0;
  }
  return op;
}

const sinNumeral = (c: unknown) => (typeof c === 'string' ? c.replace(/^#/, '').toLowerCase() : undefined);

/**
 * Avatar a partir de una SEMILLA, con el azar propio de DiceBear (incluidas
 * las probabilidades de Lorelei: gafas 10 %, aretes 10 %, barba 5 %…). Lo que
 * DiceBear elige (toJson().extra) se vuelve configuración explícita, así que
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
    hairColor: [base.hairColor],
    skinColor: [base.skinColor],
    backgroundColor: [base.backgroundColor],
  };
  if (owner === 'agent') op.mouth = [...BOCAS_ASISTENTE];
  const elegidas = createAvatar(lorelei, op).toJson().extra as Record<string, unknown>;

  const config: Record<string, unknown> = { v: 3, estilo: 'lorelei', seed: semilla, flip: false, ...base };
  for (const p of PARTES_FIJAS) {
    const v = elegidas[p];
    const validos = p === 'mouth' ? bocasPara(owner) : CATALOGO[p];
    config[p] = typeof v === 'string' && validos.includes(v) ? v : validos[0];
  }
  for (const p of PARTES_OPCIONALES) {
    const v = elegidas[p];
    config[p] = typeof v === 'string' && CATALOGO[p].includes(v) ? v : null;
  }
  // DiceBear devuelve los colores como "#rrggbb"; se guardan sin "#".
  for (const c of ['hairColor', 'skinColor'] as const) {
    const v = sinNumeral(elegidas[c]);
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
 * Style de DiceBear para una configuración: Lorelei tal cual (Cabeza 1…4,
 * byte a byte como siempre) o Lorelei con cabeza-figura (cabezas.ts).
 */
function estiloPara(config: AvatarConfig): typeof lorelei {
  return esCabezaFigura(config.head) ? (loreleiCabezas as typeof lorelei) : lorelei;
}

/**
 * SVG completo del avatar. `size` fija width/height; sin él se estira a su
 * contenedor. `title` agrega <title> (escapado) para accesibilidad.
 */
export function composeAvatarSvg(config: AvatarConfig, opts: { size?: number; title?: string } = {}): string {
  const op = opcionesLorelei(config);
  if (opts.size) op.size = opts.size;
  const svg = createAvatar(estiloPara(config), op).toString();
  if (!opts.title) return svg;
  return svg.replace(/^<svg([^>]*)>/, (m) => `${m}<title>${escapeXml(opts.title as string)}</title>`);
}

/** data: URI del avatar, para pintarlo con <img src> (nunca SVG en línea). */
export function avatarDataUri(config: AvatarConfig): string {
  return createAvatar(estiloPara(config), opcionesLorelei(config)).toDataUri();
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

/** Recorte de la miniatura de una cabeza-figura: la figura entera (orejas, anillos, alas…). */
const RECORTE_FIGURA = '40 20 900 900';

/** Miniatura (data: URI): el avatar actual con UNA opción cambiada, recortado a su zona. */
export function thumbDataUri(config: AvatarConfig, cat: CategoriaId, valor: string | null): string {
  const variante = conValor(config, cat, valor);
  if (cat !== 'backgroundColor') variante.backgroundColor = 'transparent';
  const recorte = cat === 'head' && esCabezaFigura(valor) ? RECORTE_FIGURA : RECORTES[cat];
  const svg = composeAvatarSvg(variante).replace(/viewBox="[^"]*"/, `viewBox="${recorte}"`);
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
const FLIP_ETIQUETAS: Record<(typeof FLIP_OPCIONES)[number], string> = {
  normal: 'Sin voltear',
  volteado: 'Volteado',
};

/** Valor que muestra el editor para una categoría (`flip` se ve como 'normal' / 'volteado'). */
export function valorCategoria(config: AvatarConfig, cat: CategoriaId): string | null {
  if (cat === 'flip') return config.flip ? 'volteado' : 'normal';
  return config[cat] ?? null;
}

/**
 * Copia de la configuración con UNA categoría cambiada al valor elegido en el editor.
 *
 * Cabezas de los asistentes: al pasar a una cabeza-figura en la que el pelo no
 * tiene sentido (casi todas), el pelo queda en "Ninguno" (se puede volver a
 * poner); al volver a una cabeza de Lorelei sin pelo, se le pone el pelo que
 * sale de su semilla (el nombre del asistente), porque una persona siempre
 * lleva pelo.
 */
export function conValor(config: AvatarConfig, cat: CategoriaId, valor: string | null): AvatarConfig {
  if (cat === 'flip') return { ...config, flip: valor === 'volteado' };
  if (cat === 'head' && typeof valor === 'string') {
    if (esCabezaFigura(valor)) return { ...config, head: valor, hair: figuraLlevaPelo(valor) ? config.hair : null };
    if (config.hair === null) return { ...config, head: valor, hair: peloDeRespaldo(config.seed) };
  }
  return { ...config, [cat]: valor } as AvatarConfig;
}

/** Pelo de Lorelei para una semilla (determinista): el que DiceBear le daría a ese nombre. */
function peloDeRespaldo(seed: string): string {
  return configDesdeSemilla(seed || 'asistente', {}, 'agent').hair ?? CATALOGO.hair[0];
}

/** Nombre visible (español) de un valor de una categoría. */
export function etiquetaOpcion(cat: CategoriaId, valor: string | null): string {
  if (valor === null) return 'Ninguno';
  if (cat === 'flip') return FLIP_ETIQUETAS[valor as (typeof FLIP_OPCIONES)[number]] ?? valor;
  if (cat === 'hairColor' || cat === 'skinColor' || cat === 'backgroundColor') {
    return PALETAS[cat].find((p) => p.color === valor)?.label ?? `#${valor}`;
  }
  if (cat === 'mouth') return `${valor.startsWith('sad') ? 'Seria' : 'Sonrisa'} ${numero(valor)}`;
  if (cat === 'head' && esCabezaFigura(valor)) return etiquetaCabezaFigura(valor) ?? valor;
  if (cat === 'hairAccessories') return 'Flores';
  return `${NOMBRES[cat] ?? cat} ${numero(valor)}`;
}

/**
 * Categorías del editor, en el orden de los círculos: exactamente las
 * opciones de Lorelei — cabello 48, cabeza 4, ojos 24, cejas 13, boca 27
 * (asistentes: solo las 18 sonrientes), nariz 6, gafas, aretes, barba, pecas,
 * flores, colores y flip. Los asistentes tienen además las cabezas-figura
 * después de Cabeza 1…4 y, con una de ellas puesta, "Ninguno" en el cabello.
 */
export function categoriasEditor(owner: AvatarOwner = 'user', conCabezaFigura = false): readonly CategoriaEditor[] {
  const sinPelo = owner === 'agent' && conCabezaFigura;
  const opcionesFija = (id: ParteFija): ReadonlyArray<string | null> => {
    if (id === 'mouth') return bocasPara(owner);
    if (id === 'head') return cabezasPara(owner);
    if (id === 'hair' && sinPelo) return [null, ...CATALOGO.hair];
    return CATALOGO[id];
  };
  const fija = (id: ParteFija, label: string, title: string): CategoriaEditor => ({
    id,
    label,
    title,
    opciones: opcionesFija(id),
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
    { id: 'flip', label: 'Voltear', title: 'Voltear', opciones: FLIP_OPCIONES, esColor: false },
  ];
}

/** data: URI para usar un SVG en un <img> (sin inyectarlo en el DOM). */
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
