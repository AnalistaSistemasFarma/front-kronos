import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import {
  getOrionDocumentFromBag,
  mergeOrionSignatureState,
  setOrionDocumentInBag,
} from '@/lib/orion/formValue';
import {
  assertUserCanEditOrionPreparation,
  getRequestOrionContext,
  loadOrionFormBag,
  upsertOrionFormBag,
} from '@/lib/orion/service';
import {
  createOrionSignerInvite,
  ensureSignerInvites,
  findInviteByEmail,
  markInviteSent,
  upsertSignerInvite,
} from '@/lib/orion/signerInvites';
import { sendExternalSignerInviteEmail } from '@/lib/orion/inviteEmail';
import { getOrionDocument, resolveOrionAbsoluteUrl, resolvePublicAppOrigin, fetchOrionSignerSignUrl } from '@/lib/orion/client';
import { buildOrionExternalRef } from '@/lib/orion/config';
import type { OrionSignatureState } from '@/lib/orion/types';

function normalizeEmail(email?: string | null) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function isOrionSignUrl(url?: string | null): boolean {
  const u = String(url || '').trim();
  if (!u) return false;
  // Solo /sign/{token} de Orion (nunca /firma/externa de SynerLink).
  if (/\/firma\/externa\//i.test(u)) return false;
  return /\/sign\/[^/?#]+/i.test(u);
}

/** URL de invitación: SOLO Orion `/sign/{token}` (como genera front-orion). */
function pickShareUrl(params: {
  orionSignUrl?: string | null;
}): { shareUrl: string | null; source: 'orion' | null } {
  const orion =
    resolveOrionAbsoluteUrl(params.orionSignUrl) || String(params.orionSignUrl || '').trim();
  if (orion && isOrionSignUrl(orion)) {
    return { shareUrl: orion, source: 'orion' };
  }
  return { shareUrl: null, source: null };
}

/**
 * Resuelve la URL pública Orion `/sign/{token}` para un firmante.
 * 1) Bag (si ya es Orion)
 * 2) GET embed/sign-url de Orion (crea/reutiliza invitación pendiente)
 */
async function resolveLiveOrionSignUrl(params: {
  orionDocumentId?: string | null;
  email: string;
  signOrder?: number | null;
  bagSignUrl?: string | null;
  /** Si true, Orion también reenvía el correo (POST sendEmail). */
  sendEmail?: boolean;
}): Promise<{ signUrl: string | null; error?: string }> {
  const fromBag =
    resolveOrionAbsoluteUrl(params.bagSignUrl) || String(params.bagSignUrl || '').trim();
  if (fromBag && isOrionSignUrl(fromBag)) {
    return { signUrl: fromBag };
  }

  const docId = String(params.orionDocumentId || '').trim();
  if (!docId) {
    return {
      signUrl: null,
      error: 'Documento aún no vinculado a Orion. Prepare el PDF y envíe a firma.',
    };
  }

  const live = await fetchOrionSignerSignUrl(docId, params.email, params.signOrder, {
    sendEmail: params.sendEmail === true,
  });
  if (live.ok && live.signUrl && isOrionSignUrl(live.signUrl)) {
    return { signUrl: live.signUrl };
  }
  return {
    signUrl: null,
    error:
      live.error ||
      'Orion no devolvió /sign/… (¿firmante asignado y en PENDIENTE? ¿documento enviado a firma?)',
  };
}

/**
 * Trae el documento vivo de Orion y fusiona signUrl/status en el bag Kronos.
 * Así SynerLink no inventa enlaces: usa los /sign/{token} que Orion genera.
 */
async function syncStateFromOrion(params: {
  requestId: number;
  fileId: string;
  state: OrionSignatureState;
}): Promise<{
  state: OrionSignatureState;
  orionSynced: boolean;
  orionError?: string;
}> {
  const orionDocumentId = String(params.state.orionDocumentId || '').trim();
  if (!orionDocumentId) {
    return {
      state: params.state,
      orionSynced: false,
      orionError: 'Documento aún no vinculado a Orion. Prepare y envíe a firma primero.',
    };
  }

  const live = await getOrionDocument(orionDocumentId);
  if (!live.ok || !live.data) {
    return {
      state: params.state,
      orionSynced: false,
      orionError: live.error || 'No se pudo sincronizar con Orion',
    };
  }

  const externalRef =
    String(params.state.externalRef || '').trim() ||
    buildOrionExternalRef(params.requestId, params.fileId);

  const mappedSigners = (live.data.signers ?? []).map((s) => ({
    ...s,
    signUrl: resolveOrionAbsoluteUrl(s.signUrl) || s.signUrl || null,
  }));

  const merged = mergeOrionSignatureState(params.state, {
    ...params.state,
    orionDocumentId: live.data.orionDocumentId || orionDocumentId,
    status: live.data.status ?? params.state.status,
    embedUrl: live.data.embedUrl ?? params.state.embedUrl,
    signedFileUrl: live.data.signedFileUrl ?? params.state.signedFileUrl,
    signedAt: live.data.signedAt ?? params.state.signedAt,
    signers: mappedSigners.length > 0 ? mappedSigners : params.state.signers,
    externalRef: live.data.externalRef || externalRef,
  });

  return { state: merged, orionSynced: true };
}

/**
 * GET — lista firmantes + URL de Orion (tras sync).
 * POST — { action: ensure|send|url|regenerate, email? }
 *
 * La URL canónica la genera Orion (`/sign/{token}`). SynerLink solo la muestra/envía.
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email || !session.user.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const requestId = Number(searchParams.get('requestId'));
    const fileId = String(searchParams.get('fileId') || '').trim();
    if (!Number.isInteger(requestId) || requestId <= 0 || !fileId) {
      return NextResponse.json({ error: 'requestId y fileId son obligatorios' }, { status: 400 });
    }

    const isAdmin = session.user.role === 'admin' || session.user.role === 'superadmin';
    // Nunca usar Origin localhost en correos: preferir NEXTAUTH_URL / APP_URL.
    const origin = resolvePublicAppOrigin(req.headers.get('origin'));

    const data = await withMssqlPool(async (pool) => {
      await assertUserCanEditOrionPreparation(pool, {
        requestId,
        userId: String(session.user.id),
        userEmail: String(session.user.email || ''),
        isAdmin,
        fileId,
      });

      const loaded = await loadOrionFormBag(pool, requestId);
      if (!loaded) {
        throw Object.assign(new Error('Campo orion_signature no encontrado'), { status: 404 });
      }

      let state = getOrionDocumentFromBag(loaded.bag, fileId);
      const synced = await syncStateFromOrion({ requestId, fileId, state });
      state = synced.state;

      // Invites locales solo auditoría; la URL que se muestra es siempre Orion /sign/.
      const ensured = ensureSignerInvites({ state, requestId, fileId, origin });
      state = ensured.state;

      const bag = setOrionDocumentInBag(loaded.bag, fileId, state);
      await upsertOrionFormBag(pool, requestId, loaded.field.id_form_field, bag);

      const resolveErrors: string[] = [];
      const signers = await Promise.all(
        (state.signers ?? []).map(async (s) => {
          const email = normalizeEmail(s.email);
          const invite = findInviteByEmail(state, email);
          const isExternal = String(s.type || '').toLowerCase() === 'external';
          // Tras sync, s.signUrl ya puede venir de Orion (buildSignerResponses).
          const resolved = await resolveLiveOrionSignUrl({
            orionDocumentId: state.orionDocumentId,
            email,
            signOrder: s.order,
            bagSignUrl: s.signUrl || invite?.signUrl,
          });
          if (resolved.error && !resolved.signUrl) {
            resolveErrors.push(`${email}: ${resolved.error}`);
          }
          if (resolved.signUrl) {
            s.signUrl = resolved.signUrl;
          }
          const picked = pickShareUrl({ orionSignUrl: resolved.signUrl });
          return {
            email,
            name: s.name || null,
            order: s.order ?? null,
            type: s.type || 'internal',
            status: s.status || null,
            signUrl: picked.shareUrl,
            inviteUrl: picked.shareUrl,
            shareUrl: picked.shareUrl,
            shareSource: picked.source,
            inviteSentAt: invite?.sentAt || null,
            inviteExpiresAt: invite?.expiresAt || null,
            cardCode: s.cardCode || invite?.cardCode || null,
            isExternal,
          };
        })
      );

      // Guardar signUrls Orion recién resueltas.
      const bag2 = setOrionDocumentInBag(loaded.bag, fileId, state);
      await upsertOrionFormBag(pool, requestId, loaded.field.id_form_field, bag2);

      const missingOrionUrl = signers
        .filter((s) => s.shareSource !== 'orion' && s.email)
        .map((s) => s.email);

      return {
        signers,
        fileName: state.fileName || null,
        status: state.status || null,
        orionDocumentId: state.orionDocumentId || null,
        orionSynced: synced.orionSynced,
        orionError:
          synced.orionError ||
          (resolveErrors.length > 0 ? resolveErrors.slice(0, 3).join(' · ') : null),
        missingOrionUrl,
      };
    });

    return NextResponse.json({ success: true, ...data }, { status: 200 });
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

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email || !session.user.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const requestId = Number(body.requestId);
    const fileId = String(body.fileId || '').trim();
    const action = String(body.action || 'ensure').trim().toLowerCase();
    const email = normalizeEmail(body.email);
    const isAdmin = session.user.role === 'admin' || session.user.role === 'superadmin';
    // Nunca usar Origin localhost en correos: preferir NEXTAUTH_URL / APP_URL.
    const origin = resolvePublicAppOrigin(req.headers.get('origin'));

    if (!Number.isInteger(requestId) || requestId <= 0 || !fileId) {
      return NextResponse.json({ error: 'requestId y fileId son obligatorios' }, { status: 400 });
    }

    const outcome = await withMssqlPool(async (pool) => {
      await assertUserCanEditOrionPreparation(pool, {
        requestId,
        userId: String(session.user.id),
        userEmail: String(session.user.email || ''),
        isAdmin,
        fileId,
      });

      const loaded = await loadOrionFormBag(pool, requestId);
      if (!loaded) {
        throw Object.assign(new Error('Campo orion_signature no encontrado'), { status: 404 });
      }

      let state = getOrionDocumentFromBag(loaded.bag, fileId);
      const ctx = await getRequestOrionContext(pool, requestId);

      if (action === 'ensure') {
        const synced = await syncStateFromOrion({ requestId, fileId, state });
        state = synced.state;
        const ensured = ensureSignerInvites({ state, requestId, fileId, origin });
        state = ensured.state;
        const bag = setOrionDocumentInBag(loaded.bag, fileId, state);
        await upsertOrionFormBag(pool, requestId, loaded.field.id_form_field, bag);
        return {
          state,
          created: ensured.created,
          orionSynced: synced.orionSynced,
          orionError: synced.orionError || null,
        };
      }

      if (!email) {
        throw Object.assign(new Error('email es obligatorio'), { status: 400 });
      }

      const synced = await syncStateFromOrion({ requestId, fileId, state });
      state = synced.state;

      const bodyOrder = Number(body.order ?? body.signOrder);
      const matches = (state.signers ?? []).filter((s) => normalizeEmail(s.email) === email);
      // Mismo email en varios pasos: preferir order del body; si no, el que pide correo / pendiente.
      const signer =
        (Number.isFinite(bodyOrder) && bodyOrder > 0
          ? matches.find((s) => Number(s.order) === bodyOrder)
          : undefined) ??
        matches.find((s) => s.notifyByEmail === true) ??
        matches.find((s) => !/firmado|signed|complet/i.test(String(s.status || ''))) ??
        matches[0];
      if (!signer) {
        throw Object.assign(new Error('Firmante no encontrado en este documento'), { status: 404 });
      }

      // Pedir /sign/{token} por POST (Orion ya no lo expone en GET).
      const resolved = await resolveLiveOrionSignUrl({
        orionDocumentId: state.orionDocumentId,
        email,
        signOrder: signer.order,
        bagSignUrl: signer.signUrl,
        sendEmail: false,
      });
      const orionSignUrl = resolved.signUrl;
      if (orionSignUrl) {
        signer.signUrl = orionSignUrl;
      }

      const created = createOrionSignerInvite({
        email,
        name: signer.name,
        signUrl: orionSignUrl,
        cardCode: signer.cardCode,
        requestId,
        fileId,
        origin,
      });
      state = upsertSignerInvite(state, created.invite);
      const plainToken = created.plainToken;

      const picked = pickShareUrl({ orionSignUrl });

      if (!picked.shareUrl) {
        throw Object.assign(
          new Error(
            resolved.error ||
              'Orion aún no tiene URL /sign/… para este firmante. Asigne firmantes, envíe a firma en GSS Firma y pulse renovar.'
          ),
          { status: 422 }
        );
      }

      if (action === 'send') {
        const mailUrl = picked.shareUrl;
        if (/localhost|127\.0\.0\.1/i.test(mailUrl) || /\/firma\/externa\//i.test(mailUrl)) {
          throw Object.assign(
            new Error(
              'El enlace de firma no es el público de Orion. Configure ORION_PUBLIC_URL en Orion y sincronice de nuevo.'
            ),
            { status: 422 }
          );
        }
        await sendExternalSignerInviteEmail({
          to: email,
          signerName: signer.name,
          documentTitle: state.fileName,
          requestSubject: ctx?.subject_request ?? null,
          inviteUrl: mailUrl,
          expiresAt: findInviteByEmail(state, email)?.expiresAt ?? null,
        });
        state = markInviteSent(state, email);
      }

      const bag = setOrionDocumentInBag(loaded.bag, fileId, state);
      await upsertOrionFormBag(pool, requestId, loaded.field.id_form_field, bag);

      return {
        state,
        email,
        inviteUrl: picked.shareUrl,
        signUrl: orionSignUrl,
        shareUrl: picked.shareUrl,
        shareSource: picked.source,
        orionSynced: synced.orionSynced,
        orionError: synced.orionError || resolved.error || null,
        plainToken:
          action === 'regenerate' || action === 'url' || action === 'send' ? plainToken : undefined,
        sent: action === 'send',
      };
    });

    return NextResponse.json({ success: true, ...outcome }, { status: 200 });
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
