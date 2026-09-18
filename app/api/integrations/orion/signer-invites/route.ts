import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import {
  getOrionDocumentFromBag,
  setOrionDocumentInBag,
} from '@/lib/orion/formValue';
import {
  getRequestOrionContext,
  loadOrionFormBag,
  upsertOrionFormBag,
  userCanManageOrionRequest,
} from '@/lib/orion/service';
import {
  createOrionSignerInvite,
  ensureExternalSignerInvites,
  findInviteByEmail,
  markInviteSent,
  upsertSignerInvite,
} from '@/lib/orion/signerInvites';
import { sendExternalSignerInviteEmail } from '@/lib/orion/inviteEmail';

function normalizeEmail(email?: string | null) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

/**
 * GET ?requestId=&fileId= — lista firmantes + invites (sin tokens en claro).
 * POST body { requestId, fileId, action?: 'ensure'|'send'|'url'|'regenerate', email? }
 *
 * Preferencia de URL para externos:
 * 1) signUrl de Orion (/sign/{token}) si existe
 * 2) URL pública SynerLink /firma/externa/... (redirige a signUrl o firma nativa)
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
    const origin =
      req.headers.get('origin') ||
      process.env.NEXTAUTH_URL ||
      process.env.APP_URL ||
      null;

    const data = await withMssqlPool(async (pool) => {
      const canManage = await userCanManageOrionRequest(
        pool,
        requestId,
        String(session.user.id),
        isAdmin
      );
      if (!canManage) {
        throw Object.assign(new Error('Sin permiso para gestionar firmantes'), { status: 403 });
      }

      const loaded = await loadOrionFormBag(pool, requestId);
      if (!loaded) throw Object.assign(new Error('Campo orion_signature no encontrado'), { status: 404 });

      let state = getOrionDocumentFromBag(loaded.bag, fileId);
      const ensured = ensureExternalSignerInvites({ state, requestId, fileId, origin });
      if (ensured.created.length > 0 || ensured.state.signerInvites !== state.signerInvites) {
        state = ensured.state;
        const bag = setOrionDocumentInBag(loaded.bag, fileId, state);
        await upsertOrionFormBag(pool, requestId, loaded.field.id_form_field, bag);
      }

      const signers = (state.signers ?? []).map((s) => {
        const email = normalizeEmail(s.email);
        const invite = findInviteByEmail(state, email);
        const isExternal = String(s.type || '').toLowerCase() === 'external';
        return {
          email,
          name: s.name || null,
          order: s.order ?? null,
          type: s.type || 'internal',
          status: s.status || null,
          signUrl: s.signUrl || invite?.signUrl || null,
          inviteUrl: null as string | null,
          inviteSentAt: invite?.sentAt || null,
          inviteExpiresAt: invite?.expiresAt || null,
          cardCode: s.cardCode || invite?.cardCode || null,
          isExternal,
        };
      });

      return { signers, fileName: state.fileName || null, status: state.status || null };
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
    const origin =
      req.headers.get('origin') ||
      process.env.NEXTAUTH_URL ||
      process.env.APP_URL ||
      null;

    if (!Number.isInteger(requestId) || requestId <= 0 || !fileId) {
      return NextResponse.json({ error: 'requestId y fileId son obligatorios' }, { status: 400 });
    }

    const outcome = await withMssqlPool(async (pool) => {
      const canManage = await userCanManageOrionRequest(
        pool,
        requestId,
        String(session.user.id),
        isAdmin
      );
      if (!canManage) {
        throw Object.assign(new Error('Sin permiso para gestionar firmantes'), { status: 403 });
      }

      const loaded = await loadOrionFormBag(pool, requestId);
      if (!loaded) throw Object.assign(new Error('Campo orion_signature no encontrado'), { status: 404 });

      let state = getOrionDocumentFromBag(loaded.bag, fileId);
      const ctx = await getRequestOrionContext(pool, requestId);

      if (action === 'ensure') {
        const ensured = ensureExternalSignerInvites({ state, requestId, fileId, origin });
        state = ensured.state;
        const bag = setOrionDocumentInBag(loaded.bag, fileId, state);
        await upsertOrionFormBag(pool, requestId, loaded.field.id_form_field, bag);
        return { state, created: ensured.created };
      }

      if (!email) {
        throw Object.assign(new Error('email es obligatorio'), { status: 400 });
      }

      const signer = (state.signers ?? []).find((s) => normalizeEmail(s.email) === email);
      if (!signer || String(signer.type || '').toLowerCase() !== 'external') {
        throw Object.assign(new Error('El firmante no es externo o no existe'), { status: 404 });
      }

      // Siempre regenera token al pedir URL o enviar (seguridad + poder mostrar URL).
      const { invite, plainToken, absoluteUrl } = createOrionSignerInvite({
        email,
        name: signer.name,
        signUrl: signer.signUrl,
        cardCode: signer.cardCode,
        requestId,
        fileId,
        origin,
      });
      state = upsertSignerInvite(state, invite);

      // Preferir signUrl Orion en el correo; SynerLink URL como respaldo.
      const orionSignUrl = String(signer.signUrl || '').trim();
      const inviteUrlForMail = orionSignUrl || absoluteUrl;

      if (action === 'send') {
        await sendExternalSignerInviteEmail({
          to: email,
          signerName: signer.name,
          documentTitle: state.fileName,
          requestSubject: ctx?.subject_request ?? null,
          inviteUrl: inviteUrlForMail,
          expiresAt: invite.expiresAt,
        });
        state = markInviteSent(state, email);
      }

      const bag = setOrionDocumentInBag(loaded.bag, fileId, state);
      await upsertOrionFormBag(pool, requestId, loaded.field.id_form_field, bag);

      return {
        state,
        email,
        inviteUrl: absoluteUrl,
        signUrl: orionSignUrl || null,
        /** URL preferida para copiar/enviar: Orion signUrl si hay. */
        shareUrl: inviteUrlForMail,
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
