import { useGetMicrosoftToken as getMicrosoftToken } from '../../components/microsoft-365/useGetMicrosoftToken';
import { downloadOneDriveItemContent, ensureFolderAndUploadFile } from '../onedrive/graphFolderUpload';
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
