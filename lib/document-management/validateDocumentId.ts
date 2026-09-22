/**
 * Parseo del parámetro de ruta `[id]` de
 * app/(hub)/process/document-management/[id]/page.tsx.
 *
 * Bug de producción (2026-09-03): cuando el `id` de la URL no era numérico
 * (enlace roto, copiado a mano, etc.), la pantalla de detalle se quedaba
 * cargando indefinidamente -- el `loading` nunca pasaba a `false` porque el
 * guard original (`!idDocument || Number.isNaN(idDocument)`) vivía inline
 * dentro del `useCallback` y no se ejecutaba de forma confiable antes del
 * primer render. Se extrae aquí como función PURA para poder probarla sin
 * levantar React/jsdom (que este proyecto no tiene configurado en Vitest).
 *
 * Devuelve el id numérico válido, o `null` si el parámetro está ausente, es
 * `0`/vacío o no es un número (mismo criterio que el guard original:
 * `!value || Number.isNaN(value)`).
 */
export function parseDocumentIdParam(rawId: string | undefined | null): number | null {
  if (!rawId) return null;
  const value = Number(rawId);
  if (!value || Number.isNaN(value)) return null;
  return value;
}
