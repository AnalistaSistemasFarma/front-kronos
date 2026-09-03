import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { assignOrionSigners } from '@/lib/orion/client';
import { getOrionConfig } from '@/lib/orion/config';
import { getOrionDocumentFromBag } from '@/lib/orion/formValue';
import { withMssqlPool } from '@/lib/mssqlPool';
import {
  isOrionRequestWorkflowLocked,
  loadOrionFormBag,
  syncOrionDocumentState,
  userCanManageOrionRequest,
  getRequestOrionContext,
} from '@/lib/orion/service';
import { syncOrionSignerTasks } from '@/lib/orion/signerTasks';
import type { OrionAssignSignersPayload } from '@/lib/orion/types';

/** POST /api/integrations/orion/signers — asignar firmantes vía API Orion */
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
    const payload = body as OrionAssignSignersPayload & { requestId?: number; fileId?: string };

    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: 'requestId inválido' }, { status: 400 });
    }
    if (!fileId) {
      return NextResponse.json({ error: 'fileId es obligatorio' }, { status: 400 });
    }
    if (!payload.mode || !Array.isArray(payload.signers) || payload.signers.length === 0) {
      return NextResponse.json({ error: 'mode y signers son obligatorios' }, { status: 400 });
    }

    const userId = session.user.id;
    const isAdmin = session.user.role === 'admin' || session.user.role === 'superadmin';
    const canManage = userId
      ? await withMssqlPool((pool) => userCanManageOrionRequest(pool, requestId, userId, isAdmin))
      : isAdmin;

    if (!canManage) {
      return NextResponse.json({ error: 'Sin permiso para asignar firmantes' }, { status: 403 });
    }

    const result = await withMssqlPool(async (pool) => {
      if (await isOrionRequestWorkflowLocked(pool, requestId)) {
        throw Object.assign(
          new Error('La solicitud está cerrada. No se puede modificar la asignación de firmantes.'),
          { status: 409 }
        );
      }

      const loaded = await loadOrionFormBag(pool, requestId);
      if (!loaded) throw Object.assign(new Error('Campo orion_signature no encontrado'), { status: 404 });

      const current = getOrionDocumentFromBag(loaded.bag, fileId);
      if (!current.orionDocumentId) {
        throw Object.assign(new Error('Primero cree el documento de firma para este archivo'), {
          status: 422,
        });
      }

      const res = await assignOrionSigners(current.orionDocumentId, {
        mode: payload.mode,
        signers: payload.signers,
      });

      if (!res.ok || !res.data) {
        throw Object.assign(new Error(res.error || 'Error asignando firmantes en Orion'), {
          status: res.status >= 500 ? 503 : 502,
        });
      }

      const previous = current;
      const synced = await syncOrionDocumentState(pool, requestId, fileId);
      const state = synced?.state ?? previous;
      if (state.orionDocumentId && (state.signers?.length ?? 0) > 0) {
        const ctx = await getRequestOrionContext(pool, requestId);
        await syncOrionSignerTasks(pool, {
          requestId,
          state,
          previousSigners: previous.signers,
          subject: ctx?.subject_request ?? null,
          documentStatus: String(state.status || 'BORRADOR').toUpperCase(),
          fileId,
          fileName: state.fileName,
        });
      }
      return { state, documents: synced?.bag.documents ?? loaded.bag.documents, fileId };
    });

    return NextResponse.json(
      { success: true, state: result.state, documents: result.documents, fileId: result.fileId },
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
