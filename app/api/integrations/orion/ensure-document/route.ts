import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import { getOrionConfig } from '@/lib/orion/config';
import {
  applyOrionWebhookToRequest,
  ensureOrionDocumentForRequest,
  getRequestOrionContext,
  loadOrionFormBag,
  syncOrionDocumentState,
  upsertOrionFormBag,
  userCanManageOrionRequest,
} from '@/lib/orion/service';
import { syncOrionSignerTasks } from '@/lib/orion/signerTasks';
import {
  getOrionDocumentFromBag,
  mergeOrionSignatureState,
  setOrionDocumentInBag,
} from '@/lib/orion/formValue';
import type { OrionSignatureState } from '@/lib/orion/types';
import { resolveOrionPermissions } from '@/lib/orion/permissions';
import { userHasPendingOrionSignerAuth } from '@/lib/orion/signerAuthorizations';
import { getCurrentPendingSigner } from '@/lib/orion/signerStatus';

function readFileId(source: { get?: (k: string) => string | null } | Record<string, unknown>): string | null {
  const raw =
    typeof (source as { get?: (k: string) => string | null }).get === 'function'
      ? (source as { get: (k: string) => string | null }).get('fileId')
      : (source as Record<string, unknown>).fileId;
  const value = String(raw || '').trim();
  return value || null;
}

/**
 * Consulta estado actual desde Orion (polling). Cualquier usuario autenticado.
 * GET /api/integrations/orion/ensure-document?requestId=123&fileId=...
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
    const fileId = readFileId(searchParams);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: 'requestId inválido' }, { status: 400 });
    }

    const userId = session.user?.id;
    const role = session.user?.role;
    const isAdmin = role === 'admin' || role === 'superadmin';

    const canManage = userId
      ? await withMssqlPool((pool) => userCanManageOrionRequest(pool, requestId, userId, isAdmin))
      : isAdmin;

    const payload = await withMssqlPool(async (pool) => {
      const synced = await syncOrionDocumentState(pool, requestId, fileId);
      if (!synced) return null;

      const documents = synced.bag.documents;
      for (const [fid, doc] of Object.entries(documents)) {
        const statusUpper = String(doc.status || '').toUpperCase();
        const terminal = statusUpper === 'FIRMADO' || statusUpper === 'RECHAZADO';
        if (!terminal && doc.orionDocumentId && (doc.signers?.length ?? 0) > 0) {
          const ctx = await getRequestOrionContext(pool, requestId);
          await syncOrionSignerTasks(pool, {
            requestId,
            state: doc,
            subject: ctx?.subject_request ?? null,
            documentStatus: statusUpper || 'BORRADOR',
            fileId: fid,
            fileName: doc.fileName,
          });
        }
      }

      return synced;
    });

    if (!payload) {
      return NextResponse.json({ error: 'Campo orion_signature no encontrado' }, { status: 404 });
    }

    const state = fileId
      ? getOrionDocumentFromBag(payload.bag, fileId)
      : payload.state;

    const permissions = resolveOrionPermissions({
      canManage,
      isAdmin,
      currentUserEmail: session.user.email,
      state,
    });

    let pendingAuthorization = false;
    if (userId && fileId) {
      const me = String(session.user.email || '')
        .trim()
        .toLowerCase();
      const pendingSigner = getCurrentPendingSigner(state.signers);
      const isMyTurn = Boolean(
        me && pendingSigner && String(pendingSigner.email || '').trim().toLowerCase() === me
      );

      const hasOpenAuth = await withMssqlPool((pool) =>
        userHasPendingOrionSignerAuth(pool, {
          requestId,
          userId: String(userId),
          fileId,
        })
      );

      // Auth pendiente solo si es su turno. No cerrar la del siguiente firmante
      // si Orion aún no marcó el turno (desfase local vs Orion).
      pendingAuthorization = hasOpenAuth && isMyTurn;
    }

    return NextResponse.json(
      {
        success: true,
        state,
        documents: payload.bag.documents,
        fileId: payload.fileId,
        canManage,
        isAdmin,
        permissions,
        pendingAuthorization,
        embedOrigin: cfg.embedOrigin,
      },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error interno';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Asegura documento Orion para un PDF de la solicitud.
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

    const fileId = readFileId(body);
    if (!fileId) {
      return NextResponse.json(
        { error: 'fileId es obligatorio (id del PDF en archivos adjuntos)' },
        { status: 400 }
      );
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
        fileId,
        fileName: body.fileName ? String(body.fileName) : undefined,
      })
    );

    return NextResponse.json(
      {
        success: true,
        created: result.created,
        formFieldId: result.formFieldId,
        state: result.state,
        documents: result.bag.documents,
        fileId: result.fileId,
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
 * Actualiza el JSON del campo orion_signature (postMessage del iframe) para un fileId.
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
    const fileId = readFileId(body);

    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: 'requestId inválido' }, { status: 400 });
    }

    await withMssqlPool(async (pool) => {
      const loaded = await loadOrionFormBag(pool, requestId);
      if (!loaded) {
        throw Object.assign(new Error('Campo orion_signature no encontrado'), { status: 404 });
      }

      const resolvedFileId =
        fileId ||
        String(patch.fileId || '').trim() ||
        Object.keys(loaded.bag.documents)[0];

      if (!resolvedFileId) {
        throw Object.assign(new Error('fileId requerido para actualizar el documento'), {
          status: 400,
        });
      }

      const current = getOrionDocumentFromBag(loaded.bag, resolvedFileId);
      const merged = mergeOrionSignatureState(current, { ...patch, fileId: resolvedFileId });
      const bag = setOrionDocumentInBag(loaded.bag, resolvedFileId, merged);

      await upsertOrionFormBag(pool, requestId, loaded.field.id_form_field, bag);

      const statusUpper = String(patch.status || merged.status || '').toUpperCase();
      if (['FIRMADO', 'RECHAZADO', 'EN_PROCESO', 'PENDIENTE_FIRMA'].includes(statusUpper)) {
        const ctx = await getRequestOrionContext(pool, requestId);
        await applyOrionWebhookToRequest(pool, {
          requestId,
          status: statusUpper,
          auditSummary: patch.auditSummary ?? merged.auditSummary,
          noteAuthorUserId: ctx?.id_requester ?? null,
          patch: merged,
          fileId: resolvedFileId,
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
