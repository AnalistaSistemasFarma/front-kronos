import { useGetMicrosoftToken as getMicrosoftToken } from '../../components/microsoft-365/useGetMicrosoftToken';
import { convertOneDriveItemToPdf, deleteOneDriveItem, downloadOneDriveItemContent, ensureFolderAndUploadFile } from '../onedrive/graphFolderUpload';
import type { SgcUploader } from './db/documents';
import { SgcError } from './errors';
import { sha256Hex } from './storage';

/**
 * Puente del SGC con OneDrive/SharePoint. Usa la utilidad de subida
 * COMPARTIDA (lib/onedrive/graphFolderUpload.ts, permitida por el plan) con
 * el token app-only de Microsoft Graph; la carpeta es propia de la empresa
 * (SGC/<EMPRESA>/...), ver storage.ts.
 */

async function token(): Promise<string> {
  const t = await getMicrosoftToken();
  if (!t) throw new Error('No se pudo obtener el token de Microsoft Graph');
  return t;
}

/** Sube a OneDrive creando la carpeta de la versión si no existe. */
export const uploadToSgcStorage: SgcUploader = async (segments, fileName, content, contentType) => {
  const item = await ensureFolderAndUploadFile(await token(), segments, fileName, new Blob([content as BlobPart]), contentType);
  return { id: item.id };
};

/**
 * Descarga el PDF controlado y VERIFICA su integridad contra el SHA-256
 * registrado al cargarlo. Si no coincide, no se muestra (409): el archivo
 * pudo ser alterado fuera del sistema.
 */
export async function downloadVerifiedPdf(itemId: string, expectedSha256: string): Promise<Uint8Array> {
  const file = await downloadOneDriveItemContent(await token(), itemId);
  if (!file) throw new SgcError('No se pudo obtener el archivo desde OneDrive.', 502);
  const bytes = new Uint8Array(file.buffer);
  if (sha256Hex(bytes) !== expectedSha256.trim().toLowerCase()) {
    throw new SgcError('El archivo guardado no coincide con su huella registrada (SHA-256). Avise a Calidad.', 409);
  }
  return bytes;
}

/**
 * Descarga un adjunto de una solicitud y VERIFICA su SHA-256 registrado al
 * cargarlo (409 si no coincide: el archivo pudo alterarse fuera del sistema).
 */
export async function downloadVerifiedFile(itemId: string, expectedSha256: string): Promise<Uint8Array> {
  const file = await downloadOneDriveItemContent(await token(), itemId);
  if (!file) throw new SgcError('No se pudo obtener el archivo desde OneDrive.', 502);
  const bytes = new Uint8Array(file.buffer);
  if (sha256Hex(bytes) !== expectedSha256.trim().toLowerCase()) {
    throw new SgcError('El archivo guardado no coincide con su huella registrada (SHA-256). Avise a Calidad.', 409);
  }
  return bytes;
}

/**
 * Sprint 3: descarga SIN verificar (quien llama compara la huella y reporta
 * la diferencia, p. ej. la verificación del PDF controlado).
 */
export async function downloadSgcFile(itemId: string): Promise<Uint8Array> {
  const file = await downloadOneDriveItemContent(await token(), itemId);
  if (!file) throw new SgcError('No se pudo obtener el archivo desde OneDrive.', 502);
  return new Uint8Array(file.buffer);
}

/**
 * 2026-10-22 (Calidad OLP: «los formatos en Excel aún no salen bien»):
 * conversión de Office a PDF con MICROSOFT (Graph `content?format=pdf`, el
 * motor de Excel Online, el mismo «Guardar como PDF» de Office): respeta la
 * configuración de página del Excel (orientación, escala, área de impresión,
 * márgenes, saltos), las formas, las imágenes y los encabezados. Es la misma
 * conversión que ya usan Orión y el visor de adjuntos del chat.
 */
export interface SgcOfficeConverter {
  /** Un archivo que ya está en OneDrive (p. ej. el borrador de una solicitud). */
  item: (itemId: string) => Promise<Uint8Array>;
  /** Un archivo que aún no está guardado: se sube a `<storageRoot>/_conversion-temporal`, se convierte y se borra. */
  bytes: (storageRoot: string, fileName: string, content: Uint8Array) => Promise<Uint8Array>;
}

export const sgcOfficeConverter: SgcOfficeConverter = {
  item: async (itemId) => new Uint8Array(await convertOneDriveItemToPdf(await token(), itemId)),
  bytes: async (storageRoot, fileName, content) => {
    const t = await token();
    const segments = [...storageRoot.split('/').filter(Boolean), '_conversion-temporal'];
    const ext = /\.[a-z0-9]{1,5}$/i.exec(fileName)?.[0] ?? '.xlsx';
    const tempName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext.toLowerCase()}`;
    const item = await ensureFolderAndUploadFile(t, segments, tempName, new Blob([content as BlobPart]));
    try {
      return new Uint8Array(await convertOneDriveItemToPdf(t, item.id));
    } finally {
      // El drive tiene retención por carpeta, no por archivo: el temporal se borra uno a uno (si falla, solo se avisa).
      await deleteOneDriveItem(t, item.id).catch((e) => console.warn('[sgc/conversion] no se pudo borrar el temporal', item.id, e));
    }
  },
};

