import { NextResponse } from 'next/server';
import { withMssqlPool } from '@/lib/mssqlPool';
import { getOrionDraftBoard } from '@/lib/orion/draftService';
import { draftErrorResponse, getDraftSessionActor, readDraftTarget } from '@/lib/orion/draftRouteAuth';

/** GET /api/integrations/orion/draft/board?requestId=&fileId= → subversiones, marcas y presencia. */
export async function GET(req: Request) {
  try {
    const auth = await getDraftSessionActor();
    if (!auth) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    const target = readDraftTarget(new URL(req.url).searchParams);
    if (!target) return NextResponse.json({ error: 'requestId y fileId son obligatorios' }, { status: 400 });
    const board = await withMssqlPool((pool) => getOrionDraftBoard(pool, { ...target, ...auth }));
    return NextResponse.json(board);
  } catch (err) {
    return draftErrorResponse(err, '[orion/draft/board]');
  }
}
