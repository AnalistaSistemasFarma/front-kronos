/**
 * Dashboard TI - maintenance of computers (table asset_maintenance). Every
 * registered maintenance is kept as a log row (who, when, date and kind).
 */

export const MAINTENANCE_KINDS = [
  { value: 'preventivo', label: 'Preventivo', color: 'blue' },
  { value: 'correctivo', label: 'Correctivo', color: 'orange' },
] as const;

export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number]['value'];

export interface MaintenanceInput {
  date: string; // YYYY-MM-DD
  kind: MaintenanceKind;
  notes: string;
}

export interface MaintenanceLog extends MaintenanceInput {
  id: number;
  assetId: number;
  createdAt: string | null;
  createdBy: string | null;
}

export const MAINTENANCE_NOTES_LIMIT = 500;

/** True for asset types that are computers (type_asset «COMPUTADORES»). */
export function isComputerType(typeName: string | null | undefined): boolean {
  const key = (typeName ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return /computador|portatil|laptop|desktop|equipo de computo/.test(key);
}

export const maintenanceKindLabel = (v: string | null | undefined) =>
  MAINTENANCE_KINDS.find((k) => k.value === v)?.label ?? '';
export const maintenanceKindColor = (v: string | null | undefined) =>
  MAINTENANCE_KINDS.find((k) => k.value === v)?.color ?? 'gray';

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export type MaintenanceValidation =
  | { ok: true; value: MaintenanceInput }
  | { ok: false; errors: Partial<Record<keyof MaintenanceInput, string>> };

const asText = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/** Validates POST /api/it-dashboard/assets/[id]/maintenance. Date and kind are required. */
export function validateMaintenanceInput(body: unknown): MaintenanceValidation {
  const src = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const value = { date: asText(src.date), kind: asText(src.kind), notes: asText(src.notes) };
  const errors: Partial<Record<keyof MaintenanceInput, string>> = {};
  if (!value.date) errors.date = 'Elija la fecha';
  else if (!isValidDate(value.date)) errors.date = 'Fecha no válida';
  else if (value.date < '2000-01-01' || value.date > '2100-12-31') errors.date = 'Fecha fuera de rango';
  if (!MAINTENANCE_KINDS.some((k) => k.value === value.kind)) errors.kind = 'Elija Preventivo o Correctivo';
  if (value.notes.length > MAINTENANCE_NOTES_LIMIT) errors.notes = `Máximo ${MAINTENANCE_NOTES_LIMIT} caracteres`;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { ...value, kind: value.kind as MaintenanceKind } };
}
