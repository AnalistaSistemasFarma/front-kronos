import { NextResponse } from 'next/server';
import { withMssqlPool } from '@/lib/mssqlPool';
import { getOrionDraftBoardBlocks } from '@/lib/orion/draftService';
import { draftErrorResponse, getDraftSessionActor, readDraftTarget } from '@/lib/orion/draftRouteAuth';

/** GET /api/integrations/orion/draft/blocks?requestId=&fileId=&versionId= → párrafos de una subversión. */
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
    const blocks = await withMssqlPool((pool) =>
      getOrionDraftBoardBlocks(pool, { ...target, ...auth, versionId })
    );
    // Las subversiones son copias congeladas: el navegador puede guardarlas.
    return NextResponse.json({ blocks }, { headers: { 'Cache-Control': 'private, max-age=3600' } });
  } catch (err) {
    return draftErrorResponse(err, '[orion/draft/blocks]');
  }
}
