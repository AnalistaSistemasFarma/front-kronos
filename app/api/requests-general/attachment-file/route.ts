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
import { withMssqlPool } from '@/lib/mssqlPool';
import { getOrionDocumentFromBag } from '@/lib/orion/formValue';
import { loadOrionFormBag } from '@/lib/orion/service';
import { applyValidatorMarks } from '@/lib/orion/validatorMarks';
import { getOrionDraftInfo } from '@/lib/orion/draftService';
import { findDraftForOneDriveItem } from '@/lib/orion/draftState';
import { getDraftSessionActor } from '@/lib/orion/draftRouteAuth';

function safePathSegment(value: string, fallback: string): string {
  const v = String(value || '').trim();
  if (/^[A-Za-z0-9._-]{1,64}$/.test(v)) return v;
  return fallback;
}

/** Ya enviado a firma: el adjunto se ve con el visto bueno de los validadores. */
async function withValidatorMarks(
  requestId: number,
  fileId: string,
  pdf: Uint8Array
): Promise<Uint8Array> {
  try {
    const loaded = await withMssqlPool((pool) => loadOrionFormBag(pool, requestId));
    if (!loaded) return pdf;
    const state = getOrionDocumentFromBag(loaded.bag, fileId);
    const status = String(state.status || '').toUpperCase();
    if (!['PENDIENTE_FIRMA', 'EN_PROCESO', 'FIRMADO'].includes(status)) return pdf;
    return await applyValidatorMarks(pdf, state, { final: status === 'FIRMADO' });
  } catch {
    return pdf;
  }
}

/**
 * Mensaje de bloqueo si el adjunto es un Word en preparación (o una copia de sus versiones) y
 * quien pide no es su preparadora. Ante un error se bloquea: no se entrega el Word sin verificar.
 */
async function draftDownloadBlocked(requestId: number, itemIds: string[]): Promise<string | null> {
  const blockedMessage =
    'Este Word está en preparación: solo quien lo prepara puede descargarlo. Revíselo en el tablero del documento.';
  try {
    const loaded = await withMssqlPool((pool) => loadOrionFormBag(pool, requestId));
    const found = findDraftForOneDriveItem(loaded?.bag.drafts, itemIds);
    if (!found || found.draft.status === 'CONVERTIDO_PDF') return null;
    const auth = await getDraftSessionActor();
    if (!auth) return 'No autorizado';
    const info = await withMssqlPool((pool) =>
      getOrionDraftInfo(pool, { requestId, fileId: found.fileId, ...auth })
    );
    return info.isElaborator ? null : blockedMessage;
  } catch (err) {
    console.error('[attachment-file] verificación de Word en preparación', err);
    return blockedMessage;
  }
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

    // Word en preparación: solo su preparadora lo descarga (los validadores revisan en el tablero).
    // Se decide por pertenencia al borrador (Word o copia de versión), sin importar storagePath.
    // Solo .docx: los PDF e imágenes no pagan esta consulta.
    if (/\.docx$/i.test(String(meta.name || ''))) {
      const blocked = await draftDownloadBlocked(requestId, [fileId, meta.id]);
      if (blocked) return NextResponse.json({ error: blocked }, { status: 403 });
    }

    const downloaded = await downloadOneDriveItemContent(token, fileId, meta);
    if (!downloaded) {
      return NextResponse.json({ error: 'No se pudo leer el archivo en OneDrive' }, { status: 404 });
    }

    let body: Uint8Array = downloaded.buffer;
    if (/pdf/i.test(downloaded.contentType || '') || /\.pdf$/i.test(downloaded.fileName || '')) {
      body = await withValidatorMarks(requestId, fileId, body);
    }

    return new NextResponse(body as unknown as BodyInit, {
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
