/**
 * ACCESO CON BIOMÉTRICO (passkeys / WebAuthn) — piezas PURAS (sin BD ni `server-only`).
 *
 * Pedido de Nicolás Rivera (2026-10-31): «queremos acceder con biométricos: en iOS con
 * Face ID, en Android con huella y Face ID si tiene».
 *
 * Cómo funciona: SynerLink NO lee la cara ni la huella. Le pide al dispositivo una firma
 * con una llave que solo se desbloquea con el biométrico de la persona (o su PIN). Al
 * servidor solo llega la llave PÚBLICA (al registrar) y la firma (al entrar).
 */

/** Identidad del sitio para WebAuthn: el dominio (rpID) y el origen exacto (con puerto). */
export interface RelyingParty {
  rpID: string;
  rpName: string;
  origin: string;
}

export const PASSKEY_RP_NAME = 'SynerLink';

/** Tiempo que tiene la persona para poner el dedo o la cara (y vida del reto). */
export const PASSKEY_TIMEOUT_MS = 120_000;

/** Máximo de dispositivos registrados por persona. */
export const MAX_PASSKEYS_PER_USER = 10;

/** Largo máximo del nombre del dispositivo (columna name NVARCHAR(100)). */
export const PASSKEY_NAME_MAX = 100;

/**
 * El sitio sale de PASSKEY_RP_ID / PASSKEY_ORIGIN o, si no están, de NEXTAUTH_URL
 * (producción: el dominio con su puerto; pruebas: la URL del túnel). Las passkeys
 * quedan atadas a ese dominio: si cambia (túnel nuevo en pruebas), hay que registrarlas
 * de nuevo. null si no hay forma de saberlo (no se ofrecen passkeys).
 */
export function resolveRelyingParty(env: Record<string, string | undefined>): RelyingParty | null {
  const base = (env.PASSKEY_ORIGIN || env.NEXTAUTH_URL || '').trim();
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  // WebAuthn exige HTTPS, salvo localhost en desarrollo.
  const isLocal = url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !isLocal) return null;
  const rpID = (env.PASSKEY_RP_ID || url.hostname).trim().toLowerCase();
  if (!rpID) return null;
  return { rpID, rpName: PASSKEY_RP_NAME, origin: url.origin };
}

/** Nombre legible del dispositivo a partir del navegador y el sistema («iPhone · Safari»). */
export function passkeyDeviceName(parsed: { browser: string | null; os: string | null }): string {
  const parts = [parsed.os, parsed.browser].filter((p): p is string => Boolean(p && p.trim()));
  const name = parts.length ? parts.join(' · ') : 'Dispositivo';
  return name.slice(0, PASSKEY_NAME_MAX);
}

/** Limpia el nombre que escribe la persona; si queda vacío usa el sugerido. */
export function cleanPasskeyName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return (clean || fallback).slice(0, PASSKEY_NAME_MAX);
}

/** transports del navegador → texto para la columna (y de vuelta). Solo valores conocidos. */
const KNOWN_TRANSPORTS = new Set(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']);

export function serializeTransports(list: unknown): string | null {
  if (!Array.isArray(list)) return null;
  const clean = list.filter((t): t is string => typeof t === 'string' && KNOWN_TRANSPORTS.has(t));
  return clean.length ? Array.from(new Set(clean)).join(',') : null;
}

export function parseTransports(value: string | null | undefined): string[] | undefined {
  if (!value) return undefined;
  const list = value.split(',').map((t) => t.trim()).filter((t) => KNOWN_TRANSPORTS.has(t));
  return list.length ? list : undefined;
}

/** ¿Parece un id de credencial base64url válido? (evita consultas con basura). */
export function isCredentialId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 && /^[A-Za-z0-9_-]+$/.test(value);
}
