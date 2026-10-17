import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../../lib/prisma';
import { forbidden, jsonNoStore, NO_STORE, serverError } from '../../../../../../../lib/chat/http';
import { buildContentDisposition, safeDownloadContentType } from '../../../../../../../lib/chat/attachments';
import { downloadChatAttachment } from '../../../../../../../lib/chat/attachmentStorage';
import { guardProject } from '../../../../../../../lib/chat/projects-guard';
import { canManageProject } from '../../../../../../../lib/chat/projects-rules';

export const dynamic = 'force-dynamic';

/**
 * UN archivo del proyecto.
 *   GET    descarga (cualquier miembro). Pasa por el servidor: el enlace de
 *          OneDrive nunca sale al navegador.
 *   DELETE quita la referencia (solo el DUEÑO). El archivo de OneDrive queda,
 *          como en el resto del chat.
 */
async function archivoDelProyecto(idProject: number, rawFileId: string) {
  const idFile = Number.parseInt(rawFileId, 10);
  if (!Number.isInteger(idFile) || idFile <= 0) return null;
  // ANCLA: el archivo debe ser de ESTE proyecto (anti-IDOR).
  return prisma.chatProjectFile.findFirst({
    where: { id_project_file: idFile, id_project: idProject },
    select: { id_project_file: true, file_name: true, content_type: true, onedrive_item_id: true },
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
    headers.set('Content-Type', safeDownloadContentType(archivo.content_type));
    headers.set('Content-Disposition', buildContentDisposition(archivo.file_name));
    headers.set('X-Content-Type-Options', 'nosniff');
    if (content.contentLength) headers.set('Content-Length', content.contentLength);
    return new NextResponse(content.stream, { status: 200, headers });
  } catch (error) {
    return serverError('GET /api/chat/projects/[id]/files/[fileId]', error);
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
    if (!canManageProject(guard.project.role)) {
      return forbidden('Solo el dueño del proyecto puede quitar archivos.');
    }

    const archivo = await archivoDelProyecto(guard.project.idProject, fileId);
    if (!archivo) return noEncontrado();

    await prisma.$transaction([
      prisma.chatProjectFile.delete({ where: { id_project_file: archivo.id_project_file } }),
      prisma.chatProject.update({
        where: { id_project: guard.project.idProject },
        data: { updated_at: new Date() },
      }),
    ]);
    return jsonNoStore({ removed: true });
  } catch (error) {
    return serverError('DELETE /api/chat/projects/[id]/files/[fileId]', error);
  }
}
