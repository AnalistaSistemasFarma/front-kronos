import { NextResponse } from 'next/server';
import { withMssqlPool } from '@/lib/mssqlPool';
import { touchOrionDraftPresence } from '@/lib/orion/draftService';
import { draftErrorResponse, getDraftSessionActor, readDraftTarget } from '@/lib/orion/draftRouteAuth';

/** POST /api/integrations/orion/draft/presence { requestId, fileId, typingBlock? } → conectados. */
export async function POST(req: Request) {
  try {
    const auth = await getDraftSessionActor();
    if (!auth) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const target = readDraftTarget(body);
    if (!target) return NextResponse.json({ error: 'requestId y fileId son obligatorios' }, { status: 400 });
    const typing = Number(body.typingBlock);
    const presence = await withMssqlPool((pool) =>
      touchOrionDraftPresence(pool, {
        ...target,
        ...auth,
        typingBlock: Number.isInteger(typing) && typing >= 0 ? typing : null,
      })
    );
    return NextResponse.json({ presence });
  } catch (err) {
    return draftErrorResponse(err, '[orion/draft/presence]');
  }
}
