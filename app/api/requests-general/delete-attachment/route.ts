import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import { userHasDeleteAttachmentsPermission } from '@/lib/attachments/permissions';
import { deleteRequestDocumentCompletely } from '@/lib/orion/deleteDocument';

/**
 * Elimina un adjunto de la solicitud y todo lo asociado (firma, versiones, tareas,
 * hoja de vida), sin importar el estado del documento ni de la solicitud.
 * Requiere el permiso “Eliminar adjuntos” (sin bypass de administrador).
 *
 * DELETE/POST JSON: { requestId, fileId, fileName? }
 */
async function handleDelete(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const requestId = Number(body.requestId);
  const fileId = String(body.fileId || '').trim();
  const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : null;

  if (!Number.isInteger(requestId) || requestId <= 0 || !fileId) {
    return NextResponse.json(
      { error: 'requestId y fileId son obligatorios' },
      { status: 400 }
    );
  }

  const userId = session.user.id != null ? String(session.user.id) : '';
  if (!userId) {
    return NextResponse.json({ error: 'Usuario no identificado' }, { status: 401 });
  }

  const result = await withMssqlPool(async (pool) => {
    const allowed = await userHasDeleteAttachmentsPermission(pool, userId);
    if (!allowed) {
      throw Object.assign(
        new Error('No tiene permiso “Eliminar adjuntos”. Asígneselo en Administración → Usuarios.'),
        { status: 403 }
      );
    }
    return deleteRequestDocumentCompletely(pool, {
      requestId,
      fileId,
      fileName,
      actorEmail: String(session.user.email),
      actorName: session.user.name ?? null,
      actorUserId: userId,
    });
  });

  return NextResponse.json({ ok: true, requestId, ...result });
}

function errorResponse(err: unknown) {
  const status = Number((err as { status?: number })?.status) || 500;
  const message = err instanceof Error ? err.message : 'Error interno';
  if (status >= 500) console.error('[delete-attachment]', err);
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: Request) {
  try {
    return await handleDelete(req);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: Request) {
  try {
    return await handleDelete(req);
  } catch (err) {
    return errorResponse(err);
  }
}
