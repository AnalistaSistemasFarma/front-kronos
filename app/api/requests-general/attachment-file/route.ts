import { oneDriveRoot } from '@/lib/onedrive/root';
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
import { applyDocumentAnnotations } from '@/lib/orion/annotationService';
import { getOrionDraftInfo } from '@/lib/orion/draftService';
import { findDraftForOneDriveItem } from '@/lib/orion/draftState';
import { getDraftSessionActor } from '@/lib/orion/draftRouteAuth';
import {
  getCachedPdf,
  pdfCacheKey,
  PDF_CACHE_TTL_ACTIVE_MS,
  PDF_CACHE_TTL_SEALED_MS,
  setCachedPdf,
} from '@/lib/orion/pdfResponseCache';
import type { OrionSignatureState } from '@/lib/orion/types';

function safePathSegment(value: string, fallback: string): string {
  const v = String(value || '').trim();
  if (/^[A-Za-z0-9._-]{1,64}$/.test(v)) return v;
  return fallback;
}

/** Estado de firma si el adjunto ya se envió a firma (lleva visto bueno y sellos); si no, null. */
async function loadSigningState(requestId: number, fileId: string): Promise<OrionSignatureState | null> {
  try {
    const loaded = await withMssqlPool((pool) => loadOrionFormBag(pool, requestId));
    if (!loaded) return null;
    const state = getOrionDocumentFromBag(loaded.bag, fileId);
    const status = String(state.status || '').toUpperCase();
    return ['PENDIENTE_FIRMA', 'EN_PROCESO', 'FIRMADO'].includes(status) ? state : null;
  } catch {
    return null;
  }
}

/** Ya enviado a firma: el adjunto se ve con el visto bueno de los validadores y los sellos. */
async function withValidatorMarks(
  pdf: Uint8Array,
  state: OrionSignatureState | null,
  withAnnotations: boolean
): Promise<Uint8Array> {
  if (!state) return pdf;
  try {
    const final = String(state.status || '').toUpperCase() === 'FIRMADO';
    const marked = await applyValidatorMarks(pdf, state, { final });
    return withAnnotations ? await applyDocumentAnnotations(marked, state) : marked;
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

/** Solo ASCII: tildes/diacríticos fuera (ByteString de headers HTTP). */
function toAsciiHeader(value: string, fallback = 'archivo.bin'): string {
  const ascii = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\\r\n]/g, '_')
    .trim();
  return ascii || fallback;
}

function safeContentType(value: string | null | undefined): string {
  // Graph a veces manda `application/pdf; name="Cotización.pdf"` → rompe el header.
  const mime = String(value || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime)) return mime;
  return 'application/octet-stream';
}

function contentDisposition(fileName: string, download: boolean): string {
  const safe = toAsciiHeader(fileName || 'archivo.bin');
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
    // annotations=0: sin sellos/datos de SynerLink (el editor de firmas los dibuja aparte).
    const withAnnotations = searchParams.get('annotations') !== '0';

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

    const folderSegments = [oneDriveRoot(), 'TEC', storagePath, `${entityType}-${requestId}`];
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

    const respond = (body: Uint8Array, contentType: string | null | undefined, fileName: string) => {
      // Headers solo ASCII: si Content-Type o el nombre traen tildes, Node lanza ByteString.
      const headers = new Headers();
      headers.set('Content-Type', safeContentType(contentType));
      headers.set('Content-Disposition', contentDisposition(fileName, forceDownload));
      headers.set('Cache-Control', 'private, no-store');
      return new NextResponse(body as unknown as BodyInit, { status: 200, headers });
    };

    // PDF ya armado hace poco: mismo contenido en OneDrive (cTag) y mismo estado de firma.
    const looksPdf = /\.pdf$/i.test(meta.name) || /pdf/i.test(meta.mimeType || '');
    const signingState = looksPdf ? await loadSigningState(requestId, fileId) : null;
    const cacheKey =
      looksPdf && meta.cTag
        ? pdfCacheKey({ route: 'attachment-file', fileId, cTag: meta.cTag, withAnnotations, state: signingState })
        : null;
    const cached = cacheKey ? getCachedPdf(cacheKey) : null;
    if (cached) return respond(cached.body, cached.contentType, meta.name);

    const downloaded = await downloadOneDriveItemContent(token, fileId, meta);
    if (!downloaded) {
      return NextResponse.json({ error: 'No se pudo leer el archivo en OneDrive' }, { status: 404 });
    }

    let body: Uint8Array = downloaded.buffer;
    const isPdf = /pdf/i.test(downloaded.contentType || '') || /\.pdf$/i.test(downloaded.fileName || '');
    if (isPdf) {
      const state = looksPdf ? signingState : await loadSigningState(requestId, fileId);
      body = await withValidatorMarks(body, state, withAnnotations);
      if (cacheKey) {
        const active = state != null && String(state.status || '').toUpperCase() !== 'FIRMADO';
        setCachedPdf(
          cacheKey,
          Buffer.from(body.buffer, body.byteOffset, body.byteLength),
          safeContentType(downloaded.contentType),
          active ? PDF_CACHE_TTL_ACTIVE_MS : PDF_CACHE_TTL_SEALED_MS
        );
      }
    }

    return respond(body, downloaded.contentType, downloaded.fileName);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error interno';
    console.error('[attachment-file]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
