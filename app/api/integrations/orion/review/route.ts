import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import {
  decideOrionReview,
  getOrionReviewInfo,
  resubmitOrionReview,
  submitOrionReview,
  type OrionReviewActor,
} from '@/lib/orion/review';

const MAX_PDF_BASE64_LENGTH = 40 * 1024 * 1024;

function sessionActor(session: {
  user?: { id?: unknown; email?: string | null; name?: string | null } | null;
} | null): OrionReviewActor | null {
  const userId = String(session?.user?.id ?? '').trim();
  const email = String(session?.user?.email ?? '').trim().toLowerCase();
  if (!userId || !email) return null;
  return { userId, email, name: session?.user?.name ?? null };
}

function errorResponse(err: unknown) {
  const status = (err as { status?: number })?.status ?? 500;
  const message = err instanceof Error ? err.message : 'Error en la validación del documento';
  if (status >= 500) console.error('[orion/review]', err);
  return NextResponse.json({ error: message }, { status });
}

/** GET /api/integrations/orion/review?requestId=&fileId= */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const actor = sessionActor(session);
    if (!actor) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const requestId = Number(searchParams.get('requestId'));
    const fileId = String(searchParams.get('fileId') || '').trim();
    if (!Number.isInteger(requestId) || requestId <= 0 || !fileId) {
      return NextResponse.json({ error: 'requestId y fileId son obligatorios' }, { status: 400 });
    }
    const isAdmin = session?.user?.role === 'admin' || session?.user?.role === 'superadmin';
    const info = await withMssqlPool((pool) =>
      getOrionReviewInfo(pool, { requestId, fileId, actor, isAdmin })
    );
    return NextResponse.json(info);
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * POST /api/integrations/orion/review
 * { action: 'submit' | 'approve' | 'return' | 'resubmit', requestId, fileId, ... }
 * submit/resubmit: validatorIds = validadores del documento en orden de aprobación.
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const actor = sessionActor(session);
    if (!actor) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '').trim();
    const requestId = Number(body.requestId);
    const fileId = String(body.fileId || '').trim();
    if (!Number.isInteger(requestId) || requestId <= 0 || !fileId) {
      return NextResponse.json({ error: 'requestId y fileId son obligatorios' }, { status: 400 });
    }
    const isAdmin = session?.user?.role === 'admin' || session?.user?.role === 'superadmin';
    const comment = typeof body.comment === 'string' ? body.comment.slice(0, 1000) : null;

    const result = await withMssqlPool(async (pool) => {
      switch (action) {
        case 'submit':
          return submitOrionReview(pool, {
            requestId,
            fileId,
            fileName: typeof body.fileName === 'string' ? body.fileName : null,
            validatorIds: body.validatorIds,
            actor,
            isAdmin,
          });
        case 'approve':
        case 'return':
          return decideOrionReview(pool, {
            requestId,
            fileId,
            actor,
            decision: action === 'approve' ? 'APROBADO' : 'DEVUELTO',
            comment,
          });
        case 'resubmit': {
          const pdfBase64 = String(body.pdfBase64 || '').replace(/^data:[^,]+,/, '').trim();
          if (!pdfBase64) {
            throw Object.assign(new Error('Adjunte el PDF corregido'), { status: 400 });
          }
          if (pdfBase64.length > MAX_PDF_BASE64_LENGTH) {
            throw Object.assign(new Error('El PDF supera el tamaño permitido'), { status: 413 });
          }
          return resubmitOrionReview(pool, {
            requestId,
            fileId,
            pdfBase64,
            reason: typeof body.reason === 'string' ? body.reason.slice(0, 500) : null,
            validatorIds: body.validatorIds,
            actor,
            isAdmin,
          });
        }
        default:
          throw Object.assign(new Error('Acción no válida'), { status: 400 });
      }
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return errorResponse(err);
  }
}
