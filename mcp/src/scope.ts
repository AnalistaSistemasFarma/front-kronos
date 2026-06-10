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
 * Filtro de empresa efectivo para una consulta.
 *
 * - `applyFilter: false` significa que NO se debe aplicar ningún WHERE de
 *   empresa (alcance admin `"*"` sin un companyId de conveniencia del cliente).
 *   En ese caso `companyIds` es irrelevante.
 * - `applyFilter: true` significa que la consulta debe restringirse a
 *   `companyIds` (que puede quedar vacío -> ninguna fila).
 */
export interface CompanyFilter {
  applyFilter: boolean;
  companyIds: number[];
}

/**
 * Calcula la lista efectiva de empresas a consultar para keys con LISTA cerrada.
 *
 * - Si el cliente no pide ninguna empresa concreta, se usan TODAS las del
 *   alcance de la key.
 * - Si el cliente pide una o varias empresas, se intersecan con el alcance.
 *   Cualquier empresa pedida fuera del alcance se descarta silenciosamente
 *   (no se devuelve error que confirme su existencia).
 * - El resultado nunca puede contener empresas fuera del alcance de la key.
 *
 * NOTA: para keys admin (`allCompanies`) este helper NO debe usarse para abrir
 * el filtro; use `effectiveCompanyFilter`, que decide si aplicar filtro o no.
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

/**
 * Decide el filtro de empresa efectivo respetando la REGLA DE ORO.
 *
 * - Key con LISTA (no admin): siempre se aplica filtro. El servidor interseca
 *   cualquier companyId del cliente con el alcance; nunca lo amplía. Una key
 *   con lista `[1]` que pida `2` sigue dando cero filas.
 * - Key admin (`allCompanies`): ve TODO.
 *   - Sin companyId del cliente -> sin filtro (`applyFilter: false`).
 *   - Con companyId(s) del cliente -> se aplica como filtro de CONVENIENCIA
 *     (acotar lo que ya puede ver). No hay nada que ampliar para un admin.
 */
export function effectiveCompanyFilter(
  scope: AuthScope,
  requested?: number | number[] | null
): CompanyFilter {
  if (scope.allCompanies) {
    if (requested === undefined || requested === null) {
      return { applyFilter: false, companyIds: [] };
    }
    const requestedList = Array.isArray(requested) ? requested : [requested];
    // Conveniencia: el admin acota a las empresas pedidas (deduplicadas).
    return { applyFilter: true, companyIds: [...new Set(requestedList)] };
  }

  return { applyFilter: true, companyIds: effectiveCompanyIds(scope, requested) };
}
