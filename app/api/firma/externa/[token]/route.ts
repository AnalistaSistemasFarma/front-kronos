import { NextResponse } from 'next/server';
import { withMssqlPool } from '@/lib/mssqlPool';
import {
  getOrionDocumentFromBag,
  setOrionDocumentInBag,
} from '@/lib/orion/formValue';
import {
  applyOrionWebhookToRequest,
  getRequestOrionContext,
  loadOrionFormBag,
  syncOrionDocumentState,
  upsertOrionFormBag,
} from '@/lib/orion/service';
import {
  findInviteByPlainToken,
  markInviteUsed,
  verifySignedInviteToken,
} from '@/lib/orion/signerInvites';
import { acceptOrionSignerTurn, ORION_BIOMETRIC_CONSENT_VERSION, resolveOrionAbsoluteUrl, fetchOrionSignerSignUrl } from '@/lib/orion/client';
import {
  getCurrentPendingSigner,
  isSignerCompleted,
} from '@/lib/orion/signerStatus';

function normalizeEmail(email?: string | null) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

/** GET /api/firma/externa/[token] — resuelve invite público. */
export async function GET(
  _req: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token: rawToken } = await context.params;
    const token = decodeURIComponent(rawToken || '').trim();
    if (!token) {
      return NextResponse.json({ error: 'Token inválido' }, { status: 400 });
    }

    const payload = verifySignedInviteToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Enlace inválido o vencido' }, { status: 410 });
    }

    const data = await withMssqlPool(async (pool) => {
      const loaded = await loadOrionFormBag(pool, payload.r);
      if (!loaded) throw Object.assign(new Error('Documento no encontrado'), { status: 404 });

      const state = getOrionDocumentFromBag(loaded.bag, payload.f);
      const invite = findInviteByPlainToken(state, token);
      if (!invite) {
        throw Object.assign(
          new Error('Invitación no encontrada o regenerada. Solicite un nuevo enlace.'),
          { status: 410 }
        );
      }

      const signer = (state.signers ?? []).find((s) => normalizeEmail(s.email) === payload.e);
      const pending = getCurrentPendingSigner(state.signers);
      const isMyTurn = normalizeEmail(pending?.email) === payload.e;
      const alreadySigned = signer ? isSignerCompleted(signer.status) : false;
      const ctx = await getRequestOrionContext(pool, payload.r);
      let signUrlRaw = String(signer?.signUrl || invite.signUrl || '').trim() || null;
      let signUrl = signUrlRaw ? resolveOrionAbsoluteUrl(signUrlRaw) || signUrlRaw : null;
      // Si el bag no tiene /sign/ de Orion, pedirlo en vivo (evita 404 en /firma/externa).
      if ((!signUrl || !/\/sign\//i.test(signUrl)) && state.orionDocumentId) {
        const live = await fetchOrionSignerSignUrl(
          state.orionDocumentId,
          payload.e,
          signer?.order
        );
        if (live.ok && live.signUrl) {
          signUrl = live.signUrl;
          signUrlRaw = live.signUrl;
        }
      }
      const needsFingerprint = signer?.requireFingerprint === true;

      return {
        requestId: payload.r,
        fileId: payload.f,
        email: payload.e,
        name: invite.name || signer?.name || null,
        fileName: state.fileName || null,
        subject: ctx?.subject_request ?? null,
        status: state.status || null,
        alreadySigned,
        isMyTurn,
        signUrl,
        requireFingerprint: needsFingerprint,
      };
    });

    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    const status =
      err && typeof err === 'object' && 'status' in err
        ? Number((err as { status: number }).status) || 500
        : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error interno' },
      { status }
    );
  }
}

/** POST /api/firma/externa/[token] — completa firma externa (rúbrica / fingerprint). */
export async function POST(
  req: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token: rawToken } = await context.params;
    const token = decodeURIComponent(rawToken || '').trim();
    const body = await req.json().catch(() => ({}));
    const signatureDataUrl =
      typeof body.signatureDataUrl === 'string' ? body.signatureDataUrl.trim() : null;
    const fingerprintDataUrl =
      typeof body.fingerprintDataUrl === 'string' ? body.fingerprintDataUrl.trim() : null;

    const payload = verifySignedInviteToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Enlace inválido o vencido' }, { status: 410 });
    }

    const result = await withMssqlPool(async (pool) => {
      const loaded = await loadOrionFormBag(pool, payload.r);
      if (!loaded) throw Object.assign(new Error('Documento no encontrado'), { status: 404 });

      let state = getOrionDocumentFromBag(loaded.bag, payload.f);
      const invite = findInviteByPlainToken(state, token);
      if (!invite) {
        throw Object.assign(new Error('Invitación no válida. Solicite un nuevo enlace.'), {
          status: 410,
        });
      }

      const signer = (state.signers ?? []).find((s) => normalizeEmail(s.email) === payload.e);
      if (!signer) {
        throw Object.assign(new Error('Firmante no encontrado'), { status: 404 });
      }
      if (isSignerCompleted(signer.status)) {
        return { alreadySigned: true, state };
      }

      if (!state.orionDocumentId) {
        throw Object.assign(new Error('Documento Orion no disponible'), { status: 422 });
      }

      const pending = getCurrentPendingSigner(state.signers);
      if (pending && normalizeEmail(pending.email) !== payload.e) {
        throw Object.assign(
          new Error('Aún no es su turno de firma. Espere a que firmen los anteriores.'),
          { status: 409 }
        );
      }

      const needsFingerprint = signer?.requireFingerprint === true;

      const accept = await acceptOrionSignerTurn(state.orionDocumentId, payload.e, {
        signatureDataUrl,
        fingerprintDataUrl: needsFingerprint ? fingerprintDataUrl : null,
        fullName: invite.name || signer.name,
        requireFingerprint: needsFingerprint,
        signOrder: Number(signer?.order) || null,
        ...(needsFingerprint
          ? {
              biometricConsentAccepted: true,
              biometricConsentVersion: ORION_BIOMETRIC_CONSENT_VERSION,
              biometricConsentAcceptedAt: new Date().toISOString(),
            }
          : {}),
      });
      if (!accept.ok) {
        throw Object.assign(new Error(accept.error || 'No se pudo registrar la firma en Orion'), {
          status: accept.status >= 500 ? 503 : 502,
        });
      }

      state = markInviteUsed(state, payload.e);
      let bag = setOrionDocumentInBag(loaded.bag, payload.f, state);
      await upsertOrionFormBag(pool, payload.r, loaded.field.id_form_field, bag);

      const synced = await syncOrionDocumentState(pool, payload.r, payload.f);
      state = synced?.state ?? state;
      bag = synced?.bag ?? bag;

      const statusUpper = String(state.status || '').toUpperCase();
      await applyOrionWebhookToRequest(pool, {
        requestId: payload.r,
        patch: state,
        status: statusUpper || 'EN_PROCESO',
        noteAuthorUserId: null,
        fileId: payload.f,
        bag,
        fieldId: loaded.field.id_form_field,
      });

      const refreshed = await loadOrionFormBag(pool, payload.r);
      const next = refreshed
        ? getOrionDocumentFromBag(refreshed.bag, payload.f)
        : state;

      return { alreadySigned: false, state: next };
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const status =
      err && typeof err === 'object' && 'status' in err
        ? Number((err as { status: number }).status) || 500
        : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error interno' },
      { status }
    );
  }
}
