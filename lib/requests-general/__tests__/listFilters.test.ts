import { describe, expect, it } from 'vitest';
import {
  ASSIGNED_STATE_OPTIONS,
  EMPTY_LIST_FILTERS,
  REQUEST_STATE_OPTIONS,
  activeFilterCount,
  describeListFilters,
  stateGroup,
  buildListOptions,
  countByStatusGroup,
  matchesListFilters,
  splitPeople,
  statusGroupOf,
  type ListFilters,
  type ListRow,
} from '../listFilters';

const row = (over: Partial<ListRow> = {}): ListRow => ({
  requestId: 10,
  group: 'pending',
  companyId: '1',
  company: 'GSS',
  process: 'Compras',
  people: ['Ana Pérez'],
  createdAt: '2026-11-04T08:30:00.000Z',
  ...over,
});
const f = (over: Partial<ListFilters> = {}): ListFilters => ({ ...EMPTY_LIST_FILTERS, ...over });

describe('estado general (solicitudes y tareas)', () => {
  it('abierto y sin empezar son pendientes; devuelta va aparte', () => {
    expect(statusGroupOf(1, 'Abierto')).toBe('pending');
    expect(statusGroupOf(4, 'Sin empezar')).toBe('pending');
    expect(statusGroupOf(7, 'Devuelta')).toBe('returned');
    expect(statusGroupOf(99, 'Devuelta al solicitante')).toBe('returned');
    // Compras/Ventas: igual que el grupo `pending` de /api/requests-general/general-requests.
    expect(statusGroupOf(5, 'Por Autorizar')).toBe('pending');
    expect(statusGroupOf(6, 'En Borrador')).toBe('pending');
  });

  it('resuelto es completada y cancelado es cancelada', () => {
    expect(statusGroupOf(2, 'Resuelto')).toBe('done');
    expect(statusGroupOf(3, 'Cancelado')).toBe('cancelled');
  });

  it('un id desconocido se decide por el nombre', () => {
    expect(statusGroupOf(99, 'Finalizado')).toBe('done');
    expect(statusGroupOf(null, 'Cancelada')).toBe('cancelled');
    expect(statusGroupOf(undefined, 'En progreso')).toBe('pending');
  });

  it('Pendientes trae solicitudes y tareas a la vez', () => {
    const solicitud = row({ group: statusGroupOf(1, 'Abierto') });
    const tarea = row({ group: statusGroupOf(4, 'Sin empezar') });
    const hecha = row({ group: statusGroupOf(2, 'Resuelto') });
    const filtro = f({ status: 'pending' });
    expect([solicitud, tarea, hecha].filter((r) => matchesListFilters(r, filtro))).toHaveLength(2);
  });
});

describe('matchesListFilters', () => {
  it('sin filtros pasa todo', () => {
    expect(matchesListFilters(row(), f())).toBe(true);
  });

  it('ID exacto (acepta #)', () => {
    expect(matchesListFilters(row(), f({ id: '10' }))).toBe(true);
    expect(matchesListFilters(row(), f({ id: '#10' }))).toBe(true);
    expect(matchesListFilters(row(), f({ id: '1' }))).toBe(false);
  });

  it('proceso exacto: "Compras" no trae "Compras importación"', () => {
    expect(matchesListFilters(row({ process: 'Compras importación' }), f({ process: 'Compras' }))).toBe(false);
    expect(matchesListFilters(row(), f({ process: 'Compras' }))).toBe(true);
  });

  it('empresa y persona asignada', () => {
    expect(matchesListFilters(row(), f({ company: '2' }))).toBe(false);
    expect(matchesListFilters(row({ people: ['Ana Pérez', 'Luis'] }), f({ person: 'Luis' }))).toBe(true);
    expect(matchesListFilters(row(), f({ person: 'Luis' }))).toBe(false);
  });

  it('"Hasta" incluye todo el último día', () => {
    const tarde = row({ createdAt: '2026-11-04T23:50:00.000Z' });
    expect(matchesListFilters(tarde, f({ date_from: '2026-11-04', date_to: '2026-11-04' }))).toBe(true);
    expect(matchesListFilters(tarde, f({ date_to: '2026-11-03' }))).toBe(false);
    expect(matchesListFilters(tarde, f({ date_from: '2026-11-05' }))).toBe(false);
  });

  it('fechas escritas al revés se toman en orden', () => {
    expect(matchesListFilters(row(), f({ date_from: '2026-11-30', date_to: '2026-11-01' }))).toBe(true);
  });

  it('ignoreStatus: las tarjetas cuentan sin el estado elegido', () => {
    const hecha = row({ group: 'done' });
    expect(matchesListFilters(hecha, f({ status: 'pending' }))).toBe(false);
    expect(matchesListFilters(hecha, f({ status: 'pending' }), { ignoreStatus: true })).toBe(true);
  });
});

describe('apoyos', () => {
  it('cuenta por estado', () => {
    expect(
      countByStatusGroup([
        row(),
        row({ group: 'done' }),
        row({ group: 'cancelled' }),
        row(),
        row({ group: 'returned' }),
      ])
    ).toEqual({ all: 5, pending: 2, returned: 1, done: 1, cancelled: 1 });
  });

  it('separa personas y quita vacíos y repetidos', () => {
    expect(splitPeople('Ana, Luis, ', 'Luis,Eva', null)).toEqual(['Ana', 'Luis', 'Eva']);
  });

  it('opciones salen de los datos, sin repetidos y ordenadas', () => {
    const opts = buildListOptions([
      row({ companyId: '2', company: 'Farma', process: 'Ventas', people: ['Zoe'] }),
      row(),
      row(),
    ]);
    expect(opts.companies.map((c) => c.label)).toEqual(['Farma', 'GSS']);
    expect(opts.processes.map((p) => p.value)).toEqual(['Compras', 'Ventas']);
    expect(opts.people.map((p) => p.value)).toEqual(['Ana Pérez', 'Zoe']);
  });

  it('cuenta filtros activos del panel (no el estado)', () => {
    expect(activeFilterCount(f({ status: 'done' }))).toBe(0);
    expect(activeFilterCount(f({ company: '1', date_to: '2026-11-04' }))).toBe(2);
  });
});

describe('filtros restaurados del panel anterior (hotfix 2026-11-10)', () => {
  it('estado exacto: Devuelta separa lo devuelto dentro de Pendientes', () => {
    const abierta = row({ statusId: 1 });
    const devuelta = row({ statusId: 7 });
    const filtro = f({ status: 'pending', state: '7' });
    expect([abierta, devuelta].filter((r) => matchesListFilters(r, filtro))).toEqual([devuelta]);
  });

  it('estado exacto: Sin empezar (solo tareas) en Asignadas', () => {
    const tarea = row({ statusId: 4 });
    const solicitud = row({ statusId: 1 });
    expect(matchesListFilters(tarea, f({ state: '4' }))).toBe(true);
    expect(matchesListFilters(solicitud, f({ state: '4' }))).toBe(false);
  });

  it('el estado exacto no cambia las tarjetas (ignoreStatus)', () => {
    expect(matchesListFilters(row({ statusId: 2, group: 'done' }), f({ state: '7' }), { ignoreStatus: true })).toBe(true);
  });

  it('cada estado exacto cae en su tarjeta', () => {
    expect(stateGroup('1')).toBe('pending');
    expect(stateGroup('4')).toBe('pending');
    expect(stateGroup('7')).toBe('returned');
    expect(stateGroup('2')).toBe('done');
    expect(stateGroup('3')).toBe('cancelled');
  });

  it('mismas opciones de estado que había antes', () => {
    expect(REQUEST_STATE_OPTIONS.map((o) => o.value)).toEqual(['1', '3', '2', '7']);
    expect(ASSIGNED_STATE_OPTIONS.map((o) => o.value)).toEqual(['4', '1', '3', '2', '7']);
  });

  it('categoría exacta', () => {
    expect(matchesListFilters(row({ category: 'Tesorería' }), f({ category: 'Tesorería' }))).toBe(true);
    expect(matchesListFilters(row({ category: 'Compras' }), f({ category: 'Tesorería' }))).toBe(false);
    expect(matchesListFilters(row(), f({ category: 'Tesorería' }))).toBe(false);
  });

  it('cuenta estado exacto y categoría como filtros activos', () => {
    expect(activeFilterCount(f({ state: '7', category: 'Compras' }))).toBe(2);
  });

  it('el Excel describe estado exacto y categoría solo donde existen', () => {
    const base = { companies: [], processes: [], people: [] };
    const sin = describeListFilters(f(), base).map((d) => d.label);
    expect(sin).not.toContain('Estado exacto');
    expect(sin).not.toContain('Categoría');
    const con = describeListFilters(f({ state: '7', category: 'Compras' }), {
      ...base,
      states: REQUEST_STATE_OPTIONS,
      categories: [{ value: 'Compras', label: 'Compras' }],
    });
    expect(con).toContainEqual({ label: 'Estado exacto', value: 'Devuelta' });
    expect(con).toContainEqual({ label: 'Categoría', value: 'Compras' });
  });
});
