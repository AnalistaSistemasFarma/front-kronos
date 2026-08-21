import { sanitizeOneDriveName } from '../onedriveName';

/**
 * Construcción de la ruta de OneDrive del módulo de Gestión Documental:
 *   GESTION-DOCUMENTAL/<EMPRESA>/<TIPO>/<CODIGO>/v<version>/<archivo>
 *
 * Carpeta PROPIA (no la de SAPSEND: `SAPSEND/TEC/...`), pero usa el mismo
 * saneador de nombres (lib/onedriveName.ts) para que cada segmento sea válido
 * en OneDrive/SharePoint.
 */

export const DOCUMENT_MANAGEMENT_ROOT = 'GESTION-DOCUMENTAL';

/** Segmentos de carpeta para una versión de un documento (sin el nombre del archivo). */
export function buildDocumentVersionFolderSegments(params: {
  companyName: string;
  documentTypeName: string;
  code: string;
  versionNumber: number;
}): string[] {
  const { companyName, documentTypeName, code, versionNumber } = params;
  return [
    DOCUMENT_MANAGEMENT_ROOT,
    sanitizeOneDriveName(companyName),
    sanitizeOneDriveName(documentTypeName),
    sanitizeOneDriveName(code),
    `v${versionNumber}`,
  ];
}

/** Ruta completa (segmentos + archivo), para guardar en DocumentVersion.onedrive_path. */
export function buildDocumentVersionFullPath(
  params: Parameters<typeof buildDocumentVersionFolderSegments>[0],
  fileName: string
): string {
  const segments = buildDocumentVersionFolderSegments(params);
  return [...segments, sanitizeOneDriveName(fileName)].join('/');
}

const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,48}$/;

/**
 * Valida el código de un documento (p.ej. "POL-GH-001"). No fuerza un prefijo
 * concreto: la nomenclatura por tipo la define el catálogo DocumentType
 * (code_prefix), pero eso es una convención de captura, no una regla que el
 * backend deba imponer todavía.
 */
export function getDocumentCodeError(code: string): string | null {
  const value = (code ?? '').trim();
  if (!value) return 'El código es obligatorio.';
  if (!CODE_PATTERN.test(value)) {
    return 'El código solo admite letras, números, punto, guion y guion bajo (máximo 49 caracteres).';
  }
  return null;
}
