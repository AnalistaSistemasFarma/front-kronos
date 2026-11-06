/**
 * Reglas PURAS de los adjuntos de una solicitud de compra (cotizaciones y anexos).
 * SAPSEND acepta PDF e imagenes (UploadFile del ModalCreatePurchaseRequest) y
 * nombra cada archivo `uniqueId_nombre` para no chocar con el error -10 de SAP
 * ("el archivo ya existe"). Aqui se replica y se agregan limites en servidor.
 */

export const ATTACHMENT_RULES = {
  extensions: ['.pdf', '.jpg', '.jpeg', '.png'],
  maxBytes: 10 * 1024 * 1024,
  maxFiles: 10,
} as const;

const MIME_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

export interface IncomingFile {
  name: string;
  size: number;
}

export interface RejectedFile {
  name: string;
  reason: 'type' | 'size' | 'name' | 'empty';
  error: string;
}

function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

/** Valida cantidad, extension, tamano y nombre. Devuelve los rechazados (vacio = todo valido). */
export function validateAttachments(files: IncomingFile[]): { error?: string; rejected: RejectedFile[] } {
  if (files.length === 0) return { error: 'No llego ningun archivo.', rejected: [] };
  if (files.length > ATTACHMENT_RULES.maxFiles) {
    return { error: `Maximo ${ATTACHMENT_RULES.maxFiles} archivos por envio.`, rejected: [] };
  }
  const rejected: RejectedFile[] = [];
  for (const f of files) {
    if (/[\\/]/.test(f.name) || f.name.trim() === '') {
      rejected.push({ name: f.name, reason: 'name', error: `'${f.name}' tiene un nombre invalido.` });
    } else if (!ATTACHMENT_RULES.extensions.includes(extensionOf(f.name) as never)) {
      rejected.push({
        name: f.name,
        reason: 'type',
        error: `'${f.name}' tiene una extension no permitida. Permitidas: ${ATTACHMENT_RULES.extensions.join(', ')}.`,
      });
    } else if (f.size === 0) {
      rejected.push({ name: f.name, reason: 'empty', error: `'${f.name}' esta vacio.` });
    } else if (f.size > ATTACHMENT_RULES.maxBytes) {
      rejected.push({ name: f.name, reason: 'size', error: `'${f.name}' supera los 10 MB.` });
    }
  }
  return { rejected };
}

/** Tipo MIME por extension (la validacion ya garantizo que es una permitida). */
export function mimeFor(name: string): string {
  return MIME_BY_EXTENSION[extensionOf(name)] ?? 'application/octet-stream';
}

/**
 * Nombre unico para SAP, como SAPSEND (`uniqueId_nombre`): evita el error -10
 * cuando dos solicitudes adjuntan un archivo con el mismo nombre. Se limpian
 * caracteres que SAP o el sistema de archivos del servidor no aceptan.
 */
export function uniqueSapFilename(name: string, uniqueId: string): string {
  const clean = name.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '_');
  return `${uniqueId}_${clean}`.slice(0, 200);
}
