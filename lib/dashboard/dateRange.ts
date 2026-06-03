export type DashboardDateFilter = 'month' | 'quarter' | 'semester' | 'year' | 'all';

export interface DateRangeStrings {
  startDate: string;
  endDate: string;
}

/** YYYY-MM-DD en hora local (sin desfase UTC) */
export function formatDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function capEndToToday(end: Date): Date {
  const today = startOfDay(new Date());
  const endDay = startOfDay(end);
  return endDay > today ? today : endDay;
}

function lastDayOfMonth(year: number, month: number): Date {
  return new Date(year, month + 1, 0);
}

/**
 * Rangos de periodo del dashboard (calendario real, no ventanas arbitrarias).
 * @param referenceMonth — primer día del mes de referencia (navegación mensual)
 */
export function getDashboardDateRange(
  filter: DashboardDateFilter,
  referenceMonth: Date = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
): DateRangeStrings | null {
  if (filter === 'all') return null;

  const ref = startOfDay(referenceMonth);
  const year = ref.getFullYear();
  const month = ref.getMonth();

  switch (filter) {
    case 'month': {
      const start = new Date(year, month, 1);
      const end = capEndToToday(lastDayOfMonth(year, month));
      return { startDate: formatDateLocal(start), endDate: formatDateLocal(end) };
    }
    case 'quarter': {
      const quarterIndex = Math.floor(month / 3);
      const start = new Date(year, quarterIndex * 3, 1);
      const end = capEndToToday(lastDayOfMonth(year, quarterIndex * 3 + 2));
      return { startDate: formatDateLocal(start), endDate: formatDateLocal(end) };
    }
    case 'semester': {
      const semesterStartMonth = month < 6 ? 0 : 6;
      const start = new Date(year, semesterStartMonth, 1);
      const end = capEndToToday(lastDayOfMonth(year, semesterStartMonth + 5));
      return { startDate: formatDateLocal(start), endDate: formatDateLocal(end) };
    }
    case 'year': {
      const start = new Date(year, 0, 1);
      const end = capEndToToday(lastDayOfMonth(year, 11));
      return { startDate: formatDateLocal(start), endDate: formatDateLocal(end) };
    }
    default:
      return null;
  }
}

const FILTER_LABELS: Record<DashboardDateFilter, string> = {
  all: 'Todas',
  month: 'Mensual',
  quarter: 'Trimestral',
  semester: 'Semestral',
  year: 'Anual',
};

export function getFilterLabel(filter: DashboardDateFilter): string {
  return FILTER_LABELS[filter];
}

/** Texto visible del rango aplicado */
export function getPeriodRangeLabel(
  filter: DashboardDateFilter,
  referenceMonth: Date
): string {
  const range = getDashboardDateRange(filter, referenceMonth);
  if (!range) return 'Todas las fechas';
  return `${range.startDate} → ${range.endDate}`;
}

export function getQuarterLabel(referenceMonth: Date): string {
  const q = Math.floor(referenceMonth.getMonth() / 3) + 1;
  return `T${q} ${referenceMonth.getFullYear()}`;
}

export function getSemesterLabel(referenceMonth: Date): string {
  return referenceMonth.getMonth() < 6 ? '1.er semestre' : '2.º semestre';
}

/** Avanza o retrocede el periodo según el filtro activo */
export function shiftReferenceMonth(
  referenceMonth: Date,
  filter: DashboardDateFilter,
  direction: -1 | 1
): Date {
  const y = referenceMonth.getFullYear();
  const m = referenceMonth.getMonth();

  switch (filter) {
    case 'year':
      return new Date(y + direction, m, 1);
    case 'semester': {
      const nextMonth = m + direction * 6;
      return new Date(y, nextMonth, 1);
    }
    case 'quarter': {
      const nextMonth = m + direction * 3;
      return new Date(y, nextMonth, 1);
    }
    case 'month':
    default:
      return new Date(y, m + direction, 1);
  }
}

export function isReferenceAtCurrentPeriod(
  referenceMonth: Date,
  filter: DashboardDateFilter
): boolean {
  const now = new Date();
  const y = referenceMonth.getFullYear();
  const m = referenceMonth.getMonth();
  const ny = now.getFullYear();
  const nm = now.getMonth();

  switch (filter) {
    case 'year':
      return y >= ny;
    case 'semester':
      return y > ny || (y === ny && (m < 6 ? 0 : 1) >= (nm < 6 ? 0 : 1));
    case 'quarter':
      return y > ny || (y === ny && Math.floor(m / 3) >= Math.floor(nm / 3));
    case 'month':
    default:
      return y === ny && m === nm;
  }
}
