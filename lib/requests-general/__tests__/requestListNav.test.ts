import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_LIST_FILTERS } from '../listFilters';
import {
  REQUEST_NAV_FALLBACK_WINDOW,
  detailHref,
  findNavPosition,
  listHref,
  loadLastViewed,
  loadRequestListNav,
  loadRequestListState,
  navWindow,
  pageOfItem,
  parseRequestListState,
  saveLastViewed,
  saveRequestListNav,
  saveRequestListState,
  type NavItem,
} from '../requestListNav';

// sessionStorage mínimo con cuota (en caracteres), como el del navegador.
function installStorage(quota = Infinity) {
  const data = new Map<string, string>();
  const used = () => [...data.entries()].reduce((n, [k, v]) => n + k.length + v.length, 0);
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => {
      const prev = data.get(k);
      if (used() - (prev ? k.length + prev.length : 0) + k.length + v.length > quota) {
        throw new DOMException('quota', 'QuotaExceededError');
      }
      data.set(k, v);
    },
  };
  (globalThis as unknown as { window: unknown }).window = globalThis;
  (globalThis as unknown as { sessionStorage: unknown }).sessionStorage = storage;
  return data;
}

const req = (id: number): NavItem => ({ kind: 'request', id });
const task = (id: number): NavItem => ({ kind: 'task', id });

describe('findNavPosition (vecinos)', () => {
  const items = [req(10), task(10), req(7), task(3)];

  it('da posición, total y vecinos en el orden de la lista', () => {
    expect(findNavPosition(items, req(7))).toEqual({ index: 2, total: 4, prev: task(10), next: task(3) });
  });

  it('en los extremos no hay anterior / siguiente', () => {
    expect(findNavPosition(items, req(10))?.prev).toBeNull();
    expect(findNavPosition(items, task(3))?.next).toBeNull();
  });

  it('distingue solicitud y tarea con el mismo id', () => {
    expect(findNavPosition(items, task(10))?.index).toBe(1);
    expect(findNavPosition(items, req(3))).toBeNull();
  });
});

describe('enlaces del detalle', () => {
  it('solicitud a view-request con su lista; tarea a view-activities', () => {
    expect(detailHref(req(5), 'create-request')).toBe('/process/request-general/view-request?id=5&from=create-request');
    expect(detailHref(task(9), 'assigned-requests')).toBe(
      '/process/request-general/view-activities?id=9&from=assigned-activities'
    );
    expect(listHref('assigned-requests')).toBe('/process/request-general/assigned-requests');
  });
});

describe('saveRequestListNav / loadRequestListNav', () => {
  let data: Map<string, string>;
  beforeEach(() => {
    data = installStorage();
  });

  it('guarda y lee la lista con su origen', () => {
    saveRequestListNav('assigned-requests', [req(1), task(2)], req(1));
    expect(loadRequestListNav()).toMatchObject({ origin: 'assigned-requests', items: [req(1), task(2)] });
  });

  it('descarta basura y orígenes desconocidos', () => {
    data.set('kronos:request-list-nav', JSON.stringify({ origin: 'otra', items: [] }));
    expect(loadRequestListNav()).toBeNull();
    data.set('kronos:request-list-nav', JSON.stringify({ origin: 'create-request', items: [{ kind: 'x', id: 1 }, req(4)] }));
    expect(loadRequestListNav()?.items).toEqual([req(4)]);
  });

  it('si no cabe completa guarda una ventana alrededor del abierto', () => {
    const items = Array.from({ length: 5000 }, (_, i) => req(i + 1));
    data = installStorage(20_000);
    saveRequestListNav('create-request', items, req(2500));
    const saved = loadRequestListNav()!;
    expect(saved.items).toHaveLength(REQUEST_NAV_FALLBACK_WINDOW);
    expect(findNavPosition(saved.items, req(2500))).not.toBeNull();
  });

  it('el último visto es por lista', () => {
    saveRequestListNav('viewer-request', [req(1), req(2)], req(1));
    saveLastViewed(req(2));
    expect(loadLastViewed('viewer-request')).toEqual(req(2));
    expect(loadLastViewed('create-request')).toBeNull();
  });
});

describe('navWindow y pageOfItem', () => {
  const items = Array.from({ length: 1000 }, (_, i) => req(i + 1));
  it('la ventana no se sale de la lista', () => {
    expect(navWindow(items, req(1), 10)).toEqual(items.slice(0, 10));
    expect(navWindow(items, req(1000), 10)).toEqual(items.slice(990));
  });
  it('página del elemento', () => {
    expect(pageOfItem(items, req(1), 100)).toBe(1);
    expect(pageOfItem(items, req(101), 100)).toBe(2);
    expect(pageOfItem(items, req(5000), 100)).toBeNull();
    expect(pageOfItem(items, null, 100)).toBeNull();
  });
});

describe('estado de la lista (filtros)', () => {
  beforeEach(() => {
    installStorage();
  });

  it('ida y vuelta conserva filtros, búsqueda, pestaña, «Todo lo abierto», página y scroll', () => {
    const state = {
      filters: { ...EMPTY_LIST_FILTERS, status: 'pending' as const, state: '1', company: '3', date_from: '2026-11-01' },
      search: 'compra',
      type: 'tasks' as const,
      openAll: true,
      page: 2,
      scrollY: 480,
    };
    saveRequestListState('assigned-requests', state);
    expect(loadRequestListState('assigned-requests')).toEqual(state);
    expect(loadRequestListState('create-request')).toBeNull();
  });

  it('valida lo guardado: ignora campos y valores desconocidos', () => {
    const parsed = parseRequestListState(
      JSON.stringify({ filters: { status: 'raro', company: 5, process: 'Compras', otro: 'x' }, search: 3, type: 'x', page: -1 })
    );
    expect(parsed).toEqual({ filters: { ...EMPTY_LIST_FILTERS, process: 'Compras' }, search: '' });
    expect(parseRequestListState('no-json')).toBeNull();
    expect(parseRequestListState(null)).toBeNull();
  });
});
