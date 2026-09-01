import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import { getOrionConfig } from '@/lib/orion/config';
import {
  applyOrionWebhookToRequest,
  ensureOrionDocumentForRequest,
  findOrionSignatureField,
  getRequestOrionContext,
  syncOrionDocumentState,
  upsertOrionFormValue,
  userCanManageOrionRequest,
} from '@/lib/orion/service';
import {
  mergeOrionSignatureState,
  parseOrionSignatureState,
} from '@/lib/orion/formValue';
import type { OrionSignatureState } from '@/lib/orion/types';
import { resolveOrionPermissions } from '@/lib/orion/permissions';

/**
 * Consulta estado actual desde Orion (polling). Cualquier usuario autenticado.
 * GET /api/integrations/orion/ensure-document?requestId=123
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const cfg = getOrionConfig();
    if (!cfg.enabled) {
      return NextResponse.json(
        { error: 'Integración Orion no configurada en el servidor' },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(req.url);
    const requestId = Number(searchParams.get('requestId'));
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: 'requestId inválido' }, { status: 400 });
    }

    const userId = session.user?.id;
    const role = session.user?.role;
    const isAdmin = role === 'admin' || role === 'superadmin';

    const canManage = userId
      ? await withMssqlPool((pool) => userCanManageOrionRequest(pool, requestId, userId, isAdmin))
      : isAdmin;

    const state = await withMssqlPool((pool) => syncOrionDocumentState(pool, requestId));
    if (!state) {
      return NextResponse.json({ error: 'Campo orion_signature no encontrado' }, { status: 404 });
    }

    const permissions = resolveOrionPermissions({
      canManage,
      isAdmin,
      currentUserEmail: session.user.email,
      state,
    });

    return NextResponse.json(
      { success: true, state, canManage, isAdmin, permissions, embedOrigin: cfg.embedOrigin },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Asegura documento Orion para una solicitud (crear o reutilizar por externalRef).
 * POST /api/integrations/orion/ensure-document
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    if (!email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const cfg = getOrionConfig();
    if (!cfg.enabled) {
      return NextResponse.json(
        { error: 'Integración Orion no configurada en el servidor' },
        { status: 503 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const requestId = Number(body.requestId);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: 'requestId inválido' }, { status: 400 });
    }

    const userId = session.user?.id;
    const role = session.user?.role;
    const isAdmin = role === 'admin' || role === 'superadmin';

    const canManage = userId
      ? await withMssqlPool((pool) => userCanManageOrionRequest(pool, requestId, userId, isAdmin))
      : isAdmin;

    if (!canManage) {
      return NextResponse.json(
        { error: 'No tiene permiso para gestionar la firma de esta solicitud' },
        { status: 403 }
      );
    }

    const pdfBase64 =
      typeof body.pdfBase64 === 'string' && body.pdfBase64.trim()
        ? body.pdfBase64.trim()
        : undefined;

    const result = await withMssqlPool((pool) =>
      ensureOrionDocumentForRequest(pool, {
        requestId,
        createdByEmail: String(body.createdByEmail || email),
        title: body.title ? String(body.title) : undefined,
        pdfBase64,
        refresh: Boolean(body.refresh),
      })
    );

    return NextResponse.json(
      {
        success: true,
        created: result.created,
        formFieldId: result.formFieldId,
        state: result.state,
        embedOrigin: cfg.embedOrigin,
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

/**
 * Actualiza el JSON del campo orion_signature (postMessage del iframe).
 * PATCH /api/integrations/orion/ensure-document
 */
export async function PATCH(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const requestId = Number(body.requestId);
    const patch = (body.patch ?? {}) as Partial<OrionSignatureState>;

    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: 'requestId inválido' }, { status: 400 });
    }

    await withMssqlPool(async (pool) => {
      const field = await findOrionSignatureField(pool, requestId);
      if (!field) {
        throw Object.assign(new Error('Campo orion_signature no encontrado'), { status: 404 });
      }

      const current = parseOrionSignatureState(field.value_text);
      const merged = mergeOrionSignatureState(current, patch);
      await upsertOrionFormValue(pool, requestId, field.id_form_field, merged);

      const statusUpper = String(patch.status || merged.status || '').toUpperCase();
      if (['FIRMADO', 'RECHAZADO', 'EN_PROCESO', 'PENDIENTE_FIRMA'].includes(statusUpper)) {
        const ctx = await getRequestOrionContext(pool, requestId);
        await applyOrionWebhookToRequest(pool, {
          requestId,
          status: statusUpper,
          auditSummary: patch.auditSummary ?? merged.auditSummary,
          noteAuthorUserId: ctx?.id_requester ?? null,
          patch: merged,
        });
      }
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    const status =
      err && typeof err === 'object' && 'status' in err
        ? Number((err as { status: number }).status) || 500
        : 500;
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status });
  }
}
