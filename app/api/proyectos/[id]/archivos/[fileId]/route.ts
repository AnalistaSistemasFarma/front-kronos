import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { forbidden, jsonNoStore, NO_STORE, serverError } from '../../../../../../lib/chat/http';
import { buildContentDisposition, safeDownloadContentType } from '../../../../../../lib/chat/attachments';
import { downloadChatAttachment } from '../../../../../../lib/chat/attachmentStorage';
import { archivedProject, guardProject } from '../../../../../../lib/chat/projects-guard';
import { canRemoveContribution } from '../../../../../../lib/chat/projects-rules';
import { CarpetaInvalida, normalizarCarpeta } from '../../../../../../lib/proyectos/carpetas';
import { asegurarCarpetas } from '../../../../../../lib/proyectos/carpetas-db';

export const dynamic = 'force-dynamic';

/**
 * UN archivo del proyecto.
 *   GET    descarga (cualquier miembro). Pasa por el servidor: el enlace de
 *          OneDrive nunca sale al navegador.
 *   DELETE quita la referencia (el dueño, o el editor que lo cargó). El archivo de OneDrive queda,
 *          como en el resto del chat.
 *   PATCH  { folder } lo MUEVE a otra carpeta (2026-11-06; vacío = la raíz). Los mismos que lo quitan.
 */
async function archivoDelProyecto(idProject: number, rawFileId: string) {
  const idFile = Number.parseInt(rawFileId, 10);
  if (!Number.isInteger(idFile) || idFile <= 0) return null;
  // ANCLA: el archivo debe ser de ESTE proyecto (anti-IDOR).
  return prisma.chatProjectFile.findFirst({
    where: { id_project_file: idFile, id_project: idProject },
    select: { id_project_file: true, file_name: true, content_type: true, onedrive_item_id: true, uploaded_by: true },
  });
}

function noEncontrado() {
  return jsonNoStore({ error: 'Archivo no encontrado.' }, { status: 404 });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    const { id, fileId } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;

    const archivo = await archivoDelProyecto(guard.project.idProject, fileId);
    if (!archivo?.onedrive_item_id) return noEncontrado();

    const content = await downloadChatAttachment(archivo.onedrive_item_id);
    if (!content?.stream) {
      return NextResponse.json({ error: 'No se pudo recuperar el archivo.' }, { status: 502, headers: NO_STORE });
    }

    const headers = new Headers(NO_STORE);
    headers.set('Content-Type', safeDownloadContentType(archivo.content_type, archivo.file_name));
    headers.set('Content-Disposition', buildContentDisposition(archivo.file_name));
    headers.set('X-Content-Type-Options', 'nosniff');
    if (content.contentLength) headers.set('Content-Length', content.contentLength);
    return new NextResponse(content.stream, { status: 200, headers });
  } catch (error) {
    return serverError('GET /api/proyectos/[id]/archivos/[fileId]', error);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    const { id, fileId } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    if (guard.project.archived) return archivedProject();

    const archivo = await archivoDelProyecto(guard.project.idProject, fileId);
    if (!archivo) return noEncontrado();
    if (!canRemoveContribution(guard.project.role, guard.user.id, archivo.uploaded_by)) {
      return forbidden('Solo el dueño del proyecto o quien cargó el archivo lo puede quitar.');
    }

    await prisma.$transaction([
      prisma.chatProjectFile.delete({ where: { id_project_file: archivo.id_project_file } }),
      prisma.chatProject.update({
        where: { id_project: guard.project.idProject },
        data: { updated_at: new Date() },
      }),
    ]);
    return jsonNoStore({ removed: true });
  } catch (error) {
    return serverError('DELETE /api/proyectos/[id]/archivos/[fileId]', error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  try {
    const { id, fileId } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;
    if (guard.project.archived) return archivedProject();

    const archivo = await archivoDelProyecto(guard.project.idProject, fileId);
    if (!archivo) return noEncontrado();
    if (!canRemoveContribution(guard.project.role, guard.user.id, archivo.uploaded_by)) {
      return forbidden('Solo el dueño del proyecto o quien cargó el archivo lo puede mover.');
    }
    const body = (await request.json().catch(() => null)) as { folder?: unknown } | null;
    let folder: string | null;
    try {
      folder = normalizarCarpeta(body?.folder ?? null);
    } catch (error) {
      if (error instanceof CarpetaInvalida) return jsonNoStore({ error: error.message }, { status: 400 });
      throw error;
    }
    await asegurarCarpetas(prisma, guard.project.idProject, [folder], guard.user.id);
    await prisma.$transaction([
      prisma.chatProjectFile.update({ where: { id_project_file: archivo.id_project_file }, data: { folder_path: folder } }),
      prisma.chatProject.update({ where: { id_project: guard.project.idProject }, data: { updated_at: new Date() } }),
    ]);
    return jsonNoStore({ moved: true, folder });
  } catch (error) {
    return serverError('PATCH /api/proyectos/[id]/archivos/[fileId]', error);
  }
}
