import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import { saveDocumentAnnotations, type AnnotationRequestActor } from '@/lib/orion/annotationService';

function sessionActor(session: {
  user?: { id?: unknown; email?: string | null; name?: string | null } | null;
} | null): AnnotationRequestActor | null {
  const userId = String(session?.user?.id ?? '').trim();
  const email = String(session?.user?.email ?? '').trim().toLowerCase();
  if (!userId || !email) return null;
  return { userId, email, name: session?.user?.name ?? null };
}

function errorResponse(err: unknown) {
  const status = (err as { status?: number })?.status ?? 500;
  const message = err instanceof Error ? err.message : 'Error guardando los datos del documento';
  if (status >= 500) console.error('[orion/annotations]', err);
  return NextResponse.json({ error: message }, { status });
}

/**
 * POST /api/integrations/orion/annotations
 * { requestId, fileId, annotations } — lista completa de datos y sellos posteriores a la firma.
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const actor = sessionActor(session);
    if (!actor) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const requestId = Number(body.requestId);
    const fileId = String(body.fileId || '').trim();
    if (!Number.isInteger(requestId) || requestId <= 0 || !fileId) {
      return NextResponse.json({ error: 'requestId y fileId son obligatorios' }, { status: 400 });
    }
    const isAdmin = session?.user?.role === 'admin' || session?.user?.role === 'superadmin';

    const result = await withMssqlPool((pool) =>
      saveDocumentAnnotations(pool, {
        requestId,
        fileId,
        annotations: body.annotations,
        actor,
        isAdmin,
      })
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return errorResponse(err);
  }
}
