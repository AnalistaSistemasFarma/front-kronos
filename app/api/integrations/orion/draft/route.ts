import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import {
  convertOrionDraftToPdf,
  decideOrionDraftInternal,
  getOrionDraftInfo,
  orionDraftClientInvite,
  sendOrionDraftToClient,
  startOrionDraft,
  submitOrionDraftInternal,
  editOrionDraftValidators,
} from '@/lib/orion/draftService';
import type { DraftActor } from '@/lib/orion/draftState';

function sessionActor(session: {
  user?: { id?: unknown; email?: string | null; name?: string | null } | null;
} | null): DraftActor | null {
  const userId = String(session?.user?.id ?? '').trim();
  const email = String(session?.user?.email ?? '').trim().toLowerCase();
  if (!userId || !email) return null;
  return { userId, email, name: session?.user?.name ?? null };
}

function errorResponse(err: unknown) {
  const status = (err as { status?: number })?.status ?? 500;
  const message = err instanceof Error ? err.message : 'Error en la preparación del documento';
  if (status >= 500) console.error('[orion/draft]', err);
  return NextResponse.json({ error: message }, { status });
}

/** GET /api/integrations/orion/draft?requestId=&fileId= → estado + permisos del usuario. */
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
      getOrionDraftInfo(pool, { requestId, fileId, actor, isAdmin })
    );
    return NextResponse.json(info);
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * POST /api/integrations/orion/draft
 * { action, requestId, fileId, ... }
 * - start
 * - submit-internal (validatorIds en orden) | edit-validators (validatorIds)
 * - approve (baseVersion: subversión que se aprueba) | return (comment obligatorio)
 * - send-client (reviewers [{ email, name, cardCode }], mode sequential|parallel)
 * - client-invite (email, inviteAction url|send|regenerate)
 * - convert-pdf
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

    const extra: Record<string, unknown> = {};
    const draft = await withMssqlPool(async (pool) => {
      switch (action) {
        case 'send-client':
          return sendOrionDraftToClient(pool, {
            requestId,
            fileId,
            actor,
            reviewers: Array.isArray(body.reviewers) ? body.reviewers : [],
            mode: body.mode === 'parallel' ? 'parallel' : 'sequential',
          });
        case 'client-invite': {
          const inviteAction = String(body.inviteAction || 'url');
          const result = await orionDraftClientInvite(pool, {
            requestId,
            fileId,
            actor,
            email: String(body.email || ''),
            action: inviteAction === 'send' || inviteAction === 'regenerate' ? inviteAction : 'url',
          });
          extra.reviewUrl = result.reviewUrl;
          return result.draft;
        }
        case 'convert-pdf': {
          const result = await convertOrionDraftToPdf(pool, { requestId, fileId, actor });
          extra.pdfFileId = result.pdfFileId;
          extra.pdfFileName = result.pdfFileName;
          return result.draft;
        }
        case 'start':
          return startOrionDraft(pool, { requestId, fileId, actor });
        case 'submit-internal':
          return submitOrionDraftInternal(pool, {
            requestId,
            fileId,
            actor,
            validatorIds: body.validatorIds,
          });
        case 'edit-validators':
          return editOrionDraftValidators(pool, {
            requestId,
            fileId,
            actor,
            validatorIds: body.validatorIds,
          });
        case 'approve':
        case 'return':
          return decideOrionDraftInternal(pool, {
            requestId,
            fileId,
            actor,
            decision: action,
            comment,
            baseVersion: typeof body.baseVersion === 'string' ? body.baseVersion : null,
          });
        default:
          throw Object.assign(new Error('Acción no válida'), { status: 400 });
      }
    });

    const info = await withMssqlPool((pool) =>
      getOrionDraftInfo(pool, { requestId, fileId, actor, isAdmin })
    );
    return NextResponse.json({ ...info, ...extra, draft: info.draft ?? draft });
  } catch (err) {
    return errorResponse(err);
  }
}
