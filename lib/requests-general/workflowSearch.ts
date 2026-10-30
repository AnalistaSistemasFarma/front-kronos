/**
 * Buscador de texto libre del administrador de flujos: con escribir se filtra por empresa,
 * categoría, proceso, asignado, id o vigencia (ver textSearch.ts).
 */
import { filterByText } from './textSearch';

export { normalizeSearchText } from './textSearch';

export type SearchableWorkflow = {
  id: number | string;
  company?: string | null;
  category?: string | null;
  process?: string | null;
  assigned_process_category?: string | null;
  description?: string | null;
  active?: number | null;
};

export function filterWorkflows<T extends SearchableWorkflow>(list: T[], query: string): T[] {
  return filterByText(list, query, (wf) => [
    wf.id,
    wf.company,
    wf.category,
    wf.process,
    wf.assigned_process_category,
    wf.description,
    Number(wf.active) === 1 ? 'activo' : 'inactivo',
  ]);
}
