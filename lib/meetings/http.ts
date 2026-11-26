import 'server-only';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../app/api/auth/[...nextauth]/route';
import { meetingsEnabledFor } from './config';
import { MeetingsGraphError } from './graph';

const NO_STORE = { 'Cache-Control': 'no-store' };

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * Session e-mail when the module is enabled for the person; otherwise the
 * response to return (401 without session, 200 { enabled: false } without the
 * module, so the header icon simply does not show up).
 */
export async function sessionEmail(): Promise<string | NextResponse> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) return json({ error: 'Unauthorized' }, 401);
  if (!meetingsEnabledFor(email)) return json({ enabled: false });
  return email;
}

/** Error → JSON without internal details. */
export function errorResponse(err: unknown, context: string): NextResponse {
  if (err instanceof MeetingsGraphError) {
    console.error(`[meetings] ${context}:`, err.message);
    return json({ error: err.message }, err.status);
  }
  console.error(`[meetings] ${context}:`, err instanceof Error ? err.message : err);
  return json({ error: 'Error interno del módulo de reuniones.' }, 500);
}
