import { NextResponse } from 'next/server';
import { withMssqlPool } from '@/lib/mssqlPool';
import { previewOrionDraftPdf } from '@/lib/orion/draftService';
import { draftErrorResponse, getDraftSessionActor, readDraftTarget } from '@/lib/orion/draftRouteAuth';

/** GET /api/integrations/orion/draft/pdf?requestId=&fileId=&versionId= → PDF de la subversión (en línea). */
export async function GET(req: Request) {
  try {
    const auth = await getDraftSessionActor();
    if (!auth) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    const params = new URL(req.url).searchParams;
    const target = readDraftTarget(params);
    const versionId = String(params.get('versionId') || '').trim();
    if (!target || !versionId) {
      return NextResponse.json({ error: 'requestId, fileId y versionId son obligatorios' }, { status: 400 });
    }
    const pdf = await withMssqlPool((pool) => previewOrionDraftPdf(pool, { ...target, ...auth, versionId }));
    const safeName = pdf.fileName.replace(/[^\x20-\x7E]|["\\]/g, '_');
    return new NextResponse(pdf.buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(pdf.fileName)}`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    return draftErrorResponse(err, '[orion/draft/pdf]');
  }
}
