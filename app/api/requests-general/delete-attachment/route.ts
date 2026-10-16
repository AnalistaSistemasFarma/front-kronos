import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { withMssqlPool } from '@/lib/mssqlPool';
import { userHasDeleteAttachmentsPermission } from '@/lib/attachments/permissions';
import { checkAdminPrivileges } from '@/lib/access-control';
import { deleteRequestDocumentCompletely } from '@/lib/orion/deleteDocument';
import {
  motivoFaltaPermisoEliminar,
  validarJustificacionEliminacion,
} from '@/lib/orion/deletePolicy';

/**
 * Elimina un adjunto de la solicitud (reglas en lib/orion/deletePolicy.ts):
 * doble llave — administrador Y permiso “Eliminar adjuntos” (403 si falta alguna);
 * un documento firmado no se elimina (409); si la firma sigue en curso se detiene
 * primero en Orion y, si Orion no lo confirma, no se borra nada (502).
 * La hoja de vida se conserva (evento ELIMINADO) y las tareas se cierran, no se borran.
 *
 * La justificación es obligatoria (400 si falta o tiene menos de 10 caracteres).
 *
 * DELETE/POST JSON: { requestId, fileId, fileName?, justification }
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

  const justificacion = validarJustificacionEliminacion(body.justification);
  if (!justificacion.ok) {
    return NextResponse.json({ error: justificacion.error }, { status: 400 });
  }

  const userId = session.user.id != null ? String(session.user.id) : '';
  if (!userId) {
    return NextResponse.json({ error: 'Usuario no identificado' }, { status: 401 });
  }

  const esAdmin = await checkAdminPrivileges(String(session.user.email));
  const result = await withMssqlPool(async (pool) => {
    const tienePermisoEliminarAdjuntos = await userHasDeleteAttachmentsPermission(pool, userId);
    const faltaPermiso = motivoFaltaPermisoEliminar(esAdmin, tienePermisoEliminarAdjuntos);
    if (faltaPermiso) {
      throw Object.assign(new Error(faltaPermiso), { status: 403 });
    }
    return deleteRequestDocumentCompletely(pool, {
      requestId,
      fileId,
      fileName,
      actorEmail: String(session.user.email),
      actorName: session.user.name ?? null,
      actorUserId: userId,
      esAdmin,
      tienePermisoEliminarAdjuntos,
      justification: justificacion.valor,
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
