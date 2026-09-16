import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { useGetMicrosoftToken as getMicrosoftToken } from '@/components/microsoft-365/useGetMicrosoftToken';
import {
  ensureOneDriveFolderPath,
  listOneDriveFolderFileNames,
  uniqueOneDriveFileName,
  uploadFileToOneDriveFolder,
} from '@/lib/onedrive/graphFolderUpload';
import { sanitizeOneDriveName } from '@/lib/onedriveName';

/**
 * Sube adjuntos a OneDrive (servidor → Graph), ruta:
 * SAPSEND/TEC/<storagePath>/<entityType>-<requestId>
 *
 * POST multipart: requestId, storagePath?, entityType?, files (1..n)
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const form = await req.formData();
    const requestId = Number(form.get('requestId') || form.get('id'));
    const storagePath = String(form.get('storagePath') || 'SG').trim() || 'SG';
    const entityType = String(form.get('entityType') || 'Request').trim() || 'Request';

    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: 'requestId inválido' }, { status: 400 });
    }

    const rawFiles = form.getAll('files');
    const files: File[] = [];
    for (const entry of rawFiles) {
      // En Node/Next el entry puede ser File o Blob con name.
      if (typeof Blob !== 'undefined' && entry instanceof Blob) {
        const name =
          typeof (entry as File).name === 'string' && (entry as File).name
            ? (entry as File).name
            : 'archivo.bin';
        files.push(new File([entry], name, { type: entry.type || 'application/octet-stream' }));
      }
    }

    if (files.length === 0) {
      return NextResponse.json({ error: 'No se enviaron archivos' }, { status: 400 });
    }

    const token = await getMicrosoftToken();
    if (!token) {
      return NextResponse.json({ error: 'No se pudo obtener token de OneDrive' }, { status: 502 });
    }

    const folderName = `${entityType}-${requestId}`;
    const folderSegments = ['SAPSEND', 'TEC', storagePath, folderName];
    const folderId = await ensureOneDriveFolderPath(token, folderSegments);
    const existingNames = await listOneDriveFolderFileNames(token, folderSegments);

    const uploaded: Array<{
      id: string;
      name: string;
      size?: number;
      webUrl?: string;
      lastModifiedDateTime?: string;
      '@microsoft.graph.downloadUrl'?: string;
    }> = [];
    const errors: string[] = [];

    for (const file of files) {
      const sanitized = sanitizeOneDriveName(file.name) || `archivo-${Date.now()}.bin`;
      // No sobrescribir: si ya existe firmaas.pdf → firmaas (2).pdf
      const uploadName = uniqueOneDriveFileName(sanitized, existingNames);
      existingNames.add(uploadName.toLowerCase());
      try {
        // Leer bytes en servidor: pasar File/Blob directo a fetch→Graph a veces sube 0 bytes
        // y la UI marca "almacenado" aunque OneDrive no conserve el documento.
        const bytes = Buffer.from(await file.arrayBuffer());
        if (bytes.byteLength === 0) {
          errors.push(`${file.name}: el archivo llegó vacío al servidor`);
          continue;
        }

        const item = await uploadFileToOneDriveFolder(
          token,
          folderId,
          uploadName,
          bytes,
          file.type || 'application/octet-stream'
        );

        const size =
          typeof item.size === 'number' && item.size > 0 ? item.size : bytes.byteLength;
        if (size <= 0) {
          errors.push(`${file.name}: OneDrive devolvió tamaño 0`);
          continue;
        }

        uploaded.push({
          id: String(item.id),
          name: String(item.name || uploadName),
          size,
          webUrl: typeof item.webUrl === 'string' ? item.webUrl : undefined,
          lastModifiedDateTime:
            typeof item.lastModifiedDateTime === 'string'
              ? item.lastModifiedDateTime
              : new Date().toISOString(),
          ...(typeof item['@microsoft.graph.downloadUrl'] === 'string'
            ? { '@microsoft.graph.downloadUrl': item['@microsoft.graph.downloadUrl'] }
            : {}),
        });

        console.log(
          `[upload-attachments] OK request=${requestId} folder=${folderName} name=${uploadName} bytes=${bytes.byteLength} id=${item.id}`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error al subir';
        console.error(`[upload-attachments] FAIL ${file.name}:`, err);
        errors.push(`${file.name}: ${msg}`);
      }
    }

    if (uploaded.length === 0) {
      return NextResponse.json(
        { error: errors[0] || 'No se pudo subir ningún archivo', errors },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      folder: `SAPSEND/TEC/${storagePath}/${folderName}`,
      uploaded,
      errors: errors.length ? errors : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error interno';
    console.error('[upload-attachments]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
