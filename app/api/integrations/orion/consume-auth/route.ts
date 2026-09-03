import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import {
  closeAuthorizationTaskById,
  closePendingOrionSignerAuth,
  findOpenOrionSignTaskId,
} from '@/lib/orion/signerAuthorizations';
import { findUserIdByEmail } from '@/lib/orion/signerTasks';
import { parseOrionFileIdFromResolution } from '@/lib/orion/signerAuthMarkers';

/**
 * Cierra la autorización FIRMA del usuario y devuelve a dónde ir a firmar.
 * POST /api/integrations/orion/consume-auth
 * Body: { requestId?, fileId?, taskId? }
 *
 * No usa el gate secuencial de update-activities (Fase B), para que el
 * siguiente firmante pueda autorizar y pasar al PDF.
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const taskId = Number(body.taskId);
    const requestIdBody = Number(body.requestId);
    const fileIdBody = String(body.fileId || '').trim();

    const result = await withMssqlPool(async (pool) => {
      const byEmail = session.user.email
        ? await findUserIdByEmail(pool, session.user.email)
        : null;
      const userId = String(byEmail?.id || session.user.id || '');
      if (!userId) {
        return { error: 'No se pudo identificar al usuario', status: 401 as const };
      }

      let requestId = Number.isInteger(requestIdBody) && requestIdBody > 0 ? requestIdBody : null;
      let fileId = fileIdBody || null;
      let closed = 0;

      if (Number.isInteger(taskId) && taskId > 0) {
        const closedTask = await closeAuthorizationTaskById(pool, { taskId, userId });
        if (closedTask.closed) {
          closed = 1;
          requestId = closedTask.requestId ?? requestId;
          fileId = closedTask.fileId || fileId;
          if (!fileId) {
            fileId = parseOrionFileIdFromResolution(closedTask.resolution);
          }
        }
      }

      if (requestId && fileId) {
        const extra = await closePendingOrionSignerAuth(pool, {
          requestId,
          userId,
          fileId,
        });
        closed += extra.closed;
      }

      const signTaskId =
        requestId && userId
          ? await findOpenOrionSignTaskId(pool, { requestId, userId, fileId })
          : null;

      return {
        success: true,
        closed,
        requestId,
        fileId,
        signTaskId,
        userId,
      };
    });

    if ('error' in result && result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status || 400 });
    }

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
