import { isBusinessDay } from '../requests-general/sla';

/**
 * COMMITTED DATES of a table field of a flow (2026-11-26; Calidad OLP meeting 2026-11-23: «cada acción tiene una
 * fecha comprometida; si no se va a cumplir, una sola prórroga; si se incumple, no conforme»). Pure rules, tested.
 *
 *  - the committed date of a row cannot be changed once written (the extension column is used instead);
 *  - only ONE extension per row (configurable), later than the committed date and requested before it expires;
 *  - the daily job warns N business days before the effective date (extension or committed) and when it is overdue,
 *    unless the row status says it is done.
 */

export interface DateTrackingConfig {
  id_form_field: number;
  date_col: string;
  extension_col: string | null;
  status_col: string | null;
  done_value: string | null;
  warn_business_days: number;
  single_extension: boolean;
}

export type Row = Record<string, unknown>;

const iso = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim().slice(0, 10) : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

/** Error to show if the change of the table breaks the committed-date rules; null if it is valid. */
export function checkCommittedDates(before: Row[], after: Row[], cfg: DateTrackingConfig, today: string): string | null {
  for (let i = 0; i < after.length; i++) {
    const prev = before[i];
    const next = after[i] ?? {};
    const n = i + 1;
    const date = iso(next[cfg.date_col]);
    if (prev) {
      const prevDate = iso(prev[cfg.date_col]);
      if (prevDate && date !== prevDate) return `Fila ${n}: la fecha comprometida no se cambia; si no se alcanza, use la prórroga.`;
    }
    if (!cfg.extension_col) continue;
    const ext = iso(next[cfg.extension_col]);
    const prevExt = prev ? iso(prev[cfg.extension_col]) : null;
    if (prevExt && ext !== prevExt && cfg.single_extension) return `Fila ${n}: solo se permite una prórroga por acción.`;
    if (ext && ext !== prevExt) {
      if (!date) return `Fila ${n}: escriba primero la fecha comprometida.`;
      if (ext <= date) return `Fila ${n}: la nueva fecha debe ser posterior a la fecha comprometida.`;
      if (today > date) return `Fila ${n}: la prórroga se pide antes de que venza la fecha comprometida (${date}).`;
    }
  }
  // Removing a row that already had a committed date would hide a commitment.
  for (let i = after.length; i < before.length; i++) {
    if (iso(before[i]?.[cfg.date_col])) return `Fila ${i + 1}: una acción con fecha comprometida no se borra; márquela en su estado.`;
  }
  return null;
}

/** Business days from `from` (exclusive) to `to` (inclusive); negative if `to` is before `from`. */
export function businessDaysUntil(from: string, to: string): number {
  if (to === from) return 0;
  const sign = to > from ? 1 : -1;
  const d = new Date(`${from}T12:00:00Z`);
  const end = `${to}`;
  let n = 0;
  for (let guard = 0; guard < 800; guard++) {
    d.setUTCDate(d.getUTCDate() + sign);
    const k = d.toISOString().slice(0, 10);
    if (isBusinessDay(new Date(`${k}T12:00:00`))) n += sign;
    if (k === end) break;
  }
  return n;
}

export interface TrackedRow {
  index: number;
  label: string;
  due: string;
  extended: boolean;
  businessDaysLeft: number;
}

/** Rows that are overdue or about to expire (not done). */
export function classifyRows(rows: Row[], cfg: DateTrackingConfig, today: string): { overdue: TrackedRow[]; dueSoon: TrackedRow[] } {
  const overdue: TrackedRow[] = [];
  const dueSoon: TrackedRow[] = [];
  rows.forEach((r, index) => {
    const status = cfg.status_col ? String(r[cfg.status_col] ?? '').trim().toLowerCase() : '';
    if (cfg.done_value && status === cfg.done_value.trim().toLowerCase()) return;
    const ext = cfg.extension_col ? iso(r[cfg.extension_col]) : null;
    const due = ext ?? iso(r[cfg.date_col]);
    if (!due) return;
    const label = String(Object.values(r).find((v) => typeof v === 'string' && v.trim() && !iso(v)) ?? `Acción ${index + 1}`).slice(0, 80);
    const left = businessDaysUntil(today, due);
    const row = { index, label, due, extended: Boolean(ext), businessDaysLeft: left };
    if (due < today) overdue.push(row);
    else if (left <= cfg.warn_business_days) dueSoon.push(row);
  });
  return { overdue, dueSoon };
}
