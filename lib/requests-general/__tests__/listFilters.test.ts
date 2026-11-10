import { describe, expect, it } from 'vitest';
import {
  EMPTY_LIST_FILTERS,
  activeFilterCount,
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
  it('abierto, sin empezar y devuelta son pendientes', () => {
    expect(statusGroupOf(1, 'Abierto')).toBe('pending');
    expect(statusGroupOf(4, 'Sin empezar')).toBe('pending');
    expect(statusGroupOf(7, 'Devuelta')).toBe('pending');
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
      countByStatusGroup([row(), row({ group: 'done' }), row({ group: 'cancelled' }), row()])
    ).toEqual({ all: 4, pending: 2, done: 1, cancelled: 1 });
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
