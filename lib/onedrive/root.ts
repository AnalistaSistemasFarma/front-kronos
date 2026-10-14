/**
 * Carpeta raíz de los adjuntos de SynerLink en OneDrive.
 *
 * Producción usa `SAPSEND` (SAPSEND/TEC/<SG|MA>/<Request|Ticket>-<id>). Testing y local deben
 * definir ONEDRIVE_ROOT_FOLDER (p. ej. `SAPSEND-PRUEBAS`) en su .env: como su base es copia de
 * producción, los números de solicitud coinciden y sin esto las pruebas caen en las carpetas
 * de las solicitudes reales.
 *
 * Con una raíz distinta de `SAPSEND` el entorno es una "zona de pruebas": ahí se habilita el
 * botón para borrar adjuntos de prueba (y el servidor solo borra dentro de esa raíz).
 *
 * Se expone en next.config (env) para que también la lean los componentes del navegador.
 */

export const PRODUCTION_ONEDRIVE_ROOT = 'SAPSEND';

/** Solo letras, números, guion, guion bajo y punto: evita rutas raras o con barras. */
const SAFE_ROOT = /^[A-Za-z0-9._-]{1,64}$/;

export function oneDriveRoot(): string {
  const value = String(process.env.ONEDRIVE_ROOT_FOLDER || '').trim();
  return SAFE_ROOT.test(value) ? value : PRODUCTION_ONEDRIVE_ROOT;
}

/** true en testing/local con su propia carpeta: nunca en producción. */
export function isOneDriveSandbox(): boolean {
  return oneDriveRoot().toUpperCase() !== PRODUCTION_ONEDRIVE_ROOT;
}

/**
 * ¿El archivo (por el parentReference.path de Graph, p. ej. "/drive/root:/X/TEC/SG/Request-5")
 * está EXACTAMENTE en la carpeta `segments`, y esa carpeta cuelga de una raíz de pruebas?
 * El nombre Request-<id> existe igual en producción, por eso se compara la ruta completa.
 */
export function isInSandboxFolder(parentPath: string | null | undefined, segments: string[]): boolean {
  const root = String(segments[0] || '').trim();
  if (!root || root.toUpperCase() === PRODUCTION_ONEDRIVE_ROOT) return false;
  const path = String(parentPath || '').toLowerCase();
  return path.endsWith(`:/${segments.join('/')}`.toLowerCase());
}
