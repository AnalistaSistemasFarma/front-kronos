/**
 * Permiso “Eliminar adjuntos” (subproceso oculto en el hub).
 * Se asigna en Administración → Usuarios.
 */

export const DELETE_ATTACHMENTS_URL = '/process/request-general/delete-attachments';
export const DELETE_ATTACHMENTS_NAME = 'Eliminar adjuntos';

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

export function isDeleteAttachmentsSubprocess(subprocess: {
  subprocess?: string | null;
  subprocess_url?: string | null;
}): boolean {
  const url = normalizeSubUrl(subprocess.subprocess_url);
  if (url === DELETE_ATTACHMENTS_URL.toLowerCase()) return true;
  if (url.includes('/delete-attachments')) return true;
  const name = normalizeSubName(subprocess.subprocess);
  return name === DELETE_ATTACHMENTS_NAME.toLowerCase() || name.includes('eliminar adjuntos');
}
