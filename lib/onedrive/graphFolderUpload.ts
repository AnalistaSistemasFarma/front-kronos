/**
 * Utilidades GENÉRICAS para crear carpetas anidadas y subir archivos a
 * OneDrive vía Microsoft Graph (token app-only, client-credentials).
 *
 * Antes esta lógica vivía solo dentro de components/ui/FileUpload.tsx, atada
 * a una carpeta plana bajo `SAPSEND/TEC/<storagePath>/<entityType>-<id>`. Se
 * generaliza aquí para aceptar una ruta de segmentos ARBITRARIA, de forma
 * que otros módulos (p.ej. Gestión Documental:
 * `GESTION-DOCUMENTAL/<EMPRESA>/<TIPO>/<CODIGO>/v<version>`) puedan reusarla
 * sin duplicar las llamadas a Graph.
 *
 * Isomórfico a propósito: funciona igual llamado desde un componente cliente
 * (FileUpload, con un token obtenido vía el server action
 * useGetMicrosoftToken) como desde una API route en el servidor (igual que
 * lib/sapsend/files.js ya hace llamadas a Graph directamente en servidor).
 * No importa nada de 'use client' / 'use server': son funciones planas.
 */

function graphBase(): string {
  const base = (process.env.MICROSOFTGRAPHUSERROUTE || '').toString();
  if (!base) {
    throw new Error('MICROSOFTGRAPHUSERROUTE no está configurado');
  }
  return base;
}

interface GraphItemResponse {
  id: string;
  webUrl?: string;
  [key: string]: unknown;
}

/**
 * Asegura que exista la carpeta descrita por `segments` (relativa a la raíz
 * del drive), creando cada nivel que falte. Devuelve el id de la carpeta
 * final (la del último segmento).
 *
 * Cada nivel se resuelve con un GET por ruta; si no existe (404) se crea como
 * hijo del nivel anterior. Tolera la carrera de creación concurrente (409):
 * si dos subidas intentan crear la misma carpeta al mismo tiempo, la segunda
 * simplemente relee el id ya creado por la primera.
 */
export async function ensureOneDriveFolderPath(
  token: string,
  segments: string[]
): Promise<string> {
  const graph = graphBase();

  let accumulatedPath = '';
  let folderId: string | null = null;

  for (const segment of segments) {
    const parentPath = accumulatedPath;
    accumulatedPath = accumulatedPath ? `${accumulatedPath}/${segment}` : segment;

    const getResponse = await fetch(`${graph}root:/${accumulatedPath}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (getResponse.ok) {
      const data = (await getResponse.json()) as GraphItemResponse;
      folderId = data.id;
      continue;
    }

    if (getResponse.status !== 404) {
      throw new Error(
        `Error verificando la carpeta "${accumulatedPath}" en OneDrive (HTTP ${getResponse.status})`
      );
    }

    const createUrl = parentPath ? `${graph}root:/${parentPath}:/children` : `${graph}root/children`;

    const createResponse = await fetch(createUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: segment,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'fail',
      }),
    });

    if (createResponse.ok) {
      const data = (await createResponse.json()) as GraphItemResponse;
      folderId = data.id;
      continue;
    }

    // Pudo haber sido creada por una subida concurrente entre el GET y el POST.
    if (createResponse.status === 409) {
      const retryGet = await fetch(`${graph}root:/${accumulatedPath}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (retryGet.ok) {
        const data = (await retryGet.json()) as GraphItemResponse;
        folderId = data.id;
        continue;
      }
    }

    throw new Error(
      `Error creando la carpeta "${accumulatedPath}" en OneDrive (HTTP ${createResponse.status})`
    );
  }

  if (!folderId) {
    throw new Error('No se pudo resolver la carpeta destino en OneDrive');
  }
  return folderId;
}

/**
 * Sube el contenido de un archivo a una carpeta YA existente (por id).
 * `content` puede ser un Blob/File (navegador) o un Buffer/Uint8Array
 * (servidor, p.ej. leído de un FormData de una API route).
 */
export async function uploadFileToOneDriveFolder(
  token: string,
  folderId: string,
  fileName: string,
  content: BodyInit,
  contentType?: string
): Promise<GraphItemResponse> {
  const graph = graphBase();

  const response = await fetch(`${graph}items/${folderId}:/${encodeURIComponent(fileName)}:/content`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType || 'application/octet-stream',
    },
    body: content,
  });

  if (!response.ok) {
    throw new Error(`Error al subir el archivo "${fileName}" a OneDrive (HTTP ${response.status})`);
  }

  return (await response.json()) as GraphItemResponse;
}

/**
 * Azúcar sintáctico: asegura la carpeta de `segments` y sube el archivo ahí.
 * Devuelve el item de Graph creado (id, webUrl, ...).
 */
export async function ensureFolderAndUploadFile(
  token: string,
  segments: string[],
  fileName: string,
  content: BodyInit,
  contentType?: string
): Promise<GraphItemResponse> {
  const folderId = await ensureOneDriveFolderPath(token, segments);
  return uploadFileToOneDriveFolder(token, folderId, fileName, content, contentType);
}
