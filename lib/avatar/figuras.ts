import type { AvatarConfig } from './types';

/**
 * FIGURAS v4 (LEGADO, #554): antes un asistente podía tener una "figura" con
 * su propio dibujo y carita (config `{ v: 4, kind, variante, cara, extra,
 * relleno, acento, fondo }`). Ahora las figuras son CABEZAS de Lorelei
 * (cabezas.ts), compatibles con ojos, boca, gafas, pelo, etc., y el editor ya
 * no ofrece v4.
 *
 * Lo que quede guardado en v4 NO se borra: se sigue validando con las reglas
 * de entonces y se CONVIERTE al leerlo (`figuraV4ACabeza`) en una config v3
 * con la cabeza-figura equivalente ('figura:<variante>'), sin pelo, una cara
 * de Lorelei parecida a la carita elegida y los mismos colores (relleno →
 * piel, acento → cabello, fondo → fondo). Al guardarla de nuevo desde el
 * editor queda en el formato nuevo.
 */

export type FiguraKind = 'animal' | 'planeta' | 'constelacion' | 'estrella' | 'robot';

/** Lo que guardaba el #554 en dbo.avatar_config.config_json (versión 4). */
export interface FiguraConfig {
  v: 4;
  kind: FiguraKind;
  variante: string;
  cara: string;
  extra: string | null;
  relleno: string;
  acento: string;
  fondo: string;
}

const CARAS = ['feliz', 'alegre', 'tranquilo', 'tierno', 'guino', 'curioso', 'picaro', 'gatuno'] as const;
const CARAS_O_NINGUNA = [...CARAS, 'ninguna'];

/** Catálogo v4 tal como lo validaba el #554 (variantes, caritas y accesorios de cada tipo). */
const KINDS_V4: Readonly<Record<FiguraKind, { variantes: readonly string[]; caras: readonly string[]; extras: readonly string[] }>> = {
  animal: {
    variantes: ['gato', 'perro', 'zorro', 'buho', 'oso', 'conejo', 'panda', 'leon', 'pinguino', 'koala', 'mono', 'pulpo'],
    caras: CARAS,
    extras: ['gafas', 'gafas-sol', 'audifonos', 'sombrero', 'gorra', 'flor'],
  },
  planeta: {
    variantes: ['mercurio', 'venus', 'tierra', 'marte', 'jupiter', 'saturno', 'urano', 'neptuno', 'pluton', 'luna'],
    caras: CARAS_O_NINGUNA,
    extras: ['luna', 'lunas', 'anillo', 'chispas', 'cohete', 'gafas-sol'],
  },
  constelacion: {
    variantes: [
      'orion', 'osa-mayor', 'casiopea', 'escorpio', 'lira', 'can-mayor', 'cruz-del-sur', 'leo', 'cisne', 'osa-menor', 'pleyades', 'geminis',
    ],
    caras: CARAS_O_NINGUNA,
    extras: ['chispas-cielo', 'luna-cielo'],
  },
  estrella: { variantes: ['sol', 'estrella', 'destello', 'luna-creciente', 'cometa'], caras: CARAS, extras: ['chispas', 'gafas-sol', 'gorro-fiesta'] },
  robot: { variantes: ['clasico', 'pantalla', 'redondo', 'cubo'], caras: CARAS, extras: ['chispas', 'gafas-sol', 'gorro-fiesta'] },
};

const esKind = (k: unknown): k is FiguraKind => typeof k === 'string' && Object.prototype.hasOwnProperty.call(KINDS_V4, k);
const HEX = /^[0-9a-f]{6}$/;
const CLAVES = new Set(['v', 'kind', 'variante', 'cara', 'extra', 'relleno', 'acento', 'fondo']);

/** Valida una figura v4 (ya como objeto) con las reglas del #554. Copia limpia o null. */
export function parseFiguraConfig(valor: unknown): FiguraConfig | null {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null;
  const o = valor as Record<string, unknown>;
  if (o.v !== 4 || !esKind(o.kind)) return null;
  for (const clave of Object.keys(o)) if (!CLAVES.has(clave)) return null;
  const def = KINDS_V4[o.kind];
  if (typeof o.variante !== 'string' || !def.variantes.includes(o.variante)) return null;
  if (typeof o.cara !== 'string' || !def.caras.includes(o.cara)) return null;
  const extra = o.extra ?? null;
  if (extra !== null && (typeof extra !== 'string' || !def.extras.includes(extra))) return null;
  for (const c of ['relleno', 'acento', 'fondo'] as const) {
    const v = o[c];
    if (typeof v !== 'string' || !(HEX.test(v) || (c === 'fondo' && v === 'transparent'))) return null;
  }
  return {
    v: 4,
    kind: o.kind,
    variante: o.variante,
    cara: o.cara,
    extra: extra as string | null,
    relleno: o.relleno as string,
    acento: o.acento as string,
    fondo: o.fondo as string,
  };
}

/** Carita v4 → ojos y boca (sonriente) de Lorelei más parecidos. */
const CARA_A_LORELEI: Readonly<Record<string, { eyes: string; mouth: string }>> = {
  feliz: { eyes: 'variant13', mouth: 'happy01' },
  alegre: { eyes: 'variant15', mouth: 'happy05' },
  tranquilo: { eyes: 'variant01', mouth: 'happy13' },
  tierno: { eyes: 'variant16', mouth: 'happy11' },
  guino: { eyes: 'variant19', mouth: 'happy02' },
  curioso: { eyes: 'variant09', mouth: 'happy11' },
  picaro: { eyes: 'variant03', mouth: 'happy10' },
  gatuno: { eyes: 'variant22', mouth: 'happy04' },
};

/**
 * Figura v4 → config v3 con la cabeza-figura equivalente. El resultado se
 * vuelve a validar (parseAvatarConfig 'agent') en agente.ts.
 */
export function figuraV4ACabeza(c: FiguraConfig): AvatarConfig {
  const cara = CARA_A_LORELEI[c.cara] ?? CARA_A_LORELEI.feliz;
  return {
    v: 3,
    estilo: 'lorelei',
    seed: 'figura',
    hair: null,
    head: `figura:${c.variante}`,
    eyes: cara.eyes,
    eyebrows: 'variant05',
    mouth: cara.mouth,
    nose: 'variant01',
    glasses: c.extra === 'gafas' ? 'variant01' : c.extra === 'gafas-sol' ? 'variant02' : null,
    earrings: null,
    beard: null,
    freckles: null,
    hairAccessories: c.extra === 'flor' ? 'flowers' : null,
    hairColor: c.acento,
    skinColor: c.relleno,
    backgroundColor: c.fondo,
    flip: false,
  };
}
