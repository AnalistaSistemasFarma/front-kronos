import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { assignOrionSigners } from '@/lib/orion/client';
import { getOrionConfig } from '@/lib/orion/config';
import { parseOrionSignatureState } from '@/lib/orion/formValue';
import { withMssqlPool } from '@/lib/mssqlPool';
import {
  findOrionSignatureField,
  syncOrionDocumentState,
  userCanManageOrionRequest,
} from '@/lib/orion/service';
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
    const payload = body as OrionAssignSignersPayload & { requestId?: number };

    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: 'requestId inválido' }, { status: 400 });
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
      const field = await findOrionSignatureField(pool, requestId);
      if (!field) throw Object.assign(new Error('Campo orion_signature no encontrado'), { status: 404 });

      const current = parseOrionSignatureState(field.value_text);
      if (!current.orionDocumentId) {
        throw Object.assign(new Error('Primero cree el documento de firma'), { status: 422 });
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

      const state = await syncOrionDocumentState(pool, requestId);
      return state ?? parseOrionSignatureState(field.value_text);
    });

    return NextResponse.json({ success: true, state: result }, { status: 200 });
  } catch (err) {
    const status =
      err && typeof err === 'object' && 'status' in err
        ? Number((err as { status: number }).status) || 500
        : 500;
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status });
  }
}
