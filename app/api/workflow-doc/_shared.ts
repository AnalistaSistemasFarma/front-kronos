import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../auth/[...nextauth]/route';
import { DocTemplateError } from '../../../lib/workflow-doc/engine';

/** Correo de la sesión, o null. */
export async function sessionEmail(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.email ? String(session.user.email) : null;
}

export function fail(e: unknown, tag: string) {
  if (e instanceof DocTemplateError) return NextResponse.json({ error: e.message }, { status: e.status });
  const status = typeof (e as { status?: unknown })?.status === 'number' ? (e as { status: number }).status : 500;
  console.error(`[workflow-doc/${tag}]`, e);
  if (status !== 500 && e instanceof Error) return NextResponse.json({ error: e.message }, { status });
  return NextResponse.json({ error: 'Error interno' }, { status: 500 });
}

export const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };
