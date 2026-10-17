import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../../lib/prisma';
import { authenticateAgent } from '../../../../../../../lib/chat/agent-auth';
import { jsonNoStore, NO_STORE, serverError, unauthorized } from '../../../../../../../lib/chat/http';
import { buildContentDisposition, safeDownloadContentType } from '../../../../../../../lib/chat/attachments';
import { downloadChatAttachment } from '../../../../../../../lib/chat/attachmentStorage';
import { projectsEnabledFor } from '../../../../../../../lib/chat/projects-rules';

export const dynamic = 'force-dynamic';

/**
 * Descarga de un ARCHIVO DE PROYECTO para el PUENTE DE HILOS (llave con
 * scope "projects"). El archivo debe ser de un proyecto ACTIVO de ESTE agente.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  try {
    const agent = await authenticateAgent(request);
    if (!agent) return unauthorized();

    const noEncontrado = () => jsonNoStore({ error: 'Archivo no encontrado.' }, { status: 404 });
    if (agent.scope !== 'projects' || !projectsEnabledFor(agent.code)) return noEncontrado();

    const { fileId } = await params;
    const idFile = Number.parseInt(fileId, 10);
    if (!Number.isInteger(idFile) || idFile <= 0) return noEncontrado();

    const archivo = await prisma.chatProjectFile.findFirst({
      where: {
        id_project_file: idFile,
        // ANCLA DE SEGURIDAD: proyecto activo del agente de la llave.
        project: { id_agent: agent.idAgent, archived: false },
      },
      select: { file_name: true, content_type: true, onedrive_item_id: true },
    });
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
    return serverError('GET /api/chat/agent/projects/files/[fileId]', error);
  }
}
