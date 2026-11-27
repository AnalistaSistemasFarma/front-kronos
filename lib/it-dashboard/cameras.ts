/**
 * Dashboard TI - cameras registered inside a DVR / NVR asset
 * (table asset_dvr_camera, several per DVR). Pure helpers.
 */

export const CAMERA_STATUSES = [
  { value: 'funcional', label: 'Funcional', color: 'teal' },
  { value: 'en_falla', label: 'En falla', color: 'orange' },
  { value: 'danado', label: 'Dañado', color: 'red' },
] as const;

export type CameraStatus = (typeof CAMERA_STATUSES)[number]['value'];

export interface CameraInput {
  name: string;
  location: string;
  brand: string;
  status: CameraStatus;
}

export interface Camera extends CameraInput {
  id: number;
  dvrId: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const CAMERA_TEXT_LIMITS = { name: 100, location: 150, brand: 60 } as const;

/** True for asset types that hold cameras (type_asset «DVR», also NVR). */
export function isDvrType(typeName: string | null | undefined): boolean {
  return /\b(dvr|nvr)\b/i.test(typeName ?? '');
}

export const cameraStatusLabel = (v: string | null | undefined) => CAMERA_STATUSES.find((s) => s.value === v)?.label ?? '';
export const cameraStatusColor = (v: string | null | undefined) => CAMERA_STATUSES.find((s) => s.value === v)?.color ?? 'gray';

export type CameraValidation =
  | { ok: true; value: CameraInput }
  | { ok: false; errors: Partial<Record<keyof CameraInput, string>> };

const asText = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/** Validates the body of POST / PUT camera. Name and status are required. */
export function validateCameraInput(body: unknown): CameraValidation {
  const src = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const value = {
    name: asText(src.name),
    location: asText(src.location),
    brand: asText(src.brand),
    status: asText(src.status),
  };
  const errors: Partial<Record<keyof CameraInput, string>> = {};
  if (!value.name) errors.name = 'Escriba el nombre';
  for (const key of Object.keys(CAMERA_TEXT_LIMITS) as Array<keyof typeof CAMERA_TEXT_LIMITS>) {
    if (value[key].length > CAMERA_TEXT_LIMITS[key]) errors[key] = `Máximo ${CAMERA_TEXT_LIMITS[key]} caracteres`;
  }
  if (!CAMERA_STATUSES.some((s) => s.value === value.status)) errors.status = 'Elija Funcional, En falla o Dañado';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { ...value, status: value.status as CameraStatus } };
}

/** Counts per status, for the summary badges. */
export function summarizeCameras(cameras: Array<{ status: string }>): Record<CameraStatus, number> {
  const out: Record<CameraStatus, number> = { funcional: 0, en_falla: 0, danado: 0 };
  for (const c of cameras) if (c.status in out) out[c.status as CameraStatus] += 1;
  return out;
}
