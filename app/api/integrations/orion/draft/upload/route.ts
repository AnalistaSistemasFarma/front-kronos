import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../../auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import {
  getOrionDraftInfo,
  MAX_DRAFT_UPLOAD_BYTES,
  uploadOrionDraftVersion,
} from '@/lib/orion/draftService';

/**
 * POST /api/integrations/orion/draft/upload (multipart)
 * Campos: requestId, fileId, file (.docx), note (opcional), baseVersion (subversión que tenía abierta),
 * resolvedEmails (JSON: validadores cuyo pedido de corrección queda resuelto; sin el campo, todos).
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userId = String(session?.user?.id ?? '').trim();
    const email = String(session?.user?.email ?? '').trim().toLowerCase();
    if (!userId || !email) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    const actor = { userId, email, name: session?.user?.name ?? null };

    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: 'Formulario inválido' }, { status: 400 });
    const requestId = Number(form.get('requestId'));
    const fileId = String(form.get('fileId') || '').trim();
    const file = form.get('file');
    const note = typeof form.get('note') === 'string' ? String(form.get('note')) : null;
    const baseVersion = typeof form.get('baseVersion') === 'string' ? String(form.get('baseVersion')) : null;
    // Pedidos de corrección que esta subversión resuelve (JSON con correos); sin el campo: todos.
    let resolvedEmails: string[] | null = null;
    const resolvedRaw = form.get('resolvedEmails');
    if (typeof resolvedRaw === 'string') {
      try {
        const parsed = JSON.parse(resolvedRaw);
        resolvedEmails = Array.isArray(parsed) ? parsed.map((e) => String(e)) : null;
      } catch {
        return NextResponse.json({ error: 'resolvedEmails inválido' }, { status: 400 });
      }
    }
    if (!Number.isInteger(requestId) || requestId <= 0 || !fileId) {
      return NextResponse.json({ error: 'requestId y fileId son obligatorios' }, { status: 400 });
    }
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: 'Adjunte el documento Word (.docx)' }, { status: 400 });
    }
    const name = (file as File).name || '';
    if (name && !/\.docx$/i.test(name)) {
      return NextResponse.json({ error: 'Solo se aceptan documentos Word (.docx)' }, { status: 400 });
    }
    if (file.size > MAX_DRAFT_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'El archivo supera el tamaño máximo (25 MB).' }, { status: 413 });
    }

    const content = Buffer.from(await file.arrayBuffer());
    const isAdmin = session?.user?.role === 'admin' || session?.user?.role === 'superadmin';
    const info = await withMssqlPool(async (pool) => {
      await uploadOrionDraftVersion(pool, { requestId, fileId, actor, content, note, baseVersion, resolvedEmails });
      return getOrionDraftInfo(pool, { requestId, fileId, actor, isAdmin });
    });
    return NextResponse.json(info);
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    const message = err instanceof Error ? err.message : 'No se pudo subir la versión';
    if (status >= 500) console.error('[orion/draft/upload]', err);
    return NextResponse.json({ error: message }, { status });
  }
}
