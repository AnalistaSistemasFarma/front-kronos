/**
 * Enforcement de alcance por empresa.
 *
 * Regla de oro: el filtro de empresa del SERVIDOR (derivado de la API key)
 * manda sobre cualquier parámetro que envíe el cliente. Un agente con alcance
 * a la empresa A NUNCA puede ver datos de la empresa B, ni siquiera pasando
 * `companyId: B` en la tool.
 */
import type { AuthScope } from './auth.js';

/**
 * Calcula la lista efectiva de empresas a consultar.
 *
 * - Si el cliente no pide ninguna empresa concreta, se usan TODAS las del
 *   alcance de la key.
 * - Si el cliente pide una o varias empresas, se intersecan con el alcance.
 *   Cualquier empresa pedida fuera del alcance se descarta silenciosamente
 *   (no se devuelve error que confirme su existencia).
 * - El resultado nunca puede contener empresas fuera del alcance de la key.
 */
export function effectiveCompanyIds(
  scope: AuthScope,
  requested?: number | number[] | null
): number[] {
  const allowed = new Set(scope.companyIds);

  if (requested === undefined || requested === null) {
    return [...allowed];
  }

  const requestedList = Array.isArray(requested) ? requested : [requested];
  const intersection = requestedList.filter((id) => allowed.has(id));

  // Si la intersección queda vacía (el cliente solo pidió empresas fuera de
  // su alcance), devolvemos una lista vacía -> ninguna fila. Nunca caemos de
  // vuelta al alcance completo, para que un companyId no permitido no termine
  // ampliando el resultado.
  return [...new Set(intersection)];
}
