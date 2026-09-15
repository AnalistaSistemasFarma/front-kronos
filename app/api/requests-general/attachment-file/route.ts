import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { useGetMicrosoftToken as getMicrosoftToken } from '@/components/microsoft-365/useGetMicrosoftToken';
import {
  downloadOneDriveItemContent,
  getOneDriveItemMeta,
  isOneDriveItemInFolder,
  listOneDriveFolderFiles,
} from '@/lib/onedrive/graphFolderUpload';

function safePathSegment(value: string, fallback: string): string {
  const v = String(value || '').trim();
  if (/^[A-Za-z0-9._-]{1,64}$/.test(v)) return v;
  return fallback;
}

function contentDisposition(fileName: string, download: boolean): string {
  const safe = String(fileName || 'archivo.bin').replace(/[\r\n"]/g, '_');
  const type = download ? 'attachment' : 'inline';
  return `${type}; filename="${safe}"`;
}

/**
 * Sirve un adjunto de la solicitud desde OneDrive SynerLink
 * (SAPSEND/TEC/<storagePath>/<entityType>-<requestId>).
 *
 * GET ?requestId=&fileId=&storagePath=SG&entityType=Request&download=1
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const requestId = Number(searchParams.get('requestId') || searchParams.get('id'));
    const fileId = String(searchParams.get('fileId') || '').trim();
    const storagePath = safePathSegment(searchParams.get('storagePath') || 'SG', 'SG');
    const entityType = safePathSegment(searchParams.get('entityType') || 'Request', 'Request');
    const forceDownload = searchParams.get('download') === '1';

    if (!Number.isInteger(requestId) || requestId <= 0 || !fileId) {
      return NextResponse.json(
        { error: 'requestId y fileId son obligatorios' },
        { status: 400 }
      );
    }

    const token = await getMicrosoftToken();
    if (!token) {
      return NextResponse.json({ error: 'No se pudo obtener token de OneDrive' }, { status: 502 });
    }

    const folderSegments = ['SAPSEND', 'TEC', storagePath, `${entityType}-${requestId}`];
    const meta = await getOneDriveItemMeta(token, fileId);
    if (!meta) {
      return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
    }

    let inFolder = isOneDriveItemInFolder(meta, folderSegments);
    if (!inFolder && !meta.parentName && !meta.parentPath) {
      const listed = await listOneDriveFolderFiles(token, folderSegments);
      inFolder = listed.some((f) => f.id === fileId);
    }
    if (!inFolder) {
      return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });
    }

    const downloaded = await downloadOneDriveItemContent(token, fileId, meta);
    if (!downloaded) {
      return NextResponse.json({ error: 'No se pudo leer el archivo en OneDrive' }, { status: 404 });
    }

    return new NextResponse(downloaded.buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': downloaded.contentType || 'application/octet-stream',
        'Content-Disposition': contentDisposition(downloaded.fileName, forceDownload),
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error interno';
    console.error('[attachment-file]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
