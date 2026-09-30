import { createHash } from 'node:crypto';
import { sanitizeOneDriveName } from '../onedriveName';
import { SGC_MAX_FILE_BYTES } from './constants';

/**
 * Almacenamiento de los archivos del SGC — funciones PURAS.
 *
 * Carpeta PROPIA de cada empresa (plan, principio 1), bajo la raíz
 * `storage_root` de sgc.company_config (OLP → "SGC/OLP"):
 *
 *   <storage_root>/<TIPO>/<CODIGO>/v<n>/<archivo>
 *
 * Nunca comparte carpeta con SAPSEND, solicitudes ni Orión. La subida usa la
 * utilidad compartida lib/onedrive/graphFolderUpload.ts (permitida por el plan).
 */

/** Segmentos de la carpeta de una versión (sin el nombre del archivo). */
export function buildVersionFolderSegments(params: {
  storageRoot: string;
  documentTypeCode: string;
  code: string;
  versionNumber: number;
}): string[] {
  const root = params.storageRoot
    .split('/')
    .map((s) => sanitizeOneDriveName(s))
    .filter(Boolean);
  if (root.length === 0) throw new Error('La empresa no tiene carpeta raíz del SGC (storage_root).');
  if (!Number.isInteger(params.versionNumber) || params.versionNumber < 1) throw new Error('Número de versión inválido.');
  return [
    ...root,
    sanitizeOneDriveName(params.documentTypeCode),
    sanitizeOneDriveName(params.code),
    `v${params.versionNumber}`,
  ];
}

/**
 * Nombre del archivo en OneDrive: «<CODIGO> V<n>.<ext>». Se normaliza para no
 * depender del nombre con que llegó (evita duplicados y caracteres inválidos).
 */
export function buildVersionFileName(code: string, versionNumber: number, originalName: string, fallbackExt: string): string {
  const ext = (/\.([A-Za-z0-9]{1,5})$/.exec(originalName ?? '')?.[1] ?? fallbackExt).toLowerCase();
  return sanitizeOneDriveName(`${code} V${versionNumber}.${ext}`);
}

/** SHA-256 en hexadecimal (64 caracteres) del contenido. */
export function sha256Hex(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // .docx es un ZIP
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]; // .doc antiguo

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((b, i) => bytes[i] === b);
}

/** true si el contenido es un PDF (por su firma, no por la extensión). */
export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > PDF_MAGIC.length && startsWith(bytes, PDF_MAGIC);
}

/** true si el contenido es un Word (.docx o .doc), por su firma. */
export function isWord(bytes: Uint8Array, fileName: string): boolean {
  const name = (fileName ?? '').toLowerCase();
  if (name.endsWith('.docx')) return startsWith(bytes, ZIP_MAGIC);
  if (name.endsWith('.doc')) return startsWith(bytes, OLE_MAGIC);
  return false;
}

/** Error del PDF controlado cargado, o null si es válido. */
export function getControlledPdfError(bytes: Uint8Array | null | undefined): string | null {
  if (!bytes || bytes.length === 0) return 'Falta el PDF controlado del documento.';
  if (bytes.length > SGC_MAX_FILE_BYTES) return 'El PDF supera el tamaño máximo (25 MB).';
  if (!isPdf(bytes)) return 'El archivo controlado debe ser un PDF.';
  return null;
}

/** Error del archivo fuente (Word) opcional, o null si es válido o no se envió. */
export function getSourceFileError(bytes: Uint8Array | null | undefined, fileName: string): string | null {
  if (!bytes || bytes.length === 0) return null;
  if (bytes.length > SGC_MAX_FILE_BYTES) return 'El archivo fuente supera el tamaño máximo (25 MB).';
  if (!isWord(bytes, fileName)) return 'El archivo fuente debe ser un Word (.docx o .doc).';
  return null;
}
