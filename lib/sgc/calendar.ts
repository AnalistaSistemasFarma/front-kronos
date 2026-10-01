import { formatCalendarDate, toCalendarDate } from './review';
import { addDays, type SgcCalendarState } from './reviewAlerts';

/**
 * Calendario de vencimientos del SGC — funciones PURAS (cliente y servidor):
 * cuadrícula mensual (semana de lunes a domingo, como en Colombia), semana,
 * agenda y filtros. Las fechas son de calendario (YYYY-MM-DD), sin hora.
 */

export type SgcCalendarView = 'mes' | 'semana' | 'agenda';

export interface SgcCalendarItem {
  idDocument: number;
  code: string;
  title: string;
  versionNumber: number | null;
  idVersion: number | null;
  /** Próxima fecha de vencimiento de la vigencia (YYYY-MM-DD). */
  dueDate: string | null;
  state: SgcCalendarState;
  idProcessType: number;
  processType: string;
  processTypeColor: string;
  idProcess: number;
  process: string;
  idDepartment: number | null;
  department: string | null;
  idDocumentType: number;
  documentType: string;
  /** Dueño(s) del proceso, último elaborador y Calidad (para el filtro «responsable»). */
  owners: string[];
  lastElaborator: string | null;
  responsibles: string[];
  openRequestId: number | null;
  /** true si la persona es dueña del proceso o fue la última en elaborarlo («Mis vencimientos»). */
  isMine: boolean;
  confidentiality: string;
  /** Días de anticipación de los avisos que aplican a este documento. */
  offsets: number[];
}

export interface SgcCalendarFilters {
  idDepartment?: number | null;
  idProcess?: number | null;
  idDocumentType?: number | null;
  responsible?: string | null;
  states?: readonly SgcCalendarState[] | null;
  mine?: boolean;
  text?: string | null;
}

export function filterCalendarItems(items: readonly SgcCalendarItem[], f: SgcCalendarFilters): SgcCalendarItem[] {
  const text = (f.text ?? '').trim().toLowerCase();
  const resp = (f.responsible ?? '').trim().toLowerCase();
  return items.filter(
    (i) =>
      (!f.mine || i.isMine) &&
      (!f.idDepartment || i.idDepartment === f.idDepartment) &&
      (!f.idProcess || i.idProcess === f.idProcess) &&
      (!f.idDocumentType || i.idDocumentType === f.idDocumentType) &&
      (!resp || i.responsibles.some((r) => r.toLowerCase() === resp)) &&
      (!f.states || f.states.length === 0 || f.states.includes(i.state)) &&
      (!text || i.code.toLowerCase().includes(text) || i.title.toLowerCase().includes(text))
  );
}

/** Lunes de la semana de la fecha. */
export function startOfWeek(date: Date | string): Date {
  const d = toCalendarDate(date);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = lunes
  return addDays(d, -dow);
}

/** Días (YYYY-MM-DD) de la semana de lunes a domingo. */
export function weekDays(date: Date | string): string[] {
  const start = startOfWeek(date);
  return Array.from({ length: 7 }, (_, i) => formatCalendarDate(addDays(start, i))!);
}

/**
 * Cuadrícula del mes: semanas completas de lunes a domingo que cubren el mes
 * (4 a 6 filas). `inMonth` marca los días del mes pedido.
 */
export function monthGrid(year: number, month: number): { date: string; inMonth: boolean }[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));
  const start = startOfWeek(first);
  const end = addDays(startOfWeek(last), 6);
  const weeks: { date: string; inMonth: boolean }[][] = [];
  for (let d = start; d.getTime() <= end.getTime(); d = addDays(d, 1)) {
    if (weeks.length === 0 || weeks[weeks.length - 1].length === 7) weeks.push([]);
    weeks[weeks.length - 1].push({ date: formatCalendarDate(d)!, inMonth: d.getUTCMonth() === month - 1 });
  }
  return weeks;
}

/** Agrupa por fecha (para la agenda), en orden de fecha y luego de código. */
export function groupByDate(items: readonly SgcCalendarItem[], from?: string | null, to?: string | null): { date: string; items: SgcCalendarItem[] }[] {
  const map = new Map<string, SgcCalendarItem[]>();
  for (const i of items) {
    if (!i.dueDate) continue;
    if (from && i.dueDate < from) continue;
    if (to && i.dueDate > to) continue;
    const list = map.get(i.dueDate) ?? [];
    list.push(i);
    map.set(i.dueDate, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({ date, items: list.sort((x, y) => x.code.localeCompare(y.code, 'es', { numeric: true })) }));
}

/** Mes siguiente o anterior (YYYY, 1-12). */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const SGC_WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export function monthLabel(year: number, month: number): string {
  return `${MONTHS[month - 1]} de ${year}`;
}

/** «13 de mayo de 2026» (prosa formal colombiana). */
export function longDate(date: string): string {
  const d = toCalendarDate(date);
  return `${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}
