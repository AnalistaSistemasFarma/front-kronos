import { NextResponse } from 'next/server';
import { withMssqlPool } from '@/lib/mssqlPool';
import { getOrionDraftBoard, orionDraftMarkAction, type DraftMarkActionInput } from '@/lib/orion/draftService';
import { draftErrorResponse, getDraftSessionActor, readDraftTarget } from '@/lib/orion/draftRouteAuth';

/**
 * POST /api/integrations/orion/draft/marks
 * { requestId, fileId, action: 'create' | 'reply' | 'confirm' | 'reopen' | 'mark-fixed', ... }
 * Responde con el tablero actualizado.
 */
export async function POST(req: Request) {
  try {
    const auth = await getDraftSessionActor();
    if (!auth) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const target = readDraftTarget(body);
    if (!target) return NextResponse.json({ error: 'requestId y fileId son obligatorios' }, { status: 400 });

    const action = String(body.action || '');
    let input: DraftMarkActionInput;
    if (action === 'create') {
      input = {
        action,
        type: String(body.type || 'correccion') as Extract<DraftMarkActionInput, { action: 'create' }>['type'],
        quote: String(body.quote || ''),
        suggest: typeof body.suggest === 'string' ? body.suggest : null,
        why: String(body.why || ''),
        blockIndex: Number(body.blockIndex),
      };
    } else if (action === 'reply') {
      input = { action, markId: Number(body.markId), text: String(body.text || '') };
    } else if (action === 'confirm' || action === 'reopen' || action === 'mark-fixed') {
      input = { action, markId: Number(body.markId) };
    } else {
      return NextResponse.json({ error: 'Acción no válida' }, { status: 400 });
    }

    const board = await withMssqlPool(async (pool) => {
      await orionDraftMarkAction(pool, { ...target, ...auth, input });
      return getOrionDraftBoard(pool, { ...target, ...auth });
    });
    return NextResponse.json(board);
  } catch (err) {
    return draftErrorResponse(err, '[orion/draft/marks]');
  }
}
