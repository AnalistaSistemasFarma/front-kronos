/** Desde este brillo (0–255, canal más oscuro del pixel) el pixel es fondo y queda transparente. */
export const SEAL_BACKGROUND_FROM = 236;
/** Entre este brillo y SEAL_BACKGROUND_FROM el borde se desvanece para que no quede serrucho. */
export const SEAL_FADE_FROM = 200;

/**
 * Alfa de un pixel del sello según qué tan blanco es: el papel blanco o casi blanco desaparece
 * y la tinta (de cualquier color) se conserva.
 */
export function sealPixelAlpha(r: number, g: number, b: number, a: number): number {
  const lightest = Math.min(r, g, b);
  if (lightest >= SEAL_BACKGROUND_FROM) return 0;
  if (lightest <= SEAL_FADE_FROM) return a;
  return Math.round((a * (SEAL_BACKGROUND_FROM - lightest)) / (SEAL_BACKGROUND_FROM - SEAL_FADE_FROM));
}
