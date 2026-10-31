/**
 * Reto (challenge) de WebAuthn en una cookie CIFRADA y de un solo uso.
 *
 * - Se cifra con NEXTAUTH_SECRET (mismo mecanismo que la sesión de NextAuth), así que el
 *   navegador no puede leerla ni falsificarla. Vence en PASSKEY_TIMEOUT_MS.
 * - Lleva el propósito (register / login) y, al registrar, el usuario: un reto de login
 *   no sirve para registrar ni el de una persona para otra.
 * - De un solo uso: el reto consumido se recuerda en memoria hasta que vence (GSS-Front
 *   corre en una sola instancia).
 */
import 'server-only';
import { decode, encode } from 'next-auth/jwt';
import { PASSKEY_TIMEOUT_MS } from './config';

export const PASSKEY_CHALLENGE_COOKIE = 'synerlink.passkey-challenge';

export type ChallengePurpose = 'register' | 'login';

interface ChallengePayload {
  challenge: string;
  purpose: ChallengePurpose;
  userId?: string;
  exp?: number;
  [key: string]: unknown;
}

function secret(): string {
  const value = process.env.NEXTAUTH_SECRET;
  if (!value) throw new Error('NEXTAUTH_SECRET no está configurado');
  return value;
}

export async function sealChallenge(payload: Omit<ChallengePayload, 'exp'>): Promise<string> {
  return encode({ token: payload, secret: secret(), maxAge: Math.ceil(PASSKEY_TIMEOUT_MS / 1000) });
}

const consumed = new Map<string, number>();

function rememberConsumed(challenge: string) {
  const now = Date.now();
  if (consumed.size > 2_000) {
    for (const [key, until] of consumed) if (until < now) consumed.delete(key);
  }
  consumed.set(challenge, now + PASSKEY_TIMEOUT_MS + 5_000);
}

/**
 * Abre la cookie, valida propósito (y usuario) y la marca como usada.
 * null si no hay cookie, está alterada, venció, ya se usó o no corresponde.
 */
export async function consumeChallenge(
  sealed: string | null | undefined,
  purpose: ChallengePurpose,
  userId?: string
): Promise<string | null> {
  if (!sealed) return null;
  let payload: ChallengePayload | null = null;
  try {
    payload = (await decode({ token: sealed, secret: secret() })) as ChallengePayload | null;
  } catch {
    return null;
  }
  if (!payload || typeof payload.challenge !== 'string' || payload.purpose !== purpose) return null;
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null;
  if (purpose === 'register' && (!userId || payload.userId !== userId)) return null;
  const until = consumed.get(payload.challenge);
  if (until && until > Date.now()) return null;
  rememberConsumed(payload.challenge);
  return payload.challenge;
}

/** Lee una cookie de una cabecera `cookie` cruda. */
export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() === name) {
      try {
        return decodeURIComponent(part.slice(at + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Opciones de la cookie del reto (Secure en HTTPS; Lax para que viaje en el POST del login). */
export function challengeCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: Math.ceil(PASSKEY_TIMEOUT_MS / 1000),
  };
}
