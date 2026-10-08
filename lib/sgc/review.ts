/**
 * Vencimiento de los documentos del SGC — funciones PURAS.
 *
 * Regla (reunión del 2026-09-30): cada documento vigente se revisa cada 3
 * años (36 meses, configurable por tipo documental) y se alerta 2 meses antes.
 * Aquí solo se CALCULA; las alertas y recordatorios programados llegan en el
 * Sprint 5 (sobre lib/scheduler).
 *
 * Las fechas se manejan como FECHAS DE CALENDARIO (sin hora) en UTC, que es
 * como las guarda SQL Server en columnas DATE.
 */

export type SgcReviewState = 'al_dia' | 'por_vencer' | 'vencido' | 'sin_fecha';

export const SGC_REVIEW_STATE_LABELS: Record<SgcReviewState, string> = {
  al_dia: 'Al día',
  por_vencer: 'Revisión próxima',
  vencido: 'Vencido — en revisión',
  sin_fecha: 'Sin fecha de revisión',
};

/** Fecha de calendario (medianoche UTC) de un Date o de un texto YYYY-MM-DD. */
export function toCalendarDate(value: Date | string): Date {
  if (typeof value === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
    if (!m) throw new Error(`Fecha inválida: ${value}`);
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
      throw new Error(`Fecha inválida: ${value}`);
    }
    return d;
  }
  if (Number.isNaN(value.getTime())) throw new Error('Fecha inválida');
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

/**
 * Suma (o resta) meses de calendario. Si el día no existe en el mes destino
 * se usa el último día de ese mes (31-ene + 1 mes = 28/29-feb).
 */
export function addCalendarMonths(date: Date, months: number): Date {
  const d = toCalendarDate(date);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return target;
}

/** Fecha de la próxima revisión: fecha de vigencia + meses de revisión. */
export function computeReviewDueDate(effectiveDate: Date | string, reviewMonths: number): Date {
  if (!Number.isInteger(reviewMonths) || reviewMonths < 1) throw new Error('Los meses de revisión deben ser un entero positivo.');
  return addCalendarMonths(toCalendarDate(effectiveDate), reviewMonths);
}

/** Desde cuándo se alerta: fecha de revisión − meses de anticipación. */
export function computeReviewAlertDate(reviewDueDate: Date | string, alertMonths: number): Date {
  if (!Number.isInteger(alertMonths) || alertMonths < 0) throw new Error('Los meses de alerta deben ser un entero no negativo.');
  return addCalendarMonths(toCalendarDate(reviewDueDate), -alertMonths);
}

/** Estado de revisión de un documento en la fecha `now`. */
export function getReviewState(
  reviewDueDate: Date | string | null | undefined,
  alertMonths: number,
  now: Date = new Date()
): SgcReviewState {
  if (!reviewDueDate) return 'sin_fecha';
  const due = toCalendarDate(reviewDueDate);
  const today = toCalendarDate(now);
  if (today.getTime() >= due.getTime()) return 'vencido';
  if (today.getTime() >= computeReviewAlertDate(due, alertMonths).getTime()) return 'por_vencer';
  return 'al_dia';
}

/** YYYY-MM-DD de una fecha de calendario. */
export function formatCalendarDate(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  return toCalendarDate(date).toISOString().slice(0, 10);
}
