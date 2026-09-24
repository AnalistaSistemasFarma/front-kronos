/** Campaña — Dosis de Amor y Amistad (un tablero por empresa). */

/** Subproceso de permiso (no es tarjeta del hub). Asignar en Admin → Usuarios por empresa. */
export const VALENTINE_WALL_ACCESS_URL = '/process/valentine-wall';
export const VALENTINE_WALL_ACCESS_NAME = 'Dosis de Amor y Amistad';

export const VALENTINE_TO_NAME_MAX = 80;

export function isValentineWallSubprocess(subprocess: {
  subprocess?: string | null;
  subprocess_url?: string | null;
}): boolean {
  const url = String(subprocess.subprocess_url || '')
    .toLowerCase()
    .trim();
  if (url === VALENTINE_WALL_ACCESS_URL.toLowerCase() || url.includes('/valentine-wall')) {
    return true;
  }
  const name = String(subprocess.subprocess || '')
    .toLowerCase()
    .trim();
  return name === VALENTINE_WALL_ACCESS_NAME.toLowerCase() || name.includes('dosis de amor');
}

export const VALENTINE_MESSAGE_MAX = 160;

export const VALENTINE_REACTIONS = ['❤️', '💕', '🥰', '✨', '👏'] as const;
export type ValentineReactionEmoji = (typeof VALENTINE_REACTIONS)[number];

export const VALENTINE_CATEGORIES = [
  {
    id: 'vial_gratitud',
    label: 'Vial de Gratitud',
    hint: 'Reconoce, agradece y valora a quienes hacen la diferencia',
    emoji: '💊',
  },
  {
    id: 'analiza_une',
    label: 'Analiza lo que nos une',
    hint: 'Lo que compartimos en el equipo',
    emoji: '🧪',
  },
  {
    id: 'dosis_compartir',
    label: 'Una dosis para compartir',
    hint: 'Un detalle corto para alguien',
    emoji: '💉',
  },
  {
    id: 'nutre_amistad',
    label: 'Nutre tu amistad',
    hint: 'Cultiva el buen rollo',
    emoji: '🥫',
  },
  {
    id: 'calibra_amistad',
    label: 'Calibra tu amistad',
    hint: 'Ajusta el termómetro del cariño',
    emoji: '⏱️',
  },
  {
    id: 'ampolleta',
    label: 'Ampolleta de amistad',
    hint: 'Una dosis concentrada de aprecio',
    emoji: '🔬',
  },
  {
    id: 'ideas_conectan',
    label: 'Ideas que conectan',
    hint: 'Una idea o deseo para el equipo',
    emoji: '💡',
  },
] as const;

export type ValentineCategoryId = (typeof VALENTINE_CATEGORIES)[number]['id'];

export const VALENTINE_TAGLINE =
  'Una pequeña palabra puede convertirse en una gran dosis de esperanza. ¡Escribe desde el corazón y pon tu mejor esfuerzo para hacer sonreír a alguien!';

/**
 * Temporada de la campaña.
 * - Febrero siempre activo
 * - O `NEXT_PUBLIC_VALENTINE_WALL_FORCE=1` (útil fuera de temporada)
 */
export function isValentineWallSeason(now = new Date()): boolean {
  if (process.env.NEXT_PUBLIC_VALENTINE_WALL_FORCE === '1') return true;
  if (process.env.NEXT_PUBLIC_VALENTINE_WALL_FORCE === '0') return false;
  return now.getMonth() === 1; // febrero
}
