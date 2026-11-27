import 'server-only';
import { useGetMicrosoftToken as getMicrosoftToken } from '../../components/microsoft-365/useGetMicrosoftToken';
import { convertOneDriveItemToPdf, deleteOneDriveItem, ensureFolderAndUploadFile } from '../onedrive/graphFolderUpload';

/**
 * VISTA PREVIA del Excel del batch record con MICROSOFT (2026-11-24, Nicolás: «aprende del SGC»).
 * Mismo patrón que `sgcOfficeConverter.bytes` (lib/sgc/onedrive.ts): el .xlsx se sube a una carpeta
 * temporal de OneDrive, Graph lo convierte con el motor de Excel Online (`content?format=pdf`, el
 * mismo «Guardar como PDF» de Office: respeta títulos que se repiten, márgenes, escala y logo) y el
 * temporal se BORRA siempre. Lo que se ve es lo que va a imprimir Excel.
 */
export const OT_CARPETA_CONVERSION = ['BitacoraProceso', '_conversion-temporal'] as const;

export async function xlsxAPdfConMicrosoft(content: Uint8Array): Promise<Uint8Array> {
  const token = await getMicrosoftToken();
  if (!token) throw new Error('No se pudo obtener el token de Microsoft Graph');
  const nombre = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.xlsx`;
  const item = await ensureFolderAndUploadFile(token, [...OT_CARPETA_CONVERSION], nombre, new Blob([content as BlobPart]));
  try {
    return new Uint8Array(await convertOneDriveItemToPdf(token, item.id));
  } finally {
    // El temporal se borra uno a uno (si falla, solo se avisa en el log).
    await deleteOneDriveItem(token, item.id).catch((e: unknown) => console.warn('[bitacora-proceso/conversion] no se pudo borrar el temporal', item.id, e));
  }
}
