import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { sendOrionDocument } from '@/lib/orion/client';
import { getOrionConfig } from '@/lib/orion/config';
import { getOrionDocumentFromBag } from '@/lib/orion/formValue';
import { withMssqlPool } from '@/lib/mssqlPool';
import {
  getRequestOrionContext,
  loadOrionFormBag,
  syncOrionDocumentState,
  userCanManageOrionRequest,
} from '@/lib/orion/service';
import { syncOrionSignerTasks } from '@/lib/orion/signerTasks';
import { createOrionSignerAuthorizations } from '@/lib/orion/signerAuthorizations';

/** POST /api/integrations/orion/send — enviar documento a firma en Orion */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
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

    const userId = session.user.id;
    const isAdmin = session.user.role === 'admin' || session.user.role === 'superadmin';
    const canManage = userId
      ? await withMssqlPool((pool) => userCanManageOrionRequest(pool, requestId, userId, isAdmin))
      : isAdmin;

    if (!canManage) {
      return NextResponse.json({ error: 'Sin permiso para enviar a firma' }, { status: 403 });
    }

    const outcome = await withMssqlPool(async (pool) => {
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
      const nextState = synced?.state ?? current;
      const ctx = await getRequestOrionContext(pool, requestId);

      // 1) Autorización Kronos por firmante (Autoriza → ve → firma)
      const authResult = await createOrionSignerAuthorizations(pool, {
        requestId,
        fileId,
        fileName: nextState.fileName ?? current.fileName,
        signers: nextState.signers,
        subject: ctx?.subject_request ?? null,
      });

      // 2) Tareas de firma por firmante×documento (quedan listas tras autorizar)
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
        documents: synced?.bag.documents ?? loaded.bag.documents,
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
