import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import {
  getOrionDocumentFromBag,
  setOrionDocumentInBag,
} from '@/lib/orion/formValue';
import {
  getRequestOrionContext,
  insertRequestNote,
  isOrionRequestWorkflowLocked,
  loadOrionFormBag,
  upsertOrionFormBag,
} from '@/lib/orion/service';
import { getCurrentPendingSigner } from '@/lib/orion/signerStatus';
import { isSignerTurnExpired } from '@/lib/orion/signerDeadline';
import { isOrionRequestCreator } from '@/lib/orion/permissions';

function normalizeEmail(email?: string | null): string {
  return String(email || '')
    .trim()
    .toLowerCase();
}

/**
 * Firmante con plazo vencido solicita renovar al líder (creador).
 * POST /api/integrations/orion/request-sign-extension
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    const userId = session?.user?.id;
    if (!email || !userId) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const requestId = Number(body.requestId);
    const fileId = String(body.fileId || '').trim();
    if (!Number.isInteger(requestId) || requestId <= 0 || !fileId) {
      return NextResponse.json({ error: 'requestId y fileId son obligatorios' }, { status: 400 });
    }

    const result = await withMssqlPool(async (pool) => {
      if (await isOrionRequestWorkflowLocked(pool, requestId)) {
        throw Object.assign(new Error('La solicitud está cerrada.'), { status: 409 });
      }

      const loaded = await loadOrionFormBag(pool, requestId);
      if (!loaded) {
        throw Object.assign(new Error('Documento de firma no encontrado'), { status: 404 });
      }

      const current = getOrionDocumentFromBag(loaded.bag, fileId);
      const pending = getCurrentPendingSigner(current.signers);
      const me = normalizeEmail(email);
      if (!pending || normalizeEmail(pending.email) !== me) {
        throw Object.assign(new Error('Solo el firmante en turno puede solicitar firmar.'), {
          status: 403,
        });
      }
      if (!isSignerTurnExpired(pending)) {
        throw Object.assign(new Error('Su plazo aún está vigente; puede firmar normalmente.'), {
          status: 409,
        });
      }

      const signers = (current.signers ?? []).map((s) =>
        normalizeEmail(s.email) === me
          ? { ...s, extensionRequestedAt: new Date().toISOString() }
          : s
      );
      const next = { ...current, signers };
      const bag = setOrionDocumentInBag(loaded.bag, fileId, next);
      await upsertOrionFormBag(pool, requestId, loaded.field.id_form_field, bag);

      const ctx = await getRequestOrionContext(pool, requestId);
      const signerName = pending.name || email;
      await insertRequestNote(
        pool,
        requestId,
        `${signerName} solicitó firmar el documento "${current.fileName || fileId}" (plazo de 24 h vencido). El líder del proceso debe renovar el plazo.`,
        String(userId)
      );

      return {
        state: next,
        documents: bag.documents,
        leaderEmail: ctx?.requester_email ?? null,
      };
    });

    return NextResponse.json({
      success: true,
      state: result.state,
      documents: result.documents,
      message: 'Se notificó al líder del proceso. Espere la renovación del plazo.',
    });
  } catch (err) {
    const status =
      err && typeof err === 'object' && 'status' in err
        ? Number((err as { status: number }).status) || 500
        : 500;
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * Líder renueva 24h del turno actual.
 * POST body: { requestId, fileId, action: 'renew' }
 * (mismo archivo; renew vía query action=renew también soportado abajo)
 */
export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    const userId = session?.user?.id;
    if (!email || !userId) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const requestId = Number(body.requestId);
    const fileId = String(body.fileId || '').trim();
    if (!Number.isInteger(requestId) || requestId <= 0 || !fileId) {
      return NextResponse.json({ error: 'requestId y fileId son obligatorios' }, { status: 400 });
    }

    const { renewPendingSignerDeadline } = await import('@/lib/orion/signerDeadline');

    const result = await withMssqlPool(async (pool) => {
      if (await isOrionRequestWorkflowLocked(pool, requestId)) {
        throw Object.assign(new Error('La solicitud está cerrada.'), { status: 409 });
      }

      const ctx = await getRequestOrionContext(pool, requestId);
      if (
        !ctx ||
        !isOrionRequestCreator({
          currentUserEmail: email,
          currentUserId: String(userId),
          createdByEmail: ctx.requester_email,
          requesterId: ctx.id_requester,
        })
      ) {
        throw Object.assign(new Error('Solo el líder del proceso puede renovar el plazo.'), {
          status: 403,
        });
      }

      const loaded = await loadOrionFormBag(pool, requestId);
      if (!loaded) {
        throw Object.assign(new Error('Documento de firma no encontrado'), { status: 404 });
      }

      const current = getOrionDocumentFromBag(loaded.bag, fileId);
      const next = {
        ...current,
        signers: renewPendingSignerDeadline(current.signers),
      };
      const bag = setOrionDocumentInBag(loaded.bag, fileId, next);
      await upsertOrionFormBag(pool, requestId, loaded.field.id_form_field, bag);

      const pending = getCurrentPendingSigner(next.signers);
      await insertRequestNote(
        pool,
        requestId,
        `El líder renovó 24 h de plazo para ${pending?.name || pending?.email || 'el firmante en turno'} en "${current.fileName || fileId}".`,
        String(userId)
      );

      return { state: next, documents: bag.documents };
    });

    return NextResponse.json({
      success: true,
      state: result.state,
      documents: result.documents,
      message: 'Plazo renovado por 24 horas.',
    });
  } catch (err) {
    const status =
      err && typeof err === 'object' && 'status' in err
        ? Number((err as { status: number }).status) || 500
        : 500;
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status });
  }
}
