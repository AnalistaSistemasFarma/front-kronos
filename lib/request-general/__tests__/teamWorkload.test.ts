import { describe, expect, it } from 'vitest';
import {
  STALE_DAYS,
  buildTeamCompliance,
  buildTeamWorkload,
  isPending,
  loadLevel,
  taskState,
  type TeamActivityRow,
} from '../teamWorkload';

const NOW = new Date(2026, 9, 15, 10, 0, 0);

function daysAgo(n: number): string {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - n, 8, 0, 0);
  return d.toISOString();
}

let seq = 0;
function row(who: string, status: number, opts: Partial<TeamActivityRow> = {}): TeamActivityRow {
  seq += 1;
  return {
    id: seq,
    id_request_general: 100 + seq,
    task: `Tarea ${seq}`,
    id_status: status,
    status_task: status === 1 ? 'Sin empezar' : status === 4 ? 'En progreso' : 'Otro',
    id_assigned: who,
    assigned: { a: 'Ana Pérez', b: 'Beto Ruiz', c: 'Caro Gómez' }[who] ?? who,
    process: 'Compras',
    start_date: daysAgo(2),
    date_resolution: null,
    ...opts,
  };
}

describe('taskState / isPending', () => {
  it('clasifica por id de estado y por texto de progreso', () => {
    expect(taskState({ id_status: 2 })).toBe('resuelta');
    expect(taskState({ id_status: 3 })).toBe('cancelada');
    expect(taskState({ id_status: 6 })).toBe('borrador');
    expect(taskState({ id_status: 4, status_task: 'En progreso' })).toBe('progreso');
    expect(taskState({ id_status: 1, status_task: 'Sin empezar' })).toBe('abierta');
    expect(isPending({ id_status: 1 })).toBe(true);
    expect(isPending({ id_status: 2 })).toBe(false);
    expect(isPending({ id_status: 6 })).toBe(false);
  });
});

describe('loadLevel', () => {
  it('marca carga alta y sobrecarga frente al promedio del equipo', () => {
    expect(loadLevel(0, 3, 3)).toBe('libre');
    expect(loadLevel(3, 3, 3)).toBe('normal');
    expect(loadLevel(5, 3, 3)).toBe('alta');
    expect(loadLevel(8, 3, 3)).toBe('sobrecarga');
    // Una sola persona no se compara contra sí misma.
    expect(loadLevel(20, 20, 1)).toBe('normal');
  });
});

describe('buildTeamWorkload', () => {
  it('sin actividades: equipo vacío', () => {
    const team = buildTeamWorkload([], { now: NOW });
    expect(team.members).toHaveLength(0);
  });

  it('cuenta pendientes por persona, ordena por carga y detecta sobrecarga', () => {
    const rows = [
      ...Array.from({ length: 9 }, () => row('a', 1)),
      row('a', 4),
      row('b', 1),
      row('c', 2, { start_date: daysAgo(3), date_resolution: daysAgo(1) }),
    ];
    const team = buildTeamWorkload(rows, { now: NOW });

    expect(team.members.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    const ana = team.members[0];
    expect(ana.pending).toBe(10);
    expect(ana.open).toBe(9);
    expect(ana.inProgress).toBe(1);
    expect(ana.level).toBe('sobrecarga');
    expect(team.members[2].level).toBe('libre');
    expect(team.totals.pending).toBe(11);
  });

  it('ignora borradores y cuenta estancadas con más de STALE_DAYS días', () => {
    const rows = [
      row('a', 1, { start_date: daysAgo(STALE_DAYS + 5) }),
      row('a', 1, { start_date: daysAgo(1) }),
      row('b', 6),
      row('b', 1),
    ];
    const team = buildTeamWorkload(rows, { now: NOW });

    expect(team.totals.pending).toBe(3);
    expect(team.totals.stale).toBe(1);
    expect(team.members.find((m) => m.id === 'a')?.oldestPendingDays).toBe(STALE_DAYS + 5);
    expect(team.oldestPending[0].days).toBe(STALE_DAYS + 5);
  });

  it('completadas y tiempo promedio solo dentro del periodo', () => {
    const rows = [
      row('a', 2, { start_date: daysAgo(4), date_resolution: daysAgo(2) }),
      row('a', 2, { start_date: daysAgo(80), date_resolution: daysAgo(70) }),
      row('a', 1),
    ];
    const range = { startDate: '2026-10-01', endDate: '2026-10-31' };
    const team = buildTeamWorkload(rows, { now: NOW, range });

    expect(team.totals.completed).toBe(1);
    expect(team.totals.avgHours).toBeCloseTo(48, 5);
    expect(team.weeklyCompleted.reduce((s, n) => s + n, 0)).toBe(1);
  });
});

describe('buildTeamCompliance', () => {
  const range = { startDate: '2026-09-01', endDate: '2026-09-30' };
  const rows = [
    row('a', 2, { start_date: '2026-09-01T08:00:00', date_resolution: '2026-09-02T08:00:00' }),
    row('a', 2, { start_date: '2026-09-03T08:00:00', date_resolution: '2026-09-06T08:00:00' }),
    row('a', 1, { start_date: '2026-09-10T08:00:00' }),
    row('a', 1, { start_date: '2026-09-11T08:00:00' }),
    row('b', 2, { start_date: '2026-09-05T08:00:00', date_resolution: '2026-09-07T08:00:00' }),
    row('b', 3, { start_date: '2026-09-05T08:00:00' }),
    row('b', 1, { start_date: '2026-08-20T08:00:00' }),
  ];

  it('% de lo asignado en el periodo que ya cerró, ordenado por volumen', () => {
    const result = buildTeamCompliance(rows, range);
    expect(result.members.map((m) => m.id)).toEqual(['a', 'b']);
    const [ana, beto] = result.members;
    expect(ana).toMatchObject({ assigned: 4, resolved: 2, compliancePct: 50 });
    // Canceladas y fuera del periodo no cuentan.
    expect(beto).toMatchObject({ assigned: 1, resolved: 1, compliancePct: 100 });
    expect(result.teamPct).toBeCloseTo(60, 5);
  });

  it('tiempo promedio y desviación de las cerradas', () => {
    const [ana, beto] = buildTeamCompliance(rows, range).members;
    expect(ana.avgHours).toBeCloseTo(48, 5);
    expect(ana.stdHours).toBeCloseTo(24, 5);
    expect(beto.avgHours).toBeCloseTo(48, 5);
    expect(beto.stdHours).toBeNull();
  });

  it('sin actividades en el periodo', () => {
    expect(buildTeamCompliance(rows, { startDate: '2025-01-01', endDate: '2025-01-31' })).toEqual({
      members: [],
      teamPct: null,
    });
  });
});
