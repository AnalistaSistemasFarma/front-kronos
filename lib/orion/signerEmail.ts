import 'server-only';
import { fetchOrionSignerSignUrl, resolveOrionAbsoluteUrl } from './client';
import { getOrionSignerEmailSender } from './config';
import { getOrionDocumentFromBag, setOrionDocumentInBag } from './formValue';
import { sendExternalSignerInviteEmail } from './inviteEmail';
import { getRequestOrionContext, loadOrionFormBag, upsertOrionFormBag } from './service';
import { getCurrentPendingSigner } from './signerStatus';

type SqlPool = import('mssql').ConnectionPool;

export function orionSendsSignerEmails(): boolean {
  return getOrionSignerEmailSender() !== 'synerlink';
}

export function synerlinkSendsSignerEmails(): boolean {
  return getOrionSignerEmailSender() !== 'orion';
}

/**
 * Correo SAPSEND al firmante en turno cuando SynerLink es quien notifica.
 * Se marca synerlinkEmailedAt en el slot para no repetir si Orion reenvía el webhook.
 */
export async function emailCurrentSignerTurnViaSynerlink(
  pool: SqlPool,
  params: {
    requestId: number;
    fileId: string | null | undefined;
    invitedByName?: string | null;
    invitedByEmail?: string | null;
  }
): Promise<{ sent: boolean; reason?: string }> {
  if (!synerlinkSendsSignerEmails()) return { sent: false, reason: 'sender-orion' };
  const fileId = String(params.fileId || '').trim();
  if (!fileId) return { sent: false, reason: 'no-file' };

  const loaded = await loadOrionFormBag(pool, params.requestId);
  if (!loaded) return { sent: false, reason: 'no-bag' };
  const state = getOrionDocumentFromBag(loaded.bag, fileId);
  const status = String(state.status || '').toUpperCase();
  if (!state.orionDocumentId || !['PENDIENTE_FIRMA', 'EN_PROCESO'].includes(status)) {
    return { sent: false, reason: 'not-signing' };
  }

  const pending = getCurrentPendingSigner(state.signers);
  const email = String(pending?.email || '').trim().toLowerCase();
  if (!pending || !email) return { sent: false, reason: 'no-pending' };
  if ((pending.synerlinkNotify ?? pending.notifyByEmail) !== true) {
    return { sent: false, reason: 'notify-off' };
  }
  if (pending.synerlinkEmailedAt) return { sent: false, reason: 'already-sent' };

  let signUrl = resolveOrionAbsoluteUrl(pending.signUrl) || String(pending.signUrl || '').trim();
  if (!signUrl) {
    const live = await fetchOrionSignerSignUrl(state.orionDocumentId, email, pending.order, {
      sendEmail: false,
    });
    signUrl = live.signUrl || '';
  }
  if (!signUrl) return { sent: false, reason: 'no-sign-url' };

  const ctx = await getRequestOrionContext(pool, params.requestId);
  await sendExternalSignerInviteEmail({
    to: email,
    signerName: pending.name,
    documentTitle: state.fileName,
    requestSubject: ctx?.subject_request ?? null,
    inviteUrl: signUrl,
    expiresAt: pending.expiresAt ?? null,
    invitedByName: params.invitedByName ?? null,
    invitedByEmail: params.invitedByEmail ?? ctx?.requester_email ?? null,
  });

  const now = new Date().toISOString();
  const nextSigners = (state.signers ?? []).map((s) =>
    s === pending ? { ...s, signUrl, synerlinkEmailedAt: now } : s
  );
  const bag = setOrionDocumentInBag(loaded.bag, fileId, { ...state, signers: nextSigners });
  await upsertOrionFormBag(pool, params.requestId, loaded.field.id_form_field, bag);
  return { sent: true };
}

export function fireAndForgetSignerTurnEmail(
  pool: SqlPool,
  params: Parameters<typeof emailCurrentSignerTurnViaSynerlink>[1]
): void {
  if (!synerlinkSendsSignerEmails()) return;
  void emailCurrentSignerTurnViaSynerlink(pool, params).catch((err) => {
    console.warn('[orion/signer-email] SAPSEND turno:', err);
  });
}
