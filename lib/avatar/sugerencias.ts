import type { AvatarConfig, AvatarKind } from './types';

/**
 * Avatar SUGERIDO para un asistente según su nombre: el que abre el editor
 * cuando el asistente aún no tiene avatar. Solo es un punto de partida; la
 * persona lo cambia como quiera.
 *
 * Los asistentes de OLP llevan nombres de astros y astrónomos, así que cada
 * uno arranca con lo suyo: Orión con su constelación, Vega con la Lira,
 * Sirio con el Can Mayor, Atlas con las Pléyades (Atlas es una de ellas),
 * Mercurio con su planeta, Galileo con Júpiter (descubrió sus lunas) y
 * Kepler con Marte (de su órbita sacó sus leyes).
 *
 * Los índices son los del catálogo (parts-planeta.ts, parts-constelacion.ts).
 */
const SUGERENCIAS: Record<string, { tipo: AvatarKind; partes: Record<string, number> }> = {
  orion: { tipo: 'constelacion', partes: { constelacion: 0, estrella: 2, marco: 1, cielo: 1 } },
  vega: { tipo: 'constelacion', partes: { constelacion: 4, estrella: 0, marco: 1, cielo: 2 } },
  sirio: { tipo: 'constelacion', partes: { constelacion: 5, estrella: 3, marco: 0, cielo: 1 } },
  atlas: { tipo: 'constelacion', partes: { constelacion: 10, estrella: 2, marco: 1, cielo: 1 } },
  mercurio: { tipo: 'planeta', partes: { planeta: 0, carita: 0, ojos: 0, cejas: 3, boca: 10, decorado: 1 } },
  galileo: { tipo: 'planeta', partes: { planeta: 4, carita: 0, ojos: 6, cejas: 0, boca: 13, accesorios: 2, decorado: 2 } },
  kepler: { tipo: 'planeta', partes: { planeta: 3, carita: 0, ojos: 2, cejas: 5, boca: 11, decorado: 1 } },
};

const normalizar = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** Configuración sugerida (sin validar) o null si el nombre no tiene sugerencia. */
export function sugerenciaCruda(nombre: string): Omit<AvatarConfig, 'fondo'> | null {
  const s = SUGERENCIAS[normalizar(nombre).split(/\s+/)[0] ?? ''];
  return s ? { v: 1, tipo: s.tipo, partes: { ...s.partes } } : null;
}
