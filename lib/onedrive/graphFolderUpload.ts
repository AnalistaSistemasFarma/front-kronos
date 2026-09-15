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

export type OneDriveItemMeta = {
  id: string;
  name: string;
  parentName?: string;
  parentPath?: string;
  mimeType?: string;
  downloadUrl?: string;
};

/** Metadatos de un driveItem (nombre, padre, downloadUrl). */
export async function getOneDriveItemMeta(
  token: string,
  itemId: string
): Promise<OneDriveItemMeta | null> {
  const graph = graphBase();
  const id = String(itemId || '').trim();
  if (!id) return null;

  const response = await fetch(`${graph}items/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!response.ok) return null;

  const data = (await response.json()) as {
    id?: string;
    name?: string;
    file?: { mimeType?: string };
    parentReference?: { name?: string; path?: string };
    '@microsoft.graph.downloadUrl'?: string;
  };
  const resolvedId = String(data.id || id).trim();
  const name = String(data.name || '').trim();
  if (!resolvedId || !name) return null;

  return {
    id: resolvedId,
    name,
    parentName: typeof data.parentReference?.name === 'string' ? data.parentReference.name : undefined,
    parentPath: typeof data.parentReference?.path === 'string' ? data.parentReference.path : undefined,
    mimeType: typeof data.file?.mimeType === 'string' ? data.file.mimeType : undefined,
    downloadUrl:
      typeof data['@microsoft.graph.downloadUrl'] === 'string'
        ? data['@microsoft.graph.downloadUrl']
        : undefined,
  };
}

/** El item vive en la carpeta descrita por `segments` (p. ej. SAPSEND/TEC/SG/Request-2092). */
export function isOneDriveItemInFolder(meta: OneDriveItemMeta, segments: string[]): boolean {
  const expectedFolder = String(segments[segments.length - 1] || '').trim();
  if (!expectedFolder) return false;
  if (String(meta.parentName || '').trim() === expectedFolder) return true;
  const needle = `/${segments.join('/')}`;
  return String(meta.parentPath || '').includes(needle);
}

export async function downloadOneDriveItemContent(
  token: string,
  itemId: string,
  metaHint?: OneDriveItemMeta | null
): Promise<{ buffer: Buffer; contentType: string; fileName: string } | null> {
  const meta = metaHint ?? (await getOneDriveItemMeta(token, itemId));
  if (!meta) return null;

  const contentType =
    String(meta.mimeType || '').trim() ||
    (/\.pdf$/i.test(meta.name) ? 'application/pdf' : 'application/octet-stream');

  const tryBuffer = async (url: string, auth?: boolean) => {
    const res = await fetch(url, {
      headers: auth ? { Authorization: `Bearer ${token}` } : undefined,
      cache: 'no-store',
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength === 0) return null;
    return {
      buffer,
      contentType: res.headers.get('content-type') || contentType,
      fileName: meta.name,
    };
  };

  if (meta.downloadUrl) {
    const fromShare = await tryBuffer(meta.downloadUrl);
    if (fromShare) return fromShare;
  }

  const graph = graphBase();
  return tryBuffer(`${graph}items/${encodeURIComponent(meta.id)}/content`, true);
}

/** Elimina un driveItem de OneDrive/Graph por id. */
export async function deleteOneDriveItem(token: string, itemId: string): Promise<void> {
  const graph = graphBase();
  const id = String(itemId || '').trim();
  if (!id) throw new Error('itemId es obligatorio');

  const response = await fetch(`${graph}items/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  // 404: ya no existe → idempotente.
  if (response.ok || response.status === 204 || response.status === 404) {
    return;
  }

  throw new Error(`Error al eliminar el archivo en OneDrive (HTTP ${response.status})`);
}

export type OneDriveListedFile = {
  id: string;
  name: string;
  size?: number;
  webUrl?: string;
  lastModifiedDateTime?: string;
  '@microsoft.graph.downloadUrl'?: string;
};

/**
 * Lista archivos (no carpetas) en una ruta relativa al drive.
 * Devuelve [] si la carpeta no existe (404).
 */
export async function listOneDriveFolderFiles(
  token: string,
  segments: string[]
): Promise<OneDriveListedFile[]> {
  const graph = graphBase();
  const path = segments
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join('/');
  if (!path) return [];

  // Sin $select agresivo: algunos tenants omiten el facet `file` y el filtro
  // vaciaba la tabla aunque OneDrive sí tuviera el documento.
  const response = await fetch(`${graph}root:/${path}:/children?$top=200`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  if (response.status === 404) return [];

  if (!response.ok) {
    throw new Error(`Error listando OneDrive "${path}" (HTTP ${response.status})`);
  }

  const data = (await response.json()) as {
    value?: Array<Record<string, unknown>>;
  };

  const out: OneDriveListedFile[] = [];
  for (const item of data.value || []) {
    if (!item || typeof item !== 'object') continue;
    // Carpetas fuera; todo lo demás (archivo / item sin facet) cuenta.
    if (item.folder) continue;
    const id = String(item.id || '').trim();
    const name = String(item.name || '').trim();
    if (!id || !name) continue;
    out.push({
      id,
      name,
      size: typeof item.size === 'number' ? item.size : undefined,
      webUrl: typeof item.webUrl === 'string' ? item.webUrl : undefined,
      lastModifiedDateTime:
        typeof item.lastModifiedDateTime === 'string' ? item.lastModifiedDateTime : undefined,
      ...(typeof item['@microsoft.graph.downloadUrl'] === 'string'
        ? { '@microsoft.graph.downloadUrl': item['@microsoft.graph.downloadUrl'] }
        : {}),
    });
  }
  return out;
}

/** Nombres de archivo ya presentes en la carpeta (para evitar sobrescritura silenciosa). */
export async function listOneDriveFolderFileNames(
  token: string,
  segments: string[]
): Promise<Set<string>> {
  const files = await listOneDriveFolderFiles(token, segments);
  return new Set(files.map((f) => f.name.toLowerCase()));
}

/** Si `baseName` existe, genera `name (2).ext`, `name (3).ext`, ... */
export function uniqueOneDriveFileName(baseName: string, existingLower: Set<string>): string {
  const raw = String(baseName || 'archivo.bin').trim() || 'archivo.bin';
  if (!existingLower.has(raw.toLowerCase())) return raw;
  const dot = raw.lastIndexOf('.');
  const stem = dot > 0 ? raw.slice(0, dot) : raw;
  const ext = dot > 0 ? raw.slice(dot) : '';
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${stem} (${n})${ext}`;
    if (!existingLower.has(candidate.toLowerCase())) return candidate;
  }
  return `${stem}-${Date.now()}${ext}`;
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
