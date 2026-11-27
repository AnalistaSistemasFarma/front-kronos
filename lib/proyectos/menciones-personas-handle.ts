/**
 * Handle of a project member for @mentions (2026-11-26): the local part of the email, lower case.
 * No imports on purpose: the project page (browser) uses it too. Rules in menciones-personas.ts.
 */
const RE_HANDLE = /^[a-z0-9][a-z0-9_.-]{0,59}$/;

/** `nicolas.rivera@gsslatam.com` → `nicolas.rivera`. null if it cannot be mentioned. */
export function handlePersona(email: string | null | undefined): string | null {
  const local = String(email ?? '').trim().toLowerCase().split('@')[0] ?? '';
  const h = local.replace(/[.\-_]+$/, '');
  return RE_HANDLE.test(h) ? h : null;
}
