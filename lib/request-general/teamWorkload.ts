/**
 * Dashboard «Mi equipo» del líder de proceso (cálculos puros, seguros en cliente).
 *
 * Definiciones:
 * - Líder: responsable de la solicitud (misma regla que requestResponsibleSql en workload.ts:
 *   requests_general.id_assigned o, si está vacío, el usuario del proceso de la solicitud).
 * - Colaborador: quien tiene actividades (task_request_general.id_assigned) en solicitudes
 *   de las que el líder es responsable, sin contar al propio líder.
 * - Pendiente: actividad que no está Resuelta (2), Cancelada (3) ni En borrador (6). Las
 *   pendientes son la foto de HOY: no dependen del periodo elegido.
 * - Completadas y tiempo promedio: actividades resueltas con cierre dentro del periodo.
 * - Estancada: pendiente con más de STALE_DAYS días desde su inicio.
 * - Carga alta: pendientes ≥ max(5, 1,5 × promedio del equipo); sobrecarga: ≥ max(8, 2 × promedio).
 */

import {
  parseCalendarDate,
  type DateRangeStrings,
} from '../dashboard/dateRange';
import { CLOSED_TASK_STATUS_IDS } from './workload';

export const STALE_DAYS = 15;
export const TREND_WEEKS = 8;

const RESOLVED_STATUS_ID = 2;
const CANCELLED_STATUS_ID = 3;
const DRAFT_STATUS_ID = 6;

export interface TeamActivityRow {
  id: number;
  id_request_general: number;
  task?: string | null;
  id_status: number;
  status_task?: string | null;
  id_assigned: string;
  assigned?: string | null;
  assigned_email?: string | null;
  subject?: string | null;
  company?: string | null;
  process?: string | null;
  start_date?: string | null;
  date_resolution?: string | null;
}

export type TeamTaskState = 'abierta' | 'progreso' | 'resuelta' | 'cancelada' | 'borrador';

export type LoadLevel = 'sobrecarga' | 'alta' | 'normal' | 'libre';

export type Tone = 'ok' | 'warning' | 'critical' | 'info' | 'idle';

export interface TeamMemberSummary {
  id: string;
  name: string;
  email: string | null;
  open: number;
  inProgress: number;
  pending: number;
  completed: number;
  avgHours: number | null;
  stale: number;
  oldestPendingDays: number | null;
  /** % de las pendientes del equipo que tiene esta persona. */
  share: number;
  level: LoadLevel;
}

export interface TeamWorkload {
  members: TeamMemberSummary[];
  totals: {
    members: number;
    pending: number;
    open: number;
    inProgress: number;
    completed: number;
    avgHours: number | null;
    stale: number;
    avgPendingPerMember: number;
  };
  /** Pendientes más antiguas primero. */
  oldestPending: Array<TeamActivityRow & { days: number }>;
  /** Completadas por semana, de la más antigua a la actual. */
  weeklyCompleted: number[];
}

export function taskState(row: Pick<TeamActivityRow, 'id_status' | 'status_task'>): TeamTaskState {
  const id = Number(row.id_status);
  if (id === RESOLVED_STATUS_ID) return 'resuelta';
  if (id === CANCELLED_STATUS_ID) return 'cancelada';
  if (id === DRAFT_STATUS_ID) return 'borrador';
  const s = String(row.status_task ?? '').toLowerCase();
  if (s.includes('progreso') || s.includes('proceso')) return 'progreso';
  return 'abierta';
}

export function isPending(row: Pick<TeamActivityRow, 'id_status'>): boolean {
  return !(CLOSED_TASK_STATUS_IDS as readonly number[]).includes(Number(row.id_status));
}

const DAY_MS = 86_400_000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function daysSince(value: string | null | undefined, now: Date): number | null {
  const d = parseCalendarDate(value);
  if (!d) return null;
  return Math.max(0, Math.round((startOfDay(now).getTime() - d.getTime()) / DAY_MS));
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function inRange(value: string | null | undefined, range: DateRangeStrings | null): boolean {
  if (!range) return true;
  const d = parseCalendarDate(value);
  if (!d) return false;
  const key = dateKey(d);
  return key >= range.startDate && key <= range.endDate;
}

function resolutionHours(row: TeamActivityRow): number | null {
  if (!row.start_date || !row.date_resolution) return null;
  const a = new Date(row.start_date).getTime();
  const b = new Date(row.date_resolution).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return (b - a) / 3_600_000;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function loadLevel(pending: number, avgPending: number, members: number): LoadLevel {
  if (pending === 0) return 'libre';
  if (members > 1 && pending >= Math.max(8, Math.ceil(avgPending * 2))) return 'sobrecarga';
  if (members > 1 && pending >= Math.max(5, Math.ceil(avgPending * 1.5))) return 'alta';
  return 'normal';
}

export const LOAD_LEVEL_TONE: Record<LoadLevel, Tone> = {
  sobrecarga: 'critical',
  alta: 'warning',
  normal: 'ok',
  libre: 'idle',
};

export const LOAD_LEVEL_LABEL: Record<LoadLevel, string> = {
  sobrecarga: 'Sobrecarga',
  alta: 'Carga alta',
  normal: 'Normal',
  libre: 'Sin pendientes',
};

export function buildTeamWorkload(
  rows: TeamActivityRow[],
  { range = null, now = new Date() }: { range?: DateRangeStrings | null; now?: Date } = {}
): TeamWorkload {
  const live = rows.filter((r) => taskState(r) !== 'borrador' && r.id_assigned);

  const byMember = new Map<string, TeamActivityRow[]>();
  for (const row of live) {
    const list = byMember.get(row.id_assigned);
    if (list) list.push(row);
    else byMember.set(row.id_assigned, [row]);
  }

  const totalPending = live.filter(isPending).length;
  const avgPendingPerMember = byMember.size > 0 ? totalPending / byMember.size : 0;

  const completedHours: number[] = [];
  const members: TeamMemberSummary[] = [...byMember.entries()].map(([id, list]) => {
    const pendingRows = list.filter(isPending);
    const open = pendingRows.filter((r) => taskState(r) === 'abierta').length;
    const inProgress = pendingRows.length - open;
    const ages = pendingRows
      .map((r) => daysSince(r.start_date, now))
      .filter((d): d is number => d != null);
    const completedRows = list.filter(
      (r) => taskState(r) === 'resuelta' && inRange(r.date_resolution, range)
    );
    const hours = completedRows.map(resolutionHours).filter((h): h is number => h != null);
    completedHours.push(...hours);
    const named = list.find((r) => r.assigned) ?? list[0];

    return {
      id,
      name: named.assigned?.trim() || 'Sin nombre',
      email: named.assigned_email ?? null,
      open,
      inProgress,
      pending: pendingRows.length,
      completed: completedRows.length,
      avgHours: average(hours),
      stale: ages.filter((d) => d > STALE_DAYS).length,
      oldestPendingDays: ages.length > 0 ? Math.max(...ages) : null,
      share: totalPending > 0 ? (pendingRows.length / totalPending) * 100 : 0,
      level: loadLevel(pendingRows.length, avgPendingPerMember, byMember.size),
    };
  });

  members.sort((a, b) => b.pending - a.pending || b.stale - a.stale || a.name.localeCompare(b.name, 'es'));

  const oldestPending = live
    .filter(isPending)
    .map((r) => ({ ...r, days: daysSince(r.start_date, now) ?? 0 }))
    .sort((a, b) => b.days - a.days);

  const weekStart = startOfDay(now).getTime() - (TREND_WEEKS * 7 - 1) * DAY_MS;
  const weeklyCompleted = Array.from({ length: TREND_WEEKS }, () => 0);
  for (const r of live) {
    if (taskState(r) !== 'resuelta') continue;
    const d = parseCalendarDate(r.date_resolution);
    if (!d) continue;
    const idx = Math.floor((d.getTime() - weekStart) / (7 * DAY_MS));
    if (idx >= 0 && idx < TREND_WEEKS) weeklyCompleted[idx] += 1;
  }

  const totals = {
    members: members.length,
    pending: totalPending,
    open: members.reduce((s, m) => s + m.open, 0),
    inProgress: members.reduce((s, m) => s + m.inProgress, 0),
    completed: members.reduce((s, m) => s + m.completed, 0),
    avgHours: average(completedHours),
    stale: members.reduce((s, m) => s + m.stale, 0),
    avgPendingPerMember,
  };

  return { members, totals, oldestPending, weeklyCompleted };
}

export interface MemberCompliance {
  id: string;
  name: string;
  /** Actividades asignadas en el periodo (por fecha de inicio). */
  assigned: number;
  /** De esas, cuántas ya están resueltas. */
  resolved: number;
  /** resolved / assigned × 100. */
  compliancePct: number;
  avgHours: number | null;
  /** Desviación estándar del tiempo de cierre (horas); null con menos de 2 cerradas. */
  stdHours: number | null;
}

export interface TeamCompliance {
  members: MemberCompliance[];
  /** Cumplimiento de todo el equipo (no el promedio de los porcentajes). */
  teamPct: number | null;
}

/**
 * Cumplimiento por colaborador: de lo que se le asignó en el periodo, qué % ya cerró y
 * cuánto se demora en cerrar (promedio ± desviación). Ordenado por volumen, máx. `max`.
 */
export function buildTeamCompliance(
  rows: TeamActivityRow[],
  range: DateRangeStrings | null,
  max = 12
): TeamCompliance {
  const byMember = new Map<string, { name: string; assigned: number; resolved: number; hours: number[] }>();
  for (const r of rows) {
    if (!r.id_assigned || taskState(r) === 'borrador' || taskState(r) === 'cancelada') continue;
    if (!inRange(r.start_date, range)) continue;
    const entry = byMember.get(r.id_assigned) ?? {
      name: r.assigned?.trim() || 'Sin nombre',
      assigned: 0,
      resolved: 0,
      hours: [],
    };
    entry.assigned += 1;
    if (taskState(r) === 'resuelta') {
      entry.resolved += 1;
      const h = resolutionHours(r);
      if (h != null) entry.hours.push(h);
    }
    byMember.set(r.id_assigned, entry);
  }

  let assigned = 0;
  let resolved = 0;
  const members: MemberCompliance[] = [...byMember.entries()].map(([id, m]) => {
    assigned += m.assigned;
    resolved += m.resolved;
    const avg = average(m.hours);
    const std =
      avg != null && m.hours.length >= 2
        ? Math.sqrt(m.hours.reduce((sum, h) => sum + (h - avg) ** 2, 0) / m.hours.length)
        : null;
    return {
      id,
      name: m.name,
      assigned: m.assigned,
      resolved: m.resolved,
      compliancePct: (m.resolved / m.assigned) * 100,
      avgHours: avg,
      stdHours: std,
    };
  });

  members.sort((a, b) => b.assigned - a.assigned || a.name.localeCompare(b.name, 'es'));
  return {
    members: members.slice(0, max),
    teamPct: assigned > 0 ? (resolved / assigned) * 100 : null,
  };
}
