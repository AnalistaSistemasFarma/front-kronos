export type DashboardDateFilter = 'month' | 'quarter' | 'semester' | 'year' | 'all';

export interface DateRangeStrings {
  startDate: string;
  endDate: string;
}

/**
 * Interpreta fechas del API/SQL como día de calendario local (sin desfase UTC).
 * Acepta ISO con hora, solo YYYY-MM-DD u objetos Date.
 */
export function parseCalendarDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const datePart = trimmed.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    const [y, m, d] = datePart.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const parsed = new Date(trimmed.includes('T') ? trimmed : `${trimmed}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
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

/** Primer día del periodo (mes / trimestre / semestre / año) según el mes de referencia. */
function getPeriodStart(filter: DashboardDateFilter, referenceMonth: Date): Date {
  const ref = startOfDay(referenceMonth);
  const year = ref.getFullYear();
  const month = ref.getMonth();

  switch (filter) {
    case 'month':
      return new Date(year, month, 1);
    case 'quarter':
      return new Date(year, Math.floor(month / 3) * 3, 1);
    case 'semester':
      return new Date(year, month < 6 ? 0 : 6, 1);
    case 'year':
      return new Date(year, 0, 1);
    default:
      return ref;
  }
}

/** Garantiza startDate <= endDate y que el rango no quede vacío por periodos futuros. */
function finalizeRange(start: Date, end: Date): DateRangeStrings {
  const today = startOfDay(new Date());
  const startDay = startOfDay(start);
  let endDay = startOfDay(capEndToToday(end));

  if (startDay > today) {
    return {
      startDate: formatDateLocal(today),
      endDate: formatDateLocal(today),
    };
  }
  if (endDay < startDay) {
    endDay = startDay;
  }
  return {
    startDate: formatDateLocal(startDay),
    endDate: formatDateLocal(endDay),
  };
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
    case 'month':
      return finalizeRange(
        new Date(year, month, 1),
        lastDayOfMonth(year, month)
      );
    case 'quarter': {
      const quarterIndex = Math.floor(month / 3);
      return finalizeRange(
        new Date(year, quarterIndex * 3, 1),
        lastDayOfMonth(year, quarterIndex * 3 + 2)
      );
    }
    case 'semester': {
      const semesterStartMonth = month < 6 ? 0 : 6;
      return finalizeRange(
        new Date(year, semesterStartMonth, 1),
        lastDayOfMonth(year, semesterStartMonth + 5)
      );
    }
    case 'year':
      return finalizeRange(new Date(year, 0, 1), lastDayOfMonth(year, 11));
    default:
      return null;
  }
}

/** Ajusta el mes de referencia si apunta a un periodo que aún no ha comenzado. */
export function clampReferenceToPresent(
  referenceMonth: Date,
  filter: DashboardDateFilter
): Date {
  if (filter === 'all') return referenceMonth;
  const start = getPeriodStart(filter, referenceMonth);
  const today = startOfDay(new Date());
  if (start <= today) return startOfDay(referenceMonth);
  return new Date(today.getFullYear(), today.getMonth(), 1);
}

/** true si aún se puede avanzar a un periodo que ya haya comenzado (inicio <= hoy). */
export function canShiftReferenceForward(
  referenceMonth: Date,
  filter: DashboardDateFilter
): boolean {
  if (filter === 'all') return false;
  const nextRef = shiftReferenceMonth(referenceMonth, filter, 1);
  const nextStart = getPeriodStart(filter, nextRef);
  return nextStart <= startOfDay(new Date());
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
  return !canShiftReferenceForward(referenceMonth, filter);
}
