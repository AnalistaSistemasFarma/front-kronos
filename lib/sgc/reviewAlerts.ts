import { formatCalendarDate, toCalendarDate } from './review';

/**
 * Vencimientos del SGC — avisos anticipados y estado del calendario.
 * Funciones PURAS (probadas con Vitest y, con reloj controlado, contra un SQL
 * Server real en tests/integration/sgc/vencimientos.integration.test.ts).
 *
 * Pedido de Nicolás (2026-09-30 19:42): avisos por defecto a 60, 30, 15 y 7
 * días y el día del vencimiento, configurables por tipo documental y,
 * excepcionalmente, por documento. Un documento vencido SIGUE VIGENTE y
 * visible, marcado «vencido — en revisión», y se escala a Calidad (aviso
 * repetido cada `overdueEveryDays` días mientras siga vencido).
 *
 * Regla de «una sola vez»: cada aviso tiene una clave (versión + fecha de
 * vencimiento + clase + días). Si el programador no corrió el día exacto de
 * un aviso, al correr se envía SOLO el más urgente que ya tocaba y los
 * anteriores quedan como «omitidos» (constancia), para no mandar varios
 * avisos atrasados de golpe.
 */

export const SGC_DEFAULT_ALERT_OFFSETS: readonly number[] = [60, 30, 15, 7, 0];
export const SGC_DEFAULT_OVERDUE_EVERY_DAYS = 7;
export const SGC_DEFAULT_READING_REMINDER_DAYS = 7;
export const SGC_MAX_ALERT_OFFSET = 365;

export type SgcAlertKind = 'anticipado' | 'vencimiento' | 'vencido';

export interface SgcAlertPlanItem {
  key: string;
  kind: SgcAlertKind;
  /** Días antes del vencimiento (anticipado/vencimiento) o días de vencido (vencido). */
  offsetDays: number;
  /** Fecha (YYYY-MM-DD) en que le correspondía salir. */
  scheduledFor: string;
}

export interface SgcAlertPlan {
  send: SgcAlertPlanItem | null;
  omit: SgcAlertPlanItem[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Días de calendario de `from` a `to` (positivo si `to` es posterior). */
export function daysBetween(from: Date | string, to: Date | string): number {
  return Math.round((toCalendarDate(to).getTime() - toCalendarDate(from).getTime()) / DAY_MS);
}

export function addDays(date: Date | string, days: number): Date {
  return new Date(toCalendarDate(date).getTime() + days * DAY_MS);
}

/**
 * Normaliza los días de anticipación: enteros entre 0 y 365, sin repetir, de
 * mayor a menor, entre 1 y 10 valores. Devuelve el error para el usuario o la
 * lista lista para guardar.
 */
export function normalizeAlertOffsets(raw: unknown): { offsets: number[] } | { error: string } {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    list = raw
      .split(/[,;\s]+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .map(Number);
  }
  if (!Array.isArray(list) || list.length === 0) return { error: 'Indique al menos un día de aviso (por ejemplo 60, 30, 15, 7, 0).' };
  const nums = list.map((x) => Number(x));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > SGC_MAX_ALERT_OFFSET)) {
    return { error: `Los días de aviso deben ser enteros entre 0 y ${SGC_MAX_ALERT_OFFSET} (0 = el día del vencimiento).` };
  }
  const offsets = [...new Set(nums)].sort((a, b) => b - a);
  if (offsets.length > 10) return { error: 'Máximo 10 avisos por documento.' };
  return { offsets };
}

/** Lee el JSON guardado; si está dañado, usa los avisos por defecto (nunca deja de avisar). */
export function parseStoredOffsets(json: string | null | undefined): number[] {
  try {
    const r = normalizeAlertOffsets(JSON.parse(json ?? ''));
    return 'offsets' in r ? r.offsets : [...SGC_DEFAULT_ALERT_OFFSETS];
  } catch {
    return [...SGC_DEFAULT_ALERT_OFFSETS];
  }
}

export function alertKey(idVersion: number, dueDate: Date | string, kind: SgcAlertKind, offsetDays: number): string {
  return `v${idVersion}|${formatCalendarDate(dueDate)}|${kind}|${offsetDays}`;
}

function item(idVersion: number, due: Date, kind: SgcAlertKind, offsetDays: number): SgcAlertPlanItem {
  const scheduled = kind === 'vencido' ? addDays(due, offsetDays) : addDays(due, -offsetDays);
  return { key: alertKey(idVersion, due, kind, offsetDays), kind, offsetDays, scheduledFor: formatCalendarDate(scheduled)! };
}

/**
 * Qué aviso sale HOY para una versión vigente con su fecha de vencimiento.
 * `already` = claves ya registradas (enviadas u omitidas).
 */
export function planReviewAlert(input: {
  idVersion: number;
  dueDate: Date | string;
  today: Date | string;
  offsets: readonly number[];
  overdueEveryDays: number;
  already: ReadonlySet<string>;
}): SgcAlertPlan {
  const due = toCalendarDate(input.dueDate);
  const daysLeft = daysBetween(input.today, due);
  const offsets = [...new Set(input.offsets)].sort((a, b) => b - a);
  const every = Number.isInteger(input.overdueEveryDays) && input.overdueEveryDays > 0 ? input.overdueEveryDays : SGC_DEFAULT_OVERDUE_EVERY_DAYS;

  // Avisos anticipados (y el del día, offset 0) cuya fecha ya llegó.
  const reached = offsets.filter((o) => o >= daysLeft).map((o) => item(input.idVersion, due, o === 0 ? 'vencimiento' : 'anticipado', o));
  let candidate: SgcAlertPlanItem | null = null;
  if (daysLeft >= 0) {
    // El más urgente de los que ya tocaban: el de menor anticipación.
    candidate = reached.length ? reached[reached.length - 1] : null;
  } else {
    // Vencido: el aviso del día (aunque llegue tarde) y luego cada `every` días, escalado a Calidad.
    const overdue = -daysLeft;
    const cycle = Math.floor(overdue / every);
    candidate = cycle >= 1 ? item(input.idVersion, due, 'vencido', cycle * every) : item(input.idVersion, due, 'vencimiento', 0);
  }

  const send = candidate && !input.already.has(candidate.key) ? candidate : null;
  const omit = reached.filter((r) => r.key !== candidate?.key && !input.already.has(r.key));
  if (daysLeft < 0 && candidate?.kind === 'vencido') {
    const dayOf = item(input.idVersion, due, 'vencimiento', 0);
    if (!input.already.has(dayOf.key) && !omit.some((o) => o.key === dayOf.key)) omit.push(dayOf);
  }
  return { send, omit };
}

// ---------------------------------------------------------------------------
// Estado del calendario
// ---------------------------------------------------------------------------

export type SgcCalendarState = 'al_dia' | 'proximo' | 'vencido' | 'en_revision' | 'sin_fecha';

export const SGC_CALENDAR_STATE_LABELS: Record<SgcCalendarState, string> = {
  al_dia: 'Al día',
  proximo: 'Próximo a vencer',
  vencido: 'Vencido — en revisión',
  en_revision: 'En revisión',
  sin_fecha: 'Sin fecha',
};

/** Colores de Mantine por estado (GSS/SynerLink): verde, amarillo, rojo y azul. */
export const SGC_CALENDAR_STATE_COLORS: Record<SgcCalendarState, string> = {
  al_dia: 'teal',
  proximo: 'yellow',
  vencido: 'red',
  en_revision: 'blue',
  sin_fecha: 'gray',
};

/**
 * Estado de un documento en el calendario:
 *   vencido     → llegó la fecha (sigue vigente y visible, «vencido — en revisión»),
 *                 aunque ya tenga una solicitud en curso
 *   en_revision → no ha vencido y ya tiene una solicitud de nueva versión o modificación en curso
 *   proximo     → dentro de la ventana del primer aviso
 *   al_dia      → el resto
 */
export function getCalendarState(input: {
  dueDate: Date | string | null | undefined;
  today: Date | string;
  firstAlertDays: number;
  hasOpenRequest: boolean;
}): SgcCalendarState {
  if (!input.dueDate) return 'sin_fecha';
  const left = daysBetween(input.today, input.dueDate);
  if (left <= 0) return 'vencido';
  if (input.hasOpenRequest) return 'en_revision';
  if (left <= Math.max(0, input.firstAlertDays)) return 'proximo';
  return 'al_dia';
}

// ---------------------------------------------------------------------------
// Configuración efectiva (documento > tipo documental > empresa > por defecto)
// ---------------------------------------------------------------------------

export interface SgcAlertConfigRow {
  scope: string;
  idDocumentType: number | null;
  idDocument: number | null;
  offsets: number[];
  overdueEveryDays: number;
  readingReminderDays: number | null;
  emailEnabled: boolean;
  extraEmails: string[];
  isActive: boolean;
}

export interface SgcEffectiveAlertConfig {
  source: 'documento' | 'tipo' | 'empresa' | 'defecto';
  offsets: number[];
  overdueEveryDays: number;
  emailEnabled: boolean;
  /** Destinatarios adicionales: los de la empresa, más los del tipo y del documento. */
  extraEmails: string[];
}

export function resolveAlertConfig(rows: readonly SgcAlertConfigRow[], target: { idDocumentType: number; idDocument: number }): SgcEffectiveAlertConfig {
  const active = rows.filter((r) => r.isActive);
  const company = active.find((r) => r.scope === 'empresa') ?? null;
  const type = active.find((r) => r.scope === 'tipo' && r.idDocumentType === target.idDocumentType) ?? null;
  const doc = active.find((r) => r.scope === 'documento' && r.idDocument === target.idDocument) ?? null;
  const best = doc ?? type ?? company;
  const extras = [...new Set([company, type, doc].flatMap((r) => r?.extraEmails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  return {
    source: doc ? 'documento' : type ? 'tipo' : company ? 'empresa' : 'defecto',
    offsets: best ? best.offsets : [...SGC_DEFAULT_ALERT_OFFSETS],
    overdueEveryDays: best ? best.overdueEveryDays : SGC_DEFAULT_OVERDUE_EVERY_DAYS,
    // El correo lo apaga o enciende la empresa (una sola llave para toda la empresa).
    emailEnabled: company ? company.emailEnabled : true,
    extraEmails: extras,
  };
}

/** Correos adicionales: lista de correos válidos, sin repetir, máximo 20. */
export function normalizeExtraEmails(raw: unknown): { emails: string[] } | { error: string } {
  const list = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === 'string'
      ? raw.split(/[,;\s]+/)
      : raw === null || raw === undefined
        ? []
        : null;
  if (!list) return { error: 'Los destinatarios adicionales deben ser una lista de correos.' };
  const emails = [...new Set(list.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const bad = emails.find((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (bad) return { error: `Correo inválido: ${bad}` };
  if (emails.length > 20) return { error: 'Máximo 20 destinatarios adicionales.' };
  return { emails };
}

// ---------------------------------------------------------------------------
// Textos de los avisos
// ---------------------------------------------------------------------------

export const SGC_ALERT_TITLES: Record<SgcAlertKind, string> = {
  anticipado: 'Documento próximo a vencer · SynerLink',
  vencimiento: 'Documento vence hoy · SynerLink',
  vencido: 'Documento vencido — en revisión (escalado a Calidad) · SynerLink',
};

export function alertBody(input: { kind: SgcAlertKind; offsetDays: number; code: string; versionNumber: number; title: string; dueDate: string; openRequestId: number | null }): string {
  const doc = `${input.code} V${input.versionNumber} · ${input.title}`;
  const when =
    input.kind === 'anticipado'
      ? `vence en ${input.offsetDays} día${input.offsetDays === 1 ? '' : 's'} (${input.dueDate})`
      : input.kind === 'vencimiento'
        ? `vence hoy (${input.dueDate})`
        : `está vencido desde el ${input.dueDate} (${input.offsetDays} días); sigue vigente y queda «vencido — en revisión»`;
  const next = input.openRequestId ? ` Ya tiene la solicitud #${input.openRequestId} en curso.` : ' Inicie la solicitud de nueva versión o confirme su revisión.';
  return `${doc}: la revisión ${when}.${next}`.slice(0, 300);
}
