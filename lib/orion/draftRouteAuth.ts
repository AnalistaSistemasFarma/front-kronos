import 'server-only';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../app/api/auth/[...nextauth]/route';
import type { DraftActor } from './draftState';

/** Usuario de la sesión para las rutas del tablero Word (null = sin sesión). */
export async function getDraftSessionActor(): Promise<{ actor: DraftActor; isAdmin: boolean } | null> {
  const session = await getServerSession(authOptions);
  const userId = String(session?.user?.id ?? '').trim();
  const email = String(session?.user?.email ?? '').trim().toLowerCase();
  if (!userId || !email) return null;
  const role = session?.user?.role;
  return {
    actor: { userId, email, name: session?.user?.name ?? null },
    isAdmin: role === 'admin' || role === 'superadmin',
  };
}

export function readDraftTarget(source: URLSearchParams | Record<string, unknown>): { requestId: number; fileId: string } | null {
  const get = (k: string) =>
    source instanceof URLSearchParams ? source.get(k) : (source as Record<string, unknown>)[k];
  const requestId = Number(get('requestId'));
  const fileId = String(get('fileId') || '').trim();
  if (!Number.isInteger(requestId) || requestId <= 0 || !fileId) return null;
  return { requestId, fileId };
}

export function draftErrorResponse(err: unknown, tag: string) {
  const status = (err as { status?: number })?.status ?? 500;
  const message = err instanceof Error ? err.message : 'Error en el tablero del documento';
  if (status >= 500) console.error(tag, err);
  return NextResponse.json({ error: message }, { status });
}
