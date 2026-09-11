import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import { getOrionConfig } from '@/lib/orion/config';
import {
  applyOrionWebhookToRequest,
  assertUserCanEditOrionPreparation,
  ensureOrionDocumentForRequest,
  getRequestOrionContext,
  loadOrionFormBag,
  resolveOrionActorUserId,
  syncOrionDocumentState,
  userCanManageOrionRequest,
  userHasOrionSignPermission,
} from '@/lib/orion/service';
import { syncOrionSignerTasks } from '@/lib/orion/signerTasks';
import { getOrionDocumentFromBag } from '@/lib/orion/formValue';
import type { OrionSignatureState } from '@/lib/orion/types';
import { resolveOrionPermissions } from '@/lib/orion/permissions';
import { userHasPendingOrionSignerAuthBatch } from '@/lib/orion/signerAuthorizations';
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
 *
 * Query flags:
 * - lite=1  → solo BD + canManage (rápido; bootstrap UI)
 * - soft=1  → sync Orion GET sin rebuild de PDF ni tareas (polling)
 * - rebuild=1 → sync completo con rebuild de PDF firmado
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
    const lite = searchParams.get('lite') === '1';
    const soft = lite || searchParams.get('soft') === '1';
    const rebuildSigned = searchParams.get('rebuild') === '1';
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: 'requestId inválido' }, { status: 400 });
    }

    const sessionUserId = session.user?.id ? String(session.user.id) : null;
    const role = session.user?.role;
    const isAdmin = role === 'admin' || role === 'superadmin';

    // Bootstrap rápido: sin llamadas a Orion ni sync de tareas.
    if (lite) {
      const boot = await withMssqlPool(async (pool) => {
        const actorId = await resolveOrionActorUserId(pool, {
          userId: sessionUserId,
          email: session.user.email,
        });
        const [canManage, canSignPermission, loaded] = await Promise.all([
          actorId
            ? userCanManageOrionRequest(pool, requestId, actorId, isAdmin)
            : Promise.resolve(false),
          actorId ? userHasOrionSignPermission(pool, actorId, false) : Promise.resolve(false),
          loadOrionFormBag(pool, requestId),
        ]);
        return {
          canManage,
          canSignPermission,
          bag: loaded?.bag ?? { documents: {} as Record<string, OrionSignatureState> },
        };
      });
      const state = fileId ? getOrionDocumentFromBag(boot.bag, fileId) : {};
      return NextResponse.json(
        {
          success: true,
          lite: true,
          state,
          documents: boot.bag.documents,
          fileId: fileId || null,
          canManage: boot.canManage,
          canSignPermission: boot.canSignPermission,
          isAdmin,
          pendingAuthorization: false,
          embedOrigin: cfg.embedOrigin,
        },
        { status: 200 }
      );
    }

    // Soft/sync: un solo pool para canManage + bag + pending auth.
    const me = String(session.user.email || '')
      .trim()
      .toLowerCase();

    // soft sin fileId = bootstrap liviano (solo BD). Orion GET solo con fileId o rebuild.
    const softBagOnly = soft && !fileId && !rebuildSigned;

    const result = await withMssqlPool(async (pool) => {
      const actorId = await resolveOrionActorUserId(pool, {
        userId: sessionUserId,
        email: session.user.email,
      });
      const canManagePromise = actorId
        ? userCanManageOrionRequest(pool, requestId, actorId, isAdmin)
        : Promise.resolve(false);
      const canSignPromise = actorId
        ? userHasOrionSignPermission(pool, actorId, false)
        : Promise.resolve(false);

      if (softBagOnly) {
        const [canManage, canSignPermission, loaded] = await Promise.all([
          canManagePromise,
          canSignPromise,
          loadOrionFormBag(pool, requestId),
        ]);
        const bag = loaded?.bag ?? { documents: {} as Record<string, OrionSignatureState> };
        const pendingAuthorizationByFile: Record<string, boolean> = {};
        if (actorId && Object.keys(bag.documents).length > 0) {
          const authTargets = Object.keys(bag.documents);
          const myTurnFiles = authTargets.filter((fid) => {
            const docState = getOrionDocumentFromBag(bag, fid);
            const pendingSigner = getCurrentPendingSigner(docState.signers);
            return Boolean(
              me &&
                pendingSigner &&
                String(pendingSigner.email || '').trim().toLowerCase() === me
            );
          });
          if (myTurnFiles.length > 0) {
            const pendingMap = await userHasPendingOrionSignerAuthBatch(pool, {
              requestId,
              userId: String(actorId),
              fileIds: myTurnFiles,
            });
            for (const fid of authTargets) {
              pendingAuthorizationByFile[fid] = Boolean(pendingMap[fid]);
            }
          } else {
            for (const fid of authTargets) pendingAuthorizationByFile[fid] = false;
          }
        }
        return {
          canManage,
          canSignPermission,
          payload: loaded
            ? {
                state: {},
                bag,
                fileId: fileId || Object.keys(bag.documents)[0] || '',
              }
            : null,
          pendingAuthorization: Object.values(pendingAuthorizationByFile).some(Boolean),
          pendingAuthorizationByFile,
        };
      }

      const [canManage, canSignPermission, synced] = await Promise.all([
        canManagePromise,
        canSignPromise,
        syncOrionDocumentState(pool, requestId, fileId, {
          rebuildSigned,
        }),
      ]);
      if (!synced) {
        return {
          canManage,
          canSignPermission,
          payload: null as Awaited<ReturnType<typeof syncOrionDocumentState>>,
          pendingAuthorization: false,
          pendingAuthorizationByFile: {} as Record<string, boolean>,
        };
      }

      // Tareas de firmantes: solo sync completo (no soft) y preferible con fileId.
      if (!soft) {
        const documents = synced.bag.documents;
        const entries: Array<[string, (typeof documents)[string]]> =
          fileId && documents[fileId]
            ? [[fileId, documents[fileId]]]
            : Object.entries(documents);
        for (const [fid, doc] of entries) {
          if (!doc) continue;
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
      }

      const pendingAuthorizationByFile: Record<string, boolean> = {};
      if (actorId) {
        const authTargets =
          fileId && synced.bag.documents[fileId]
            ? [fileId]
            : Object.keys(synced.bag.documents);
        const myTurnFiles = authTargets.filter((fid) => {
          const docState = getOrionDocumentFromBag(synced.bag, fid);
          const pendingSigner = getCurrentPendingSigner(docState.signers);
          return Boolean(
            me &&
              pendingSigner &&
              String(pendingSigner.email || '').trim().toLowerCase() === me
          );
        });
        if (myTurnFiles.length > 0) {
          const pendingMap = await userHasPendingOrionSignerAuthBatch(pool, {
            requestId,
            userId: String(actorId),
            fileIds: myTurnFiles,
          });
          for (const fid of authTargets) {
            pendingAuthorizationByFile[fid] = Boolean(pendingMap[fid]);
          }
        } else {
          for (const fid of authTargets) pendingAuthorizationByFile[fid] = false;
        }
      }

      const pendingAuthorization = fileId
        ? Boolean(pendingAuthorizationByFile[fileId])
        : Object.values(pendingAuthorizationByFile).some(Boolean);

      return {
        canManage,
        canSignPermission,
        payload: synced,
        pendingAuthorization,
        pendingAuthorizationByFile,
      };
    });

    if (!result.payload) {
      // Solicitud nueva / aún sin bag: igual devolvemos canManage para no bloquear Gestionar.
      return NextResponse.json(
        {
          success: true,
          state: {},
          documents: {},
          fileId: fileId || null,
          canManage: result.canManage,
          canSignPermission: result.canSignPermission,
          isAdmin,
          pendingAuthorization: false,
          pendingAuthorizationByFile: {},
          embedOrigin: cfg.embedOrigin,
        },
        { status: 200 }
      );
    }

    const state = fileId
      ? getOrionDocumentFromBag(result.payload.bag, fileId)
      : result.payload.state;

    const permissions = resolveOrionPermissions({
      canManage: result.canManage,
      isAdmin,
      currentUserEmail: session.user.email,
      state,
    });

    return NextResponse.json(
      {
        success: true,
        state,
        documents: result.payload.bag.documents,
        fileId: result.payload.fileId,
        canManage: result.canManage,
        canSignPermission: result.canSignPermission,
        isAdmin,
        permissions,
        pendingAuthorization: result.pendingAuthorization,
        pendingAuthorizationByFile: result.pendingAuthorizationByFile,
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

    const role = session.user?.role;
    const isAdmin = role === 'admin' || role === 'superadmin';

    const pdfBase64 =
      typeof body.pdfBase64 === 'string' && body.pdfBase64.trim()
        ? body.pdfBase64.trim()
        : undefined;

    const result = await withMssqlPool(async (pool) => {
      const actorId = await resolveOrionActorUserId(pool, {
        userId: session.user?.id ? String(session.user.id) : null,
        email,
      });
      const loaded = await loadOrionFormBag(pool, requestId);
      const current = loaded ? getOrionDocumentFromBag(loaded.bag, fileId) : null;
      const isCreateOrReplace = !current?.orionDocumentId || Boolean(pdfBase64);

      if (isCreateOrReplace) {
        if (!actorId) {
          throw Object.assign(new Error('No autorizado'), { status: 401 });
        }
        await assertUserCanEditOrionPreparation(pool, {
          requestId,
          userId: String(actorId),
          userEmail: email,
          isAdmin,
          fileId,
        });
      } else {
        const canManage = actorId
          ? await userCanManageOrionRequest(pool, requestId, String(actorId), isAdmin)
          : false;
        if (!canManage) {
          throw Object.assign(
            new Error('No tiene permiso para gestionar la firma de esta solicitud'),
            { status: 403 }
          );
        }
      }

      return ensureOrionDocumentForRequest(pool, {
        requestId,
        createdByEmail: String(body.createdByEmail || email),
        title: body.title ? String(body.title) : undefined,
        pdfBase64,
        refresh: Boolean(body.refresh),
        fileId,
        fileName: body.fileName ? String(body.fileName) : undefined,
      });
    });

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
 *
 * No confía en status/signedFileUrl/signers del cliente: sincroniza desde Orion
 * y solo entonces aplica efectos de cierre/turno.
 */
export async function PATCH(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const requestId = Number(body.requestId);
    const fileId = readFileId(body) || String((body.patch as { fileId?: string } | undefined)?.fileId || '').trim() || null;

    if (!Number.isInteger(requestId) || requestId <= 0) {
      return NextResponse.json({ error: 'requestId inválido' }, { status: 400 });
    }
    if (!fileId) {
      return NextResponse.json({ error: 'fileId requerido' }, { status: 400 });
    }

    const role = session.user?.role;
    const isAdmin = role === 'admin' || role === 'superadmin';
    const me = String(session.user.email || '')
      .trim()
      .toLowerCase();

    await withMssqlPool(async (pool) => {
      const actorId = await resolveOrionActorUserId(pool, {
        userId: session.user?.id != null ? String(session.user.id) : null,
        email: session.user.email,
      });
      const loaded = await loadOrionFormBag(pool, requestId);
      if (!loaded) {
        throw Object.assign(new Error('Campo orion_signature no encontrado'), { status: 404 });
      }

      const current = getOrionDocumentFromBag(loaded.bag, fileId);
      const canManage = actorId
        ? await userCanManageOrionRequest(pool, requestId, actorId, isAdmin)
        : false;
      const isSigner = (current.signers ?? []).some(
        (s) => String(s.email || '').trim().toLowerCase() === me
      );
      if (!canManage && !isSigner && !isAdmin) {
        throw Object.assign(
          new Error('No tiene permiso para actualizar el estado de firma de esta solicitud'),
          { status: 403 }
        );
      }

      // Fuente de verdad: Orion (no el patch del cliente → evita falsificar FIRMADO / SSRF).
      const synced = await syncOrionDocumentState(pool, requestId, fileId, {
        rebuildSigned: false,
      });
      if (!synced) {
        throw Object.assign(new Error('No se pudo sincronizar el documento'), { status: 404 });
      }

      const live = synced.state;
      const statusUpper = String(live.status || '').toUpperCase();
      if (['FIRMADO', 'RECHAZADO', 'EN_PROCESO', 'PENDIENTE_FIRMA', 'DEVUELTO'].includes(statusUpper)) {
        const ctx = await getRequestOrionContext(pool, requestId);
        await applyOrionWebhookToRequest(pool, {
          requestId,
          status: statusUpper,
          auditSummary: live.auditSummary,
          noteAuthorUserId: actorId || ctx?.id_requester || null,
          patch: live,
          fileId,
          bag: synced.bag,
          fieldId: loaded.field.id_form_field,
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
