/**
 * Acceso / naming legacy Orion.
 *
 * La gestión de firma ya no depende del subproceso “Firma digital” ni de
 * categoría/proceso FIRMA: el creador marca PDFs “Para firmar” en cualquier
 * solicitud normal. Estas constantes se usan solo para:
 * - Ocultar categoría/proceso FIRMA en listados de creación
 * - Ocultar el subproceso de permiso en el hub
 * - Compat con seeds / admin antiguos
 */

export const ORION_FIRMA_MANAGE_URL = '/process/firma/manage';
export const ORION_FIRMA_MANAGE_NAME = 'Firma digital';

/** Categoría o proceso legacy de firma (ocultar en UI de creación). */
export function isFirmaRequestCategoryOrProcess(
  category?: string | null,
  process?: string | null
): boolean {
  return /FIRMA/i.test(String(category || '')) || /FIRMA/i.test(String(process || ''));
}

/** Subproceso de permiso “Firma digital” (oculto en el hub de Procesos). */
export function isOrionFirmaManageSubprocess(subprocess: {
  subprocess?: string | null;
  subprocess_url?: string | null;
}): boolean {
  const url = String(subprocess.subprocess_url || '')
    .toLowerCase()
    .trim();
  if (url === ORION_FIRMA_MANAGE_URL.toLowerCase()) return true;
  const name = String(subprocess.subprocess || '')
    .toLowerCase()
    .trim();
  return name.includes('firma digital') && (url.includes('/firma/') || !url);
}

/**
 * Subprocesos que no deben mostrarse como tarjetas del hub
 * (permisos técnicos / invisibles).
 */
export function isHubHiddenSubprocess(params: {
  url?: string | null;
  name?: string | null;
}): boolean {
  return isOrionFirmaManageSubprocess({
    subprocess: params.name,
    subprocess_url: params.url,
  });
}
