/**
 * Utilidades para nombres de archivo compatibles con OneDrive / SharePoint.
 *
 * El nombre de cada documento (file_label) se usa como prefijo del archivo subido
 * a OneDrive (`Etiqueta - archivo.ext`, vía Microsoft Graph items/{id}:/{nombre}:/content).
 * OneDrive/SharePoint rechaza nombres con: \ / : * ? " < > | # %
 * o que empiezan/terminan con espacio o punto.
 */

// Caracteres que rompen la subida a OneDrive/SharePoint
export const INVALID_ONEDRIVE_CHARS = /[\\/:*?"<>|#%]/;

// Mismos caracteres, en modo global, para sanear (espacios y guiones se conservan)
const INVALID_ONEDRIVE_CHARS_GLOBAL = /[\\/:*?"<>|#%]/g;

/**
 * Valida una etiqueta de documento. Devuelve un mensaje de error si es inválida,
 * o `null` si es válida (o vacía: el vacío se controla aparte con el botón/trim).
 */
export function getFileLabelError(label: string): string | null {
  const raw = label ?? '';
  const value = raw.trim();

  // Vacío no se reporta aquí (lo maneja el trim()/botón deshabilitado)
  if (!value) return null;

  if (INVALID_ONEDRIVE_CHARS.test(value)) {
    return 'No se permiten estos caracteres: \\ / : * ? " < > | # %';
  }

  if (value.startsWith('.') || value.endsWith('.')) {
    return 'No puede empezar ni terminar con punto.';
  }

  if (raw !== value) {
    return 'No puede empezar ni terminar con espacios.';
  }

  return null;
}

/**
 * Limpia un nombre para que sea seguro en OneDrive/SharePoint: quita caracteres
 * inválidos, colapsa espacios y recorta puntos/espacios iniciales y finales.
 * Conserva los puntos internos (extensión del archivo).
 */
export function sanitizeOneDriveName(name: string): string {
  return (name ?? '')
    .replace(INVALID_ONEDRIVE_CHARS_GLOBAL, '')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim();
}
