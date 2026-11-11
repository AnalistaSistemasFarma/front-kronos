import { EMPTY_LIST_FILTERS, type ListFilters, type StatusGroup } from './listFilters';

/**
 * «Anterior / Siguiente» en el detalle de solicitudes y tareas, igual que en Tickets
 * (lib/help-desk/ticketsBoardStorage.ts): al abrir un elemento, la lista guarda en
 * sessionStorage el orden EXACTO que el usuario tenía en pantalla (mismos filtros, orden y
 * pestaña); el detalle lo lee para mostrar «3 de 25» y moverse entre elementos.
 *
 * Además cada lista guarda sus filtros (tarjeta, estado, empresa, proceso, persona, categoría,
 * fechas, búsqueda, pestaña, «Todo lo abierto», página y scroll) para que al volver por el
 * breadcrumb no se borren. sessionStorage y no la URL: es el patrón de Tickets y la pestaña que
 * abre el detalle (window.open) recibe una copia, así que el breadcrumb de esa pestaña vuelve
 * con los filtros intactos.
 */

export type RequestListOrigin = 'create-request' | 'assigned-requests' | 'viewer-request';

export type NavItemKind = 'request' | 'task';
export type NavItem = { kind: NavItemKind; id: number };

export type RequestListNavState = {
  origin: RequestListOrigin;
  items: NavItem[];
  savedAt: number;
};

export type NavPosition = {
  index: number;
  total: number;
  prev: NavItem | null;
  next: NavItem | null;
};

const NAV_KEY = 'kronos:request-list-nav';
const LIST_STATE_PREFIX = 'kronos:request-list-state:';

/** Máximo de elementos que se guardan si la lista completa no cabe (como Tickets). */
export const REQUEST_NAV_FALLBACK_WINDOW = 200;

const ORIGINS: RequestListOrigin[] = ['create-request', 'assigned-requests', 'viewer-request'];

export function isRequestListOrigin(value: unknown): value is RequestListOrigin {
  return typeof value === 'string' && (ORIGINS as string[]).includes(value);
}

function toNavItem(value: unknown): NavItem | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { kind?: unknown; id?: unknown };
  const id = Number(v.id);
  if ((v.kind !== 'request' && v.kind !== 'task') || !Number.isInteger(id) || id <= 0) return null;
  return { kind: v.kind, id };
}

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Posición del elemento abierto en la lista guardada; null si no está. */
export function findNavPosition(items: NavItem[], current: NavItem): NavPosition | null {
  const index = items.findIndex((it) => it.kind === current.kind && it.id === current.id);
  if (index < 0) return null;
  return {
    index,
    total: items.length,
    prev: index > 0 ? items[index - 1] : null,
    next: index < items.length - 1 ? items[index + 1] : null,
  };
}

/** Ventana de la lista alrededor del elemento abierto (cuando la completa no cabe). */
export function navWindow(items: NavItem[], current: NavItem, size = REQUEST_NAV_FALLBACK_WINDOW): NavItem[] {
  if (items.length <= size) return items;
  const idx = Math.max(0, items.findIndex((it) => it.kind === current.kind && it.id === current.id));
  const half = Math.floor(size / 2);
  const start = Math.max(0, Math.min(idx - half, items.length - size));
  return items.slice(start, start + size);
}

/** URL del detalle: las solicitudes en view-request y las tareas en view-activities. */
export function detailHref(item: NavItem, origin: RequestListOrigin): string {
  return item.kind === 'task'
    ? `/process/request-general/view-activities?id=${item.id}&from=assigned-activities`
    : `/process/request-general/view-request?id=${item.id}&from=${origin}`;
}

/** Lista a la que vuelve el breadcrumb (sin forzar pestaña: la recuerda la propia lista). */
export function listHref(origin: RequestListOrigin): string {
  return `/process/request-general/${origin}`;
}

/** Guarda la lista visible al abrir un elemento. Nunca lanza (cuota, modo privado). */
export function saveRequestListNav(origin: RequestListOrigin, items: NavItem[], current: NavItem): void {
  const s = storage();
  if (!s) return;
  const write = (list: NavItem[]) =>
    s.setItem(NAV_KEY, JSON.stringify({ origin, items: list, savedAt: Date.now() } satisfies RequestListNavState));
  try {
    write(items);
    return;
  } catch {
    /* no cabe completa: se intenta con una ventana */
  }
  try {
    write(navWindow(items, current));
  } catch {
    try {
      s.removeItem(NAV_KEY);
    } catch {
      /* ignore */
    }
  }
}

export function parseRequestListNav(raw: string | null): RequestListNavState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RequestListNavState>;
    if (!isRequestListOrigin(parsed?.origin) || !Array.isArray(parsed.items)) return null;
    const items = parsed.items.map(toNavItem).filter((x): x is NavItem => x !== null);
    return { origin: parsed.origin, items, savedAt: Number(parsed.savedAt) || 0 };
  } catch {
    return null;
  }
}

export function loadRequestListNav(): RequestListNavState | null {
  const s = storage();
  if (!s) return null;
  try {
    return parseRequestListNav(s.getItem(NAV_KEY));
  } catch {
    return null;
  }
}

/** Último elemento abierto desde esa lista (para volver a la página donde quedó). */
export function saveLastViewed(item: NavItem): void {
  const s = storage();
  if (!s) return;
  try {
    const nav = parseRequestListNav(s.getItem(NAV_KEY));
    if (!nav) return;
    s.setItem(NAV_KEY, JSON.stringify({ ...nav, last: item }));
  } catch {
    /* ignore */
  }
}

export function loadLastViewed(origin: RequestListOrigin): NavItem | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(NAV_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { origin?: unknown; last?: unknown };
    if (parsed?.origin !== origin) return null;
    return toNavItem(parsed.last);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Estado de la lista (filtros, búsqueda, pestaña, página y scroll)
// ---------------------------------------------------------------------------

export type RequestListViewState = {
  filters: ListFilters;
  search: string;
  /** Asignadas: pestaña Todos / Solicitudes / Tareas. */
  type?: 'all' | 'requests' | 'tasks';
  /** Asignadas: «Todo lo abierto». */
  openAll?: boolean;
  /** Observar: departamento. */
  department?: string;
  page?: number;
  scrollY?: number;
};

const STATUS_GROUPS: StatusGroup[] = ['all', 'pending', 'done', 'cancelled'];

/** Valida lo leído de sessionStorage: solo pasan campos conocidos y del tipo esperado. */
export function parseRequestListState(raw: string | null): RequestListViewState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    const rawFilters = (parsed.filters ?? {}) as Record<string, unknown>;
    const filters: ListFilters = { ...EMPTY_LIST_FILTERS };
    for (const key of Object.keys(EMPTY_LIST_FILTERS) as (keyof ListFilters)[]) {
      const v = rawFilters[key];
      if (typeof v !== 'string') continue;
      if (key === 'status') {
        if ((STATUS_GROUPS as string[]).includes(v)) filters.status = v as StatusGroup;
      } else {
        filters[key] = v;
      }
    }
    const state: RequestListViewState = {
      filters,
      search: typeof parsed.search === 'string' ? parsed.search : '',
    };
    if (parsed.type === 'all' || parsed.type === 'requests' || parsed.type === 'tasks') state.type = parsed.type;
    if (typeof parsed.openAll === 'boolean') state.openAll = parsed.openAll;
    if (typeof parsed.department === 'string') state.department = parsed.department;
    const page = Number(parsed.page);
    if (Number.isInteger(page) && page >= 1) state.page = page;
    const scrollY = Number(parsed.scrollY);
    if (Number.isFinite(scrollY) && scrollY > 0) state.scrollY = scrollY;
    return state;
  } catch {
    return null;
  }
}

export function loadRequestListState(origin: RequestListOrigin): RequestListViewState | null {
  const s = storage();
  if (!s) return null;
  try {
    return parseRequestListState(s.getItem(LIST_STATE_PREFIX + origin));
  } catch {
    return null;
  }
}

export function saveRequestListState(origin: RequestListOrigin, state: RequestListViewState): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(LIST_STATE_PREFIX + origin, JSON.stringify(state));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Página (1..n) en la que queda un elemento dentro de la lista filtrada. */
export function pageOfItem(items: NavItem[], item: NavItem | null, perPage: number): number | null {
  if (!item || perPage <= 0) return null;
  const idx = items.findIndex((it) => it.kind === item.kind && it.id === item.id);
  return idx < 0 ? null : Math.floor(idx / perPage) + 1;
}
