import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { extractBearer, isValidIntegrationApiKey } from '@/lib/integration/apiKeyAuth';
import { parseRequestIdFromExternalRef } from '@/lib/orion/config';
import { withMssqlPool } from '@/lib/mssqlPool';
import {
  applyOrionWebhookToRequest,
  getRequestOrionContext,
} from '@/lib/orion/service';
import type { OrionWebhookPayload } from '@/lib/orion/types';

const TAG = '[integrations/orion/document-status]';

/**
 * Webhook entrante desde GSS Firma (Orion) cuando un documento cambia de estado.
 * POST /api/integrations/orion/document-status
 */
export async function POST(req: NextRequest) {
  try {
    const token = extractBearer(req.headers.get('authorization'));
    if (!isValidIntegrationApiKey(token)) {
      console.warn(`${TAG} API key inválida o ausente`);
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as OrionWebhookPayload | null;
    if (!body?.orionDocumentId || !body?.status) {
      return NextResponse.json(
        { error: 'orionDocumentId y status son obligatorios' },
        { status: 400 }
      );
    }

    const fromBody = Number(body.synerlinkRequestId);
    const requestId =
      Number.isInteger(fromBody) && fromBody > 0
        ? fromBody
        : parseRequestIdFromExternalRef(body.externalRef);

    if (requestId == null || requestId <= 0) {
      return NextResponse.json(
        { error: 'synerlinkRequestId o externalRef válido es obligatorio' },
        { status: 400 }
      );
    }

    const statusUpper = String(body.status).toUpperCase();
    if (
      !['FIRMADO', 'RECHAZADO', 'EN_PROCESO', 'PENDIENTE_FIRMA', 'BORRADOR'].includes(statusUpper)
    ) {
      return NextResponse.json({ error: 'status no reconocido' }, { status: 400 });
    }

    const outcome = await withMssqlPool(async (pool) => {
      const ctx = await getRequestOrionContext(pool, requestId);
      if (!ctx) return { notFound: true as const };

      const currentState = await applyOrionWebhookToRequest(pool, {
        requestId,
        status: statusUpper,
        auditSummary: body.auditSummary,
        noteAuthorUserId: ctx.id_requester,
        patch: {
          orionDocumentId: body.orionDocumentId,
          externalRef: body.externalRef,
          status: statusUpper,
          signedFileUrl: body.signedFileUrl ?? null,
          signedAt: body.signedAt ?? null,
          signers: body.signers,
          auditSummary: body.auditSummary ?? null,
        },
      });

      return { notFound: false as const, ...currentState };
    });

    if (outcome.notFound) {
      return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 });
    }

    return NextResponse.json(
      {
        success: true,
        synerlinkRequestId: requestId,
        status: statusUpper,
        tasksUpdated: outcome.tasksUpdated,
        requestClosed: outcome.requestClosed,
        signerTasksClosed: outcome.signerTasksClosed,
        signerTasksOpened: outcome.signerTasksOpened,
        currentSignerEmail: outcome.currentSignerEmail,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error(`${TAG} Error:`, err);
    const status =
      err && typeof err === 'object' && 'status' in err
        ? Number((err as { status: number }).status) || 500
        : 500;
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status });
  }
}
