/**
 * Permisos Orion (subprocesos ocultos en el hub).
 *
 * - Preparar firma: marcar PDF, firmantes, ubicaciones, enviar
 * - Firmar documento: obligatorio para confirmar firma (aunque sea firmante)
 * - Legacy `/process/firma/manage` (“Firma digital”) = alias de Preparar
 */

/** @deprecated Usar ORION_FIRMA_PREPARE_URL */
export const ORION_FIRMA_MANAGE_URL = '/process/firma/manage';
/** @deprecated Usar ORION_FIRMA_PREPARE_NAME */
export const ORION_FIRMA_MANAGE_NAME = 'Firma digital';

export const ORION_FIRMA_PREPARE_URL = '/process/firma/prepare';
export const ORION_FIRMA_PREPARE_NAME = 'Preparar firma';

export const ORION_FIRMA_SIGN_URL = '/process/firma/sign';
export const ORION_FIRMA_SIGN_NAME = 'Firmar documento';

/**
 * Categoría o proceso técnico legado de Orion (nombre exacto FIRMA / Firma digital).
 * No oculta el workflow de negocio «Solicitud de firma» (Jurídico).
 */
export function isFirmaRequestCategoryOrProcess(
  category?: string | null,
  process?: string | null
): boolean {
  return isLegacyOrionFirmaLabel(category) || isLegacyOrionFirmaLabel(process);
}

function isLegacyOrionFirmaLabel(value?: string | null): boolean {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return normalized === 'firma' || normalized === 'firma digital';
}

function normalizeSubUrl(url?: string | null): string {
  return String(url || '')
    .toLowerCase()
    .trim();
}

function normalizeSubName(name?: string | null): string {
  return String(name || '')
    .toLowerCase()
    .trim();
}

/** Subproceso de preparación (incluye legacy manage / “Firma digital”). */
export function isOrionFirmaPrepareSubprocess(subprocess: {
  subprocess?: string | null;
  subprocess_url?: string | null;
}): boolean {
  const url = normalizeSubUrl(subprocess.subprocess_url);
  if (
    url === ORION_FIRMA_PREPARE_URL.toLowerCase() ||
    url === ORION_FIRMA_MANAGE_URL.toLowerCase()
  ) {
    return true;
  }
  const name = normalizeSubName(subprocess.subprocess);
  if (name === ORION_FIRMA_PREPARE_NAME.toLowerCase()) return true;
  if (name.includes('preparar firma')) return true;
  // Legacy
  return name.includes('firma digital') && (url.includes('/firma/') || !url);
}

/** @deprecated Alias de isOrionFirmaPrepareSubprocess */
export function isOrionFirmaManageSubprocess(subprocess: {
  subprocess?: string | null;
  subprocess_url?: string | null;
}): boolean {
  return isOrionFirmaPrepareSubprocess(subprocess);
}

/** Subproceso solo-firmar. */
export function isOrionFirmaSignSubprocess(subprocess: {
  subprocess?: string | null;
  subprocess_url?: string | null;
}): boolean {
  const url = normalizeSubUrl(subprocess.subprocess_url);
  if (url === ORION_FIRMA_SIGN_URL.toLowerCase()) return true;
  const name = normalizeSubName(subprocess.subprocess);
  return name === ORION_FIRMA_SIGN_NAME.toLowerCase() || name.includes('firmar documento');
}

/**
 * Subprocesos que no deben mostrarse como tarjetas del hub
 * (permisos técnicos / invisibles).
 */
export function isHubHiddenSubprocess(params: {
  url?: string | null;
  name?: string | null;
}): boolean {
  const sub = { subprocess: params.name, subprocess_url: params.url };
  if (isOrionFirmaPrepareSubprocess(sub) || isOrionFirmaSignSubprocess(sub)) return true;
  // Evitar import circular: detectar por URL/nombre aquí también.
  const url = normalizeSubUrl(params.url);
  const name = normalizeSubName(params.name);
  return (
    url === '/process/request-general/delete-attachments' ||
    url.includes('/delete-attachments') ||
    name === 'eliminar adjuntos' ||
    name.includes('eliminar adjuntos') ||
    url === '/process/valentine-wall' ||
    url.includes('/valentine-wall') ||
    name === 'dosis de amor y amistad' ||
    name.includes('dosis de amor')
  );
}
