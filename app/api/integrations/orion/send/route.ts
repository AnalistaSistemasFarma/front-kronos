import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { sendOrionDocument } from '@/lib/orion/client';
import { getOrionConfig } from '@/lib/orion/config';
import {
  getOrionDocumentFromBag,
  setOrionDocumentInBag,
} from '@/lib/orion/formValue';
import { withMssqlPool } from '@/lib/mssqlPool';
import {
  assertUserCanEditOrionPreparation,
  getRequestOrionContext,
  loadOrionFormBag,
  syncOrionDocumentState,
  upsertOrionFormBag,
} from '@/lib/orion/service';
import { syncOrionSignerTasks } from '@/lib/orion/signerTasks';
import { createOrionSignerAuthorizations } from '@/lib/orion/signerAuthorizations';
import { applyPendingSignerTurnDeadline } from '@/lib/orion/signerDeadline';

/** POST /api/integrations/orion/send — enviar documento a firma en Orion */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email || !session.user.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    if (!getOrionConfig().enabled) {
      return NextResponse.json({ error: 'Integración Orion no configurada' }, { status: 503 });
    }

    const body = await req.json().catch(() => ({}));
    const requestId = Number(body.requestId);
    const fileId = String(body.fileId || '').trim();
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: 'requestId inválido' }, { status: 400 });
    }
    if (!fileId) {
      return NextResponse.json({ error: 'fileId es obligatorio' }, { status: 400 });
    }

    const isAdmin = session.user.role === 'admin' || session.user.role === 'superadmin';

    const outcome = await withMssqlPool(async (pool) => {
      await assertUserCanEditOrionPreparation(pool, {
        requestId,
        userId: String(session.user.id),
        userEmail: String(session.user.email),
        isAdmin,
        fileId,
      });

      const loaded = await loadOrionFormBag(pool, requestId);
      if (!loaded) throw Object.assign(new Error('Campo orion_signature no encontrado'), { status: 404 });

      const current = getOrionDocumentFromBag(loaded.bag, fileId);
      if (!current.orionDocumentId) {
        throw Object.assign(new Error('Primero cree el documento de firma para este archivo'), {
          status: 422,
        });
      }

      const res = await sendOrionDocument(current.orionDocumentId);
      if (!res.ok) {
        throw Object.assign(new Error(res.error || 'Error enviando documento a firma'), {
          status: res.status >= 500 ? 503 : 502,
        });
      }

      const synced = await syncOrionDocumentState(pool, requestId, fileId);
      let nextState = synced?.state ?? current;
      nextState = {
        ...nextState,
        signers: applyPendingSignerTurnDeadline(nextState.signers),
      };
      const bag = setOrionDocumentInBag(synced?.bag ?? loaded.bag, fileId, nextState);
      await upsertOrionFormBag(pool, requestId, loaded.field.id_form_field, bag);

      const ctx = await getRequestOrionContext(pool, requestId);

      const authResult = await createOrionSignerAuthorizations(pool, {
        requestId,
        fileId,
        fileName: nextState.fileName ?? current.fileName,
        signers: nextState.signers,
        subject: ctx?.subject_request ?? null,
      });

      await syncOrionSignerTasks(pool, {
        requestId,
        state: nextState,
        previousSigners: current.signers,
        subject: ctx?.subject_request ?? null,
        documentStatus: nextState.status ?? 'PENDIENTE_FIRMA',
        fileId,
        fileName: nextState.fileName,
      });

      return {
        state: nextState,
        documents: bag.documents,
        fileId,
        authorizationsCreated: authResult.created,
        authorizationsSkipped: authResult.skipped,
        authorizationErrors: authResult.errors,
      };
    });

    return NextResponse.json(
      {
        success: true,
        state: outcome.state,
        documents: outcome.documents,
        fileId: outcome.fileId,
        authorizationsCreated: outcome.authorizationsCreated,
        authorizationsSkipped: outcome.authorizationsSkipped,
        authorizationErrors: outcome.authorizationErrors,
      },
      { status: 200 }
    );
  } catch (err) {
    const status =
      err && typeof err === 'object' && 'status' in err
        ? Number((err as { status: number }).status) || 500
        : 500;
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status });
  }
}
