import { NextResponse } from 'next/server';
import { withMssqlPool } from '@/lib/mssqlPool';
import { downloadOrionDraftFileAsOwner, downloadOrionDraftWithComments } from '@/lib/orion/draftService';
import { getDraftSessionActor } from '@/lib/orion/draftRouteAuth';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * GET /api/integrations/orion/draft/file?requestId=&fileId=&versionId=
 * Sin versionId: Word de trabajo vigente. Con versionId: copia congelada de esa versión.
 * withComments=1: Word vigente con las marcas del tablero como comentarios.
 * Solo la preparadora del documento (los validadores no descargan).
 */
export async function GET(req: Request) {
  try {
    const auth = await getDraftSessionActor();
    if (!auth) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const requestId = Number(searchParams.get('requestId'));
    const fileId = String(searchParams.get('fileId') || '').trim();
    const versionId = String(searchParams.get('versionId') || '').trim() || null;
    if (!Number.isInteger(requestId) || requestId <= 0 || !fileId) {
      return NextResponse.json({ error: 'requestId y fileId son obligatorios' }, { status: 400 });
    }

    const withComments = searchParams.get('withComments') === '1';
    const file = await withMssqlPool((pool) =>
      withComments
        ? downloadOrionDraftWithComments(pool, { requestId, fileId, ...auth })
        : downloadOrionDraftFileAsOwner(pool, { requestId, fileId, versionId, ...auth })
    );
    // Cabecera solo ASCII; el nombre real (con tildes) va en filename*.
    const safeName = file.fileName.replace(/[^\x20-\x7E]|["\\]/g, '_');
    return new NextResponse(file.buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': DOCX_MIME,
        'Content-Disposition': `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    const message = err instanceof Error ? err.message : 'No se pudo descargar el documento';
    if (status >= 500) console.error('[orion/draft/file]', err);
    return NextResponse.json({ error: message }, { status });
  }
}
