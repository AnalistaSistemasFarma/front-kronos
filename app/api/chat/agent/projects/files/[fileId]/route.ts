import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../../lib/prisma';
import { authenticateAgent } from '../../../../../../../lib/chat/agent-auth';
import { jsonNoStore, NO_STORE, serverError, unauthorized } from '../../../../../../../lib/chat/http';
import { buildContentDisposition, safeDownloadContentType } from '../../../../../../../lib/chat/attachments';
import { downloadChatAttachment } from '../../../../../../../lib/chat/attachmentStorage';
import { cargarConfigProyectos } from '../../../../../../../lib/proyectos/config-agentes';
import { whereProyectoDelAgente } from '../../../../../../../lib/chat/projects';

export const dynamic = 'force-dynamic';

/**
 * Descarga de un ARCHIVO DE PROYECTO para el PUENTE DE HILOS (llave con
 * scope "projects"). El archivo debe ser de un proyecto ACTIVO donde ESTE agente está designado.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  try {
    const agent = await authenticateAgent(request);
    if (!agent) return unauthorized();

    const noEncontrado = () => jsonNoStore({ error: 'Archivo no encontrado.' }, { status: 404 });
    if (agent.scope !== 'projects') return noEncontrado();
    const config = await cargarConfigProyectos();
    if (!config.habilitadoEnAlguna(agent.code)) return noEncontrado();

    const { fileId } = await params;
    const idFile = Number.parseInt(fileId, 10);
    if (!Number.isInteger(idFile) || idFile <= 0) return noEncontrado();

    const archivo = await prisma.chatProjectFile.findFirst({
      where: {
        id_project_file: idFile,
        // ANCLA DE SEGURIDAD: proyecto activo donde el agente de la llave
        // está designado, en una empresa donde está habilitado para Proyectos.
        project: { ...whereProyectoDelAgente(agent.idAgent), ...config.filtroEmpresas(agent.code) },
      },
      select: { file_name: true, content_type: true, onedrive_item_id: true },
    });
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
    return serverError('GET /api/chat/agent/projects/files/[fileId]', error);
  }
}
