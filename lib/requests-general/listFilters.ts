import { normalizeSearchText } from './textSearch';

/**
 * Filtros de los listados de solicitudes (Mis solicitudes, Asignadas y Observar), iguales en
 * las pantallas. Todo se filtra en el navegador sobre la lista COMPLETA ya cargada (no por
 * página), y el estado es GENERAL: "Pendientes" trae solicitudes y tareas abiertas o sin
 * empezar, sin importar el tipo; las devueltas (estado 7) van aparte en "Devueltas".
 */

export type StatusGroup = 'all' | 'pending' | 'returned' | 'done' | 'cancelled';

export const STATUS_GROUP_OPTIONS: { value: StatusGroup; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'returned', label: 'Devueltas' },
  { value: 'done', label: 'Completadas' },
  { value: 'cancelled', label: 'Canceladas' },
];

export const STATUS_GROUP_LABEL: Record<StatusGroup, string> = {
  all: 'Todos',
  pending: 'Pendientes',
  returned: 'Devueltas',
  done: 'Completadas',
  cancelled: 'Canceladas',
};

/**
 * Grupo general de un estado (status_case): 2 Resuelto → completada; 3 Cancelado → cancelada;
 */
export function statusGroupOf(
  statusId: number | string | null | undefined,
  statusName?: string | null
): Exclude<StatusGroup, 'all'> {
  const id = Number(statusId);
  if (id === 2) return 'done';
  if (id === 3) return 'cancelled';
  if (id === 7) return 'returned';
  if (id === 1 || id === 4) return 'pending';
  const name = normalizeSearchText(statusName);
  if (name.includes('cancel')) return 'cancelled';
  if (name.includes('devuelt')) return 'returned';
  if (['resuelt', 'complet', 'cerrad', 'finaliz'].some((w) => name.includes(w))) return 'done';
  return 'pending';
}

/**
 * Estado EXACTO (status_case), el filtro «Estado» que había antes del panel nuevo: refina el
 */
export const REQUEST_STATE_OPTIONS: Option[] = [
  { value: '1', label: 'Abierto' },
  { value: '3', label: 'Cancelado' },
  { value: '2', label: 'Resuelto' },
  { value: '7', label: 'Devuelta' },
];

/** Asignadas mezcla solicitudes y tareas: «Sin empezar» solo existe en tareas y «Devuelta» en solicitudes. */
export const ASSIGNED_STATE_OPTIONS: Option[] = [
  { value: '4', label: 'Sin empezar (solo tareas)' },
  { value: '1', label: 'Abierto' },
  { value: '3', label: 'Cancelado' },
  { value: '2', label: 'Resuelto' },
  { value: '7', label: 'Devuelta (solo solicitudes)' },
];

/** Grupo general (tarjeta) al que pertenece un estado exacto. */
export function stateGroup(state: string): Exclude<StatusGroup, 'all'> {
  return statusGroupOf(Number(state));
}

export type ListFilters = {
  id: string;
  status: StatusGroup;
  /** Estado exacto (id de status_case); '' = cualquiera. */
  state: string;
  /** Categoría (nombre); solo en las pantallas que la muestran. */
  category: string;
  company: string;
  process: string;
  person: string;
  date_from: string;
  date_to: string;
};

export const EMPTY_LIST_FILTERS: ListFilters = {
  id: '',
  status: 'all',
  state: '',
  category: '',
  company: '',
  process: '',
  person: '',
  date_from: '',
  date_to: '',
};

/** Lo que cada pantalla le entrega al filtro por fila (solicitud o tarea). */
export type ListRow = {
  /** ID de la solicitud (en una tarea, el de su solicitud). */
  requestId: number | string;
  group: Exclude<StatusGroup, 'all'>;
  /** Id de status_case de la fila (estado exacto). */
  statusId?: number | string | null;
  /** Categoría de la solicitud. */
  category?: string | null;
  companyId: string;
  company: string;
  process: string;
  people: string[];
  createdAt: string | null | undefined;
};

/** "Ana, Luis" → ['Ana', 'Luis'] (sin vacíos ni repetidos). */
export function splitPeople(...values: Array<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const value of values) {
    for (const name of String(value ?? '').split(',')) {
      const clean = name.trim();
      if (clean) out.add(clean);
    }
  }
  return [...out];
}

/**
 * Día (AAAA-MM-DD) tal como lo muestra la tabla: la base guarda hora local y el texto que
 * llega ya trae ese día al inicio, así que se compara sin pasar por zonas horarias.
 */
export function dateKey(value: string | null | undefined): string {
  const s = String(value ?? '');
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

/** `ignoreStatus`: para contar las tarjetas (no cambian al tocar un estado). */
export function matchesListFilters(
  row: ListRow,
  filters: ListFilters,
  { ignoreStatus = false }: { ignoreStatus?: boolean } = {}
): boolean {
  const id = filters.id.trim().replace(/^#/, '');
  if (id && String(row.requestId) !== id) return false;
  if (!ignoreStatus && filters.status !== 'all' && row.group !== filters.status) return false;
  if (!ignoreStatus && filters.state && String(row.statusId ?? '') !== filters.state) return false;
  if (filters.category && (row.category ?? '') !== filters.category) return false;
  if (filters.company && row.companyId !== filters.company) return false;
  if (filters.process && row.process !== filters.process) return false;
  if (filters.person && !row.people.includes(filters.person)) return false;
  if (filters.date_from || filters.date_to) {
    // Si escriben las fechas al revés, se toman en el orden correcto.
    let [from, to] = [filters.date_from, filters.date_to];
    if (from && to && from > to) [from, to] = [to, from];
    const day = dateKey(row.createdAt);
    if (!day) return false;
    if (from && day < from) return false;
    if (to && day > to) return false; // "Hasta" incluye todo ese día.
  }
  return true;
}

export type StatusCounts = Record<StatusGroup, number>;

export function countByStatusGroup(rows: Array<Pick<ListRow, 'group'>>): StatusCounts {
  const counts: StatusCounts = { all: rows.length, pending: 0, returned: 0, done: 0, cancelled: 0 };
  for (const row of rows) counts[row.group] += 1;
  return counts;
}

export type Option = { value: string; label: string };
export type ListOptions = {
  companies: Option[];
  processes: Option[];
  people: Option[];
  /** Si viene, el panel muestra «Categoría». */
  categories?: Option[];
  /** Si viene, el panel muestra «Estado» (estado exacto). */
  states?: Option[];
};

const byLabel = (a: Option, b: Option) => a.label.localeCompare(b.label, 'es');

/** Opciones de los filtros sacadas de los mismos datos: nunca sale una opción sin resultados. */
export function buildListOptions(rows: ListRow[]): ListOptions {
  const companies = new Map<string, string>();
  const processes = new Set<string>();
  const people = new Set<string>();
  for (const row of rows) {
    if (row.companyId && row.company) companies.set(row.companyId, row.company);
    if (row.process) processes.add(row.process);
    for (const p of row.people) people.add(p);
  }
  return {
    companies: [...companies].map(([value, label]) => ({ value, label })).sort(byLabel),
    processes: [...processes].map((p) => ({ value: p, label: p })).sort(byLabel),
    people: [...people].map((p) => ({ value: p, label: p })).sort(byLabel),
  };
}

/** Cuántos filtros del panel están puestos (el estado general se maneja con las tarjetas). */
export function activeFilterCount(filters: ListFilters): number {
  return (
    ['id', 'state', 'category', 'company', 'process', 'person', 'date_from', 'date_to'] as const
  ).filter((k) => filters[k].trim()).length;
}

/** Resumen para la hoja de filtros del Excel. */
export function describeListFilters(filters: ListFilters, options: ListOptions): { label: string; value: string }[] {
  const companyLabel = options.companies.find((c) => c.value === filters.company)?.label;
  const stateLabel = options.states?.find((s) => s.value === filters.state)?.label;
  return [
    { label: 'Estado', value: STATUS_GROUP_LABEL[filters.status] },
    ...(options.states ? [{ label: 'Estado exacto', value: stateLabel || 'Todos' }] : []),
    ...(options.categories ? [{ label: 'Categoría', value: filters.category || 'Todas' }] : []),
    { label: 'Empresa', value: companyLabel || 'Todas' },
    { label: 'Proceso', value: filters.process || 'Todos' },
    { label: 'Persona asignada', value: filters.person || 'Todas' },
    { label: 'ID', value: filters.id.trim() || 'Todos' },
    { label: 'Fecha desde', value: filters.date_from || 'Sin límite' },
    { label: 'Fecha hasta', value: filters.date_to || 'Sin límite' },
  ];
}
