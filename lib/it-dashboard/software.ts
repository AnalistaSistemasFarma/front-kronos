/**
 * Dashboard TI - «Software» button: software and certificates of each company
 * (table it_software). Pure helpers: options, validation and expiry status.
 */

export const SOFTWARE_KINDS = [
  { value: 'software', label: 'Software' },
  { value: 'certificado', label: 'Certificado' },
  { value: 'dominio', label: 'Dominio' },
] as const;

/** Days before the expiration date when the notification e-mail is sent. */
export const NOTIFY_DAYS_BEFORE = 5;
/** Max notification e-mails per item. */
export const MAX_NOTIFY_EMAILS = 10;

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** «a@x.com, b@y.com» or an array → clean, lower-case, unique list. */
export function parseEmailList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.map(String) : String(value ?? '').split(/[,;\s]+/);
  const out: string[] = [];
  for (const v of raw) {
    const e = v.trim().toLowerCase();
    if (e && !out.includes(e)) out.push(e);
  }
  return out;
}

export const isEmail = (value: string) => EMAIL.test(value) && value.length <= 254;

export const LICENSE_TYPES = [
  { value: 'perpetua', label: 'Perpetua' },
  { value: 'mensual', label: 'Suscripción mensual' },
  { value: 'semestral', label: 'Suscripción semestral' },
  { value: 'anual', label: 'Suscripción anual' },
] as const;

export type SoftwareKind = (typeof SOFTWARE_KINDS)[number]['value'];
export type LicenseType = (typeof LICENSE_TYPES)[number]['value'];

export interface SoftwareInput {
  companyId: number;
  kind: SoftwareKind;
  description: string;
  provider: string;
  purchaseDate: string; // YYYY-MM-DD or ''
  expirationDate: string; // YYYY-MM-DD or ''
  licenses: number | null;
  assignedTo: string;
  cost: number | null;
  licenseType: LicenseType | '';
  /** People notified NOTIFY_DAYS_BEFORE days before the expiration date. */
  notifyEmails: string[];
  /** Account e-mail used to register on the vendor platform (2026-11-27). */
  platformEmail: string;
}

export interface SoftwareItem extends SoftwareInput {
  id: number;
  company: string;
  updatedAt: string | null;
  updatedBy: string | null;
  /** Last notification sent (ISO). */
  noticeSentAt: string | null;
}

export const SOFTWARE_TEXT_LIMITS = { description: 300, provider: 100, assignedTo: 200 } as const;

export const kindLabel = (v: string | null | undefined) => SOFTWARE_KINDS.find((k) => k.value === v)?.label ?? '';
export const licenseTypeLabel = (v: string | null | undefined) =>
  LICENSE_TYPES.find((k) => k.value === v)?.label ?? '';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const asText = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

function asNumber(v: unknown): number | null | 'bad' {
  if (v == null || (typeof v === 'string' && v.trim() === '')) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, ''));
  return Number.isFinite(n) ? n : 'bad';
}

export type SoftwareValidation =
  | { ok: true; value: SoftwareInput }
  | { ok: false; errors: Partial<Record<keyof SoftwareInput, string>> };

/** Validates the body of POST /api/it-dashboard/software and PUT /api/it-dashboard/software/[id]. */
export function validateSoftwareInput(body: unknown): SoftwareValidation {
  const src = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const errors: Partial<Record<keyof SoftwareInput, string>> = {};

  const companyRaw = asNumber(src.companyId);
  const companyId = typeof companyRaw === 'number' && Number.isSafeInteger(companyRaw) && companyRaw > 0 ? companyRaw : 0;
  if (!companyId) errors.companyId = 'Elija la empresa';

  const kind = asText(src.kind);
  if (!SOFTWARE_KINDS.some((k) => k.value === kind)) errors.kind = 'Elija Software, Certificado o Dominio';

  const description = asText(src.description);
  if (!description) errors.description = 'Escriba la descripción';
  else if (description.length > SOFTWARE_TEXT_LIMITS.description)
    errors.description = `Máximo ${SOFTWARE_TEXT_LIMITS.description} caracteres`;

  const provider = asText(src.provider);
  if (provider.length > SOFTWARE_TEXT_LIMITS.provider) errors.provider = `Máximo ${SOFTWARE_TEXT_LIMITS.provider} caracteres`;

  const assignedTo = asText(src.assignedTo);
  if (assignedTo.length > SOFTWARE_TEXT_LIMITS.assignedTo)
    errors.assignedTo = `Máximo ${SOFTWARE_TEXT_LIMITS.assignedTo} caracteres`;

  const purchaseDate = asText(src.purchaseDate);
  if (purchaseDate && !isValidDate(purchaseDate)) errors.purchaseDate = 'Fecha no válida';
  const expirationDate = asText(src.expirationDate);
  if (expirationDate && !isValidDate(expirationDate)) errors.expirationDate = 'Fecha no válida';
  if (purchaseDate && expirationDate && !errors.purchaseDate && !errors.expirationDate && expirationDate < purchaseDate) {
    errors.expirationDate = 'No puede ser anterior a la fecha de compra';
  }

  const licensesRaw = asNumber(src.licenses);
  if (licensesRaw === 'bad' || (typeof licensesRaw === 'number' && (!Number.isInteger(licensesRaw) || licensesRaw < 0 || licensesRaw > 1_000_000))) {
    errors.licenses = 'Número entero de 0 en adelante';
  }
  const costRaw = asNumber(src.cost);
  if (costRaw === 'bad' || (typeof costRaw === 'number' && (costRaw < 0 || costRaw > 1e13))) {
    errors.cost = 'Valor no válido';
  }

  const licenseType = asText(src.licenseType);
  if (licenseType && !LICENSE_TYPES.some((l) => l.value === licenseType)) errors.licenseType = 'Tipo de licencia no válido';

  const platformEmail = asText(src.platformEmail).toLowerCase();
  if (platformEmail && !isEmail(platformEmail)) errors.platformEmail = 'Correo no válido';

  const notifyEmails = parseEmailList(src.notifyEmails);
  const badEmail = notifyEmails.find((e) => !isEmail(e));
  if (badEmail) errors.notifyEmails = `Correo no válido: ${badEmail}`;
  else if (notifyEmails.length > MAX_NOTIFY_EMAILS) errors.notifyEmails = `Máximo ${MAX_NOTIFY_EMAILS} correos`;
  else if (notifyEmails.length && !expirationDate) errors.notifyEmails = 'Para notificar se necesita la fecha de vencimiento';

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      companyId,
      kind: kind as SoftwareKind,
      description,
      provider,
      purchaseDate,
      expirationDate,
      licenses: licensesRaw as number | null,
      assignedTo,
      cost: costRaw === null ? null : Math.round((costRaw as number) * 100) / 100,
      licenseType: licenseType as LicenseType | '',
      notifyEmails,
      platformEmail,
    },
  };
}

/** Whole days from today (Bogotá date, YYYY-MM-DD) to the expiration date. */
export function daysUntil(expirationDate: string, todayIso: string): number {
  const exp = Date.parse(`${expirationDate.slice(0, 10)}T00:00:00Z`);
  const t = Date.parse(`${todayIso.slice(0, 10)}T00:00:00Z`);
  return Math.round((exp - t) / 86400000);
}

/**
 * True when the item must be notified today: it expires within the next
 * NOTIFY_DAYS_BEFORE days (and has not expired) and no notice was sent yet for
 * this expiration date (a renewal with a new date arms it again; a missed run
 * still sends it on the following days).
 */
export function needsExpiryNotice(
  item: { expirationDate: string; notifyEmails: string[]; noticeSentFor: string | null },
  todayIso: string
): boolean {
  if (!item.expirationDate || item.notifyEmails.length === 0) return false;
  if (item.noticeSentFor && item.noticeSentFor.slice(0, 10) === item.expirationDate.slice(0, 10)) return false;
  const d = daysUntil(item.expirationDate, todayIso);
  return d >= 0 && d <= NOTIFY_DAYS_BEFORE;
}

export type ExpiryState = 'expired' | 'soon' | 'ok' | 'none';

/** Days before the expiration date that count as «por vencer». */
export const EXPIRY_WARNING_DAYS = 30;

export function expiryState(expirationDate: string | null | undefined, today: Date = new Date()): ExpiryState {
  if (!expirationDate) return 'none';
  const exp = new Date(`${expirationDate.slice(0, 10)}T00:00:00Z`).getTime();
  if (Number.isNaN(exp)) return 'none';
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = Math.round((exp - t) / 86400000);
  if (days < 0) return 'expired';
  if (days <= EXPIRY_WARNING_DAYS) return 'soon';
  return 'ok';
}
