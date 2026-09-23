import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { OrionSignatureState, OrionSignerInvite } from './types';

const DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 días

function normalizeEmail(email?: string | null): string {
  return String(email || '')
    .trim()
    .toLowerCase();
}

/**
 * Secreto HMAC de los tokens públicos `/firma/externa/[token]`.
 * Preferir ORION_INVITE_SECRET; si no, NEXTAUTH_SECRET (mismo criterio que el portal).
 * Sin fallback literario: un secreto committeado permitiría forjar invitaciones (CWE-798).
 */
function inviteSecret(): string {
  const s = String(
    process.env.ORION_INVITE_SECRET || process.env.NEXTAUTH_SECRET || ''
  ).trim();
  if (!s) {
    throw new Error(
      'Falta ORION_INVITE_SECRET o NEXTAUTH_SECRET: no se pueden firmar invitaciones Orion.'
    );
  }
  return s;
}

export type InviteTokenPayload = {
  r: number; // requestId
  f: string; // fileId
  e: string; // email
  exp: number; // unix ms
  n: string; // nonce
};

export function createSignerInviteToken(): string {
  return randomBytes(24).toString('base64url');
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(String(token || '').trim()).digest('hex');
}

export function buildExternalSignPath(token: string): string {
  return `/firma/externa/${encodeURIComponent(token)}`;
}

export function buildExternalSignAbsoluteUrl(token: string, origin?: string | null): string {
  const path = buildExternalSignPath(token);
  const candidates = [
    String(origin || '').trim().replace(/\/$/, ''),
    String(process.env.NEXTAUTH_URL || '').trim().replace(/\/$/, ''),
    String(process.env.APP_URL || '').trim().replace(/\/$/, ''),
    String(process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/$/, ''),
  ].filter(Boolean);

  const isLoopback = (base: string) => {
    try {
      const h = new URL(base).hostname.toLowerCase();
      return h === 'localhost' || h === '127.0.0.1' || h === '::1';
    } catch {
      return /localhost|127\.0\.0\.1/i.test(base);
    }
  };

  const publicBase = candidates.find((b) => /^https?:\/\//i.test(b) && !isLoopback(b));
  const base = publicBase || candidates.find((b) => /^https?:\/\//i.test(b)) || '';
  return base ? `${base}${path}` : path;
}

function signPayload(payloadB64: string): string {
  return createHmac('sha256', inviteSecret()).update(payloadB64).digest('base64url');
}

/** Token firmado: base64url(JSON).hmac — permite resolver request/file sin índice global. */
export function mintSignedInviteToken(params: {
  requestId: number;
  fileId: string;
  email: string;
  ttlMs?: number;
}): { plainToken: string; expiresAt: string; payload: InviteTokenPayload } {
  const ttl = params.ttlMs ?? DEFAULT_TTL_MS;
  const exp = Date.now() + ttl;
  const payload: InviteTokenPayload = {
    r: params.requestId,
    f: String(params.fileId || '').trim(),
    e: normalizeEmail(params.email),
    exp,
    n: randomBytes(8).toString('base64url'),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const plainToken = `${payloadB64}.${signPayload(payloadB64)}`;
  return {
    plainToken,
    expiresAt: new Date(exp).toISOString(),
    payload,
  };
}

export function verifySignedInviteToken(plainToken: string): InviteTokenPayload | null {
  const raw = String(plainToken || '').trim();
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const payloadB64 = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!payloadB64 || !sig) return null;

  const expected = signPayload(payloadB64);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  try {
    const json = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const payload = JSON.parse(json) as InviteTokenPayload;
    if (!payload?.r || !payload?.f || !payload?.e || !payload?.exp) return null;
    if (Date.now() > Number(payload.exp)) return null;
    return {
      r: Number(payload.r),
      f: String(payload.f),
      e: normalizeEmail(payload.e),
      exp: Number(payload.exp),
      n: String(payload.n || ''),
    };
  } catch {
    return null;
  }
}

export function createOrionSignerInvite(params: {
  email: string;
  name?: string | null;
  signUrl?: string | null;
  cardCode?: string | null;
  requestId: number;
  fileId: string;
  ttlMs?: number;
  origin?: string | null;
}): { invite: OrionSignerInvite; plainToken: string; absoluteUrl: string } {
  const minted = mintSignedInviteToken({
    requestId: params.requestId,
    fileId: params.fileId,
    email: params.email,
    ttlMs: params.ttlMs,
  });
  const invite: OrionSignerInvite = {
    email: normalizeEmail(params.email),
    name: params.name?.trim() || null,
    tokenHash: hashInviteToken(minted.plainToken),
    createdAt: new Date().toISOString(),
    expiresAt: minted.expiresAt,
    signUrl: params.signUrl?.trim() || null,
    cardCode: params.cardCode?.trim() || null,
  };
  return {
    invite,
    plainToken: minted.plainToken,
    absoluteUrl: buildExternalSignAbsoluteUrl(minted.plainToken, params.origin),
  };
}

export function upsertSignerInvite(
  state: OrionSignatureState,
  invite: OrionSignerInvite
): OrionSignatureState {
  const email = normalizeEmail(invite.email);
  const rest = (state.signerInvites ?? []).filter((i) => normalizeEmail(i.email) !== email);
  return {
    ...state,
    signerInvites: [...rest, { ...invite, email }],
  };
}

export function findInviteByPlainToken(
  state: OrionSignatureState | null | undefined,
  plainToken: string
): OrionSignerInvite | null {
  const hash = hashInviteToken(plainToken);
  const now = Date.now();
  for (const invite of state?.signerInvites ?? []) {
    if (invite.tokenHash !== hash) continue;
    if (invite.expiresAt && Date.parse(invite.expiresAt) < now) return null;
    return invite;
  }
  return null;
}

export function findInviteByEmail(
  state: OrionSignatureState | null | undefined,
  email: string
): OrionSignerInvite | null {
  const me = normalizeEmail(email);
  return (state?.signerInvites ?? []).find((i) => normalizeEmail(i.email) === me) ?? null;
}

export function markInviteSent(
  state: OrionSignatureState,
  email: string
): OrionSignatureState {
  const me = normalizeEmail(email);
  return {
    ...state,
    signerInvites: (state.signerInvites ?? []).map((i) =>
      normalizeEmail(i.email) === me ? { ...i, sentAt: new Date().toISOString() } : i
    ),
  };
}

export function markInviteUsed(
  state: OrionSignatureState,
  email: string
): OrionSignatureState {
  const me = normalizeEmail(email);
  return {
    ...state,
    signerInvites: (state.signerInvites ?? []).map((i) =>
      normalizeEmail(i.email) === me ? { ...i, usedAt: new Date().toISOString() } : i
    ),
  };
}

/**
 * Asegura invites SynerLink para TODOS los firmantes con email
 * (internos y externos). Regenera token si no hay o expiró.
 * Devuelve plainTokens solo para los recién creados (mostrar/enviar una vez).
 */
export function ensureSignerInvites(params: {
  state: OrionSignatureState;
  requestId: number;
  fileId: string;
  origin?: string | null;
}): {
  state: OrionSignatureState;
  created: Array<{ email: string; plainToken: string; absoluteUrl: string }>;
} {
  let state = params.state;
  const created: Array<{ email: string; plainToken: string; absoluteUrl: string }> = [];
  const now = Date.now();

  for (const signer of state.signers ?? []) {
    const email = normalizeEmail(signer.email);
    if (!email) continue;

    const existing = findInviteByEmail(state, email);
    const expired = existing?.expiresAt ? Date.parse(existing.expiresAt) < now : false;
    if (existing && !expired) {
      if (signer.signUrl && signer.signUrl !== existing.signUrl) {
        state = upsertSignerInvite(state, {
          ...existing,
          signUrl: signer.signUrl,
          name: signer.name || existing.name,
        });
      }
      continue;
    }

    const { invite, plainToken, absoluteUrl } = createOrionSignerInvite({
      email,
      name: signer.name,
      signUrl: signer.signUrl,
      cardCode: signer.cardCode,
      requestId: params.requestId,
      fileId: params.fileId,
      origin: params.origin,
    });
    state = upsertSignerInvite(state, invite);
    created.push({ email, plainToken, absoluteUrl });
  }

  return { state, created };
}

/** @deprecated Alias: ahora incluye internos y externos. */
export function ensureExternalSignerInvites(params: {
  state: OrionSignatureState;
  requestId: number;
  fileId: string;
  origin?: string | null;
}) {
  return ensureSignerInvites(params);
}
