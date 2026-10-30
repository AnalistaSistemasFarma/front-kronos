/**
 * Búsqueda de texto libre para los listados (solicitudes, tareas, flujos): sin tildes ni
 * mayúsculas, y cada palabra escrita debe aparecer en alguno de los campos de la fila
 * (p. ej. "gss compras juan").
 */
export function normalizeSearchText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export function searchWords(query: string): string[] {
  return normalizeSearchText(query).split(/\s+/).filter(Boolean);
}

export function filterByText<T>(list: T[], query: string, partsOf: (row: T) => unknown[]): T[] {
  const words = searchWords(query);
  if (words.length === 0) return list;
  return list.filter((row) => {
    const text = normalizeSearchText(partsOf(row).join(' '));
    return words.every((w) => text.includes(w));
  });
}

/**
 * Para buscar en SQL (listados paginados en el servidor): un patrón LIKE por palabra, con
 * los comodines del usuario escapados ([, %, _). Máximo `max` palabras.
 */
export function sqlLikeWords(query: string | null | undefined, max = 6): string[] {
  return String(query ?? '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, max)
    .map((w) => `%${w.slice(0, 80).replace(/[[%_]/g, (c) => `[${c}]`)}%`);
}

/** Campos de una solicitud general en los que busca el buscador de los listados. */
export function requestSearchParts(t: {
  id?: unknown;
  subject?: unknown;
  description?: unknown;
  company?: unknown;
  category?: unknown;
  process?: unknown;
  status?: unknown;
  requester?: unknown;
  user?: unknown;
  executor_final?: unknown;
}): unknown[] {
  return [
    t.id,
    t.subject,
    t.description,
    t.company,
    t.category,
    t.process,
    t.status,
    t.requester,
    t.user,
    t.executor_final,
  ];
}
