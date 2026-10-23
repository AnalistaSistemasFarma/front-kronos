import 'server-only';
import { useGetMicrosoftToken as getMicrosoftToken } from '../../components/microsoft-365/useGetMicrosoftToken';
import { downloadOneDriveItemContent, ensureFolderAndUploadFile } from '../onedrive/graphFolderUpload';
import { oneDriveRoot } from '../onedrive/root';
import { carpetaImagenes } from './medios';

/**
 * Puente de la Vitrina con el almacenamiento de adjuntos de SynerLink (OneDrive por
 * Microsoft Graph, token app-only). Reutiliza las utilidades compartidas
 * (lib/onedrive) y la raíz de adjuntos del entorno: nada de almacenamiento nuevo.
 */
export interface VitrinaImageStorage {
  subir: (idCompany: number, idPresentacion: number, nombre: string, contenido: Uint8Array, mime: string) => Promise<{ id: string }>;
  bajar: (itemId: string) => Promise<Uint8Array | null>;
}

async function token(): Promise<string> {
  const t = await getMicrosoftToken();
  if (!t) throw new Error('No se pudo obtener el token de Microsoft Graph');
  return t;
}

export const vitrinaImageStorage: VitrinaImageStorage = {
  subir: async (idCompany, idPresentacion, nombre, contenido, mime) => {
    const item = await ensureFolderAndUploadFile(await token(), carpetaImagenes(oneDriveRoot(), idCompany, idPresentacion), nombre, new Blob([contenido as BlobPart]), mime);
    return { id: item.id };
  },
  bajar: async (itemId) => {
    const file = await downloadOneDriveItemContent(await token(), itemId);
    return file ? new Uint8Array(file.buffer) : null;
  },
};
