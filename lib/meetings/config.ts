/**
 * Configuration of the "Mis reuniones" module (server only).
 *
 *   REUNIONES_USUARIOS   comma separated e-mails that see the module, or "*" for everyone.
 *                        Empty or missing = module off (pilot rollout, 2026-11-23).
 *
 * Microsoft Graph credentials are NOT new: the module reuses the application
 * registered for the Correo module (CORREO_INQUILINOS / CORREO_<K>_*), the one
 * that already has Calendars.Read, OnlineMeetings.Read.All,
 * OnlineMeetingTranscript.Read.All and OnlineMeetingArtifact.Read.All. As in
 * Correo, the mailbox ALWAYS comes from the SynerLink session, never from the
 * browser.
 */
import { inquilinoDeCorreo, readCorreoConfig, type Inquilino } from '../correo/config';

type Env = Record<string, string | undefined>;

export interface MeetingsCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

function allowList(env: Env): string[] {
  return String(env.REUNIONES_USUARIOS ?? '')
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Is the module enabled for this e-mail? */
export function meetingsEnabledFor(email: string | null | undefined, env: Env = process.env): boolean {
  const mail = String(email ?? '').trim().toLowerCase();
  if (!mail.includes('@')) return false;
  const list = allowList(env);
  return list.includes('*') || list.includes(mail);
}

/** Graph credentials of the tenant that serves this e-mail, or null. Never logged nor returned. */
export function meetingsCredentialsFor(email: string, env: Env = process.env): MeetingsCredentials | null {
  const tenant: Inquilino | null = inquilinoDeCorreo(readCorreoConfig(env), email);
  if (!tenant) return null;
  return { tenantId: tenant.tenantId, clientId: tenant.clientId, clientSecret: tenant.clientSecret };
}

/** Allowed values for the history range (days back). */
export const RANGE_OPTIONS = [7, 30, 90, 180] as const;
export const DEFAULT_RANGE = 30;

export function parseRange(raw: string | null | undefined): number {
  const n = Number(raw);
  return (RANGE_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_RANGE;
}
