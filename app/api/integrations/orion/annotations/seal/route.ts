import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../../auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import {
  readAnnotationSeal,
  uploadAnnotationSeal,
  type AnnotationRequestActor,
} from '@/lib/orion/annotationService';
import { SEAL_MAX_BYTES } from '@/lib/orion/annotations';

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
  const message = err instanceof Error ? err.message : 'Error con el sello del documento';
  if (status >= 500) console.error('[orion/annotations/seal]', err);
  return NextResponse.json({ error: message }, { status });
}

/** GET /api/integrations/orion/annotations/seal?requestId=&fileId=&itemId= — imagen del sello. */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const actor = sessionActor(session);
    if (!actor) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const requestId = Number(searchParams.get('requestId'));
    const fileId = String(searchParams.get('fileId') || '').trim();
    const itemId = String(searchParams.get('itemId') || '').trim();
    if (!Number.isInteger(requestId) || requestId <= 0 || !fileId || !itemId) {
      return NextResponse.json({ error: 'requestId, fileId e itemId son obligatorios' }, { status: 400 });
    }
    const isAdmin = session?.user?.role === 'admin' || session?.user?.role === 'superadmin';
    const seal = await withMssqlPool((pool) =>
      readAnnotationSeal(pool, { requestId, fileId, itemId, actor, isAdmin })
    );
    const type = /png/i.test(seal.mime) ? 'image/png' : 'image/jpeg';
    return new NextResponse(Buffer.from(seal.bytes), {
      status: 200,
      headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=300' },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST multipart: requestId, fileId, file (PNG/JPG, máx. 2 MB) → { sealItemId, sealFileName }. */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const actor = sessionActor(session);
    if (!actor) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const declared = Number(req.headers.get('content-length') || 0);
    if (declared > SEAL_MAX_BYTES + 64 * 1024) {
      return NextResponse.json({ error: 'La imagen del sello debe pesar máximo 2 MB.' }, { status: 413 });
    }

    const form = await req.formData().catch(() => null);
    const requestId = Number(form?.get('requestId'));
    const fileId = String(form?.get('fileId') || '').trim();
    const file = form?.get('file');
    if (!Number.isInteger(requestId) || requestId <= 0 || !fileId || !(file instanceof Blob)) {
      return NextResponse.json({ error: 'requestId, fileId y la imagen son obligatorios' }, { status: 400 });
    }
    const isAdmin = session?.user?.role === 'admin' || session?.user?.role === 'superadmin';
    const bytes = Buffer.from(await file.arrayBuffer());

    const result = await withMssqlPool((pool) =>
      uploadAnnotationSeal(pool, {
        requestId,
        fileId,
        actor,
        isAdmin,
        fileName: file instanceof File ? file.name : 'sello',
        mime: file.type,
        bytes,
      })
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return errorResponse(err);
  }
}
