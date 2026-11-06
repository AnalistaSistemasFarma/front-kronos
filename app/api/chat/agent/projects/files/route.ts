import { NextRequest } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { authenticateAgent } from '../../../../../../lib/chat/agent-auth';
import { badRequest, jsonNoStore, readMessageRequest, rejectOversizedBody, serverError, unauthorized } from '../../../../../../lib/chat/http';
import { collectChatAttachments } from '../../../../../../lib/chat/attachments';
import { uploadProjectFiles } from '../../../../../../lib/chat/attachmentStorage';
import { assertAgentProjectConversation } from '../../../../../../lib/chat/projects';
import { MAX_PROJECT_FILES } from '../../../../../../lib/chat/projects-rules';
import { nombresDelLote } from '../../../../../../lib/proyectos/archivos-agente';

export const dynamic = 'force-dynamic';

/**
 * ARCHIVAR en los Archivos del proyecto lo que el AGENTE genera en una
 * conversación del proyecto (2026-10-23, requisito de Nicolás Rivera: «todos
 * los documentos que genere desde el chat de un proyecto deben archivarse en
 * los Archivos del proyecto»).
 *
 *   POST /api/chat/agent/projects/files
 *   Authorization: Bearer <llave del agente con scope "projects">
 *   multipart/form-data: idConversation, files (hasta 5, 25 MB c/u)
 *
 * REJAS:
 *  - Solo la llave del PUENTE (scope "projects"); el agente sale de la llave,
 *    nunca del cuerpo.
 *  - La conversación es de un proyecto ACTIVO donde ESTE agente está designado
 *    y la conversación es suya (assertAgentProjectConversation). Si no, 404.
 *  - Mismas extensiones bloqueadas, tamaño y cantidad que el chat
 *    (collectChatAttachments) y el mismo tope de archivos por proyecto.
 *  - Un nombre repetido NO pisa al existente: se archiva como «nombre (2).ext».
 *
 * Queda con uploaded_by = NULL (no lo subió una persona), uploaded_by_agent =
 * el agente y id_conversation = la conversación; la pestaña Archivos lo muestra
 * como «subido por <agente> en la conversación N».
 */
export async function POST(request: NextRequest) {
  try {
    const agent = await authenticateAgent(request);
    if (!agent) return unauthorized();
    const noEncontrada = () => jsonNoStore({ error: 'Conversación no encontrada.' }, { status: 404 });
    if (agent.scope !== 'projects') return noEncontrada();

    const oversized = rejectOversizedBody(request);
    if (oversized) return oversized;

    const payload = await readMessageRequest(request);
    if (!payload?.form) return badRequest('Envíe los archivos como multipart/form-data (campos idConversation y files).');
    const rawId = payload.fields.idConversation;
    const idConversation = typeof rawId === 'string' && /^\d{1,10}$/.test(rawId.trim()) ? Number(rawId.trim()) : rawId;
    const conv = await assertAgentProjectConversation(agent.idAgent, idConversation);
    if (!conv) return noEncontrada();

    const collected = collectChatAttachments(payload.form);
    if (!collected.ok) return badRequest(collected.error);
    if (collected.files.length === 0) return badRequest('No llegó ningún archivo.');

    const existentes = await prisma.chatProjectFile.findMany({
      where: { id_project: conv.idProject },
      select: { file_name: true },
    });
    if (existentes.length + collected.files.length > MAX_PROJECT_FILES) {
      return jsonNoStore(
        { error: `El proyecto llegó al máximo de ${MAX_PROJECT_FILES} archivos; quite alguno en la pestaña Archivos.` },
        { status: 409 }
      );
    }

    const finales = nombresDelLote(
      collected.files.map((f) => f.fileName),
      existentes.map((e) => e.file_name)
    );
    const aSubir = collected.files.map((f, i) => ({ ...f, fileName: finales[i] }));

    let subidos;
    try {
      subidos = await uploadProjectFiles(conv.idProject, aSubir);
    } catch (error) {
      console.error('[proyectos] no se pudieron archivar los archivos del agente en OneDrive:', error);
      return jsonNoStore({ error: 'No se pudieron guardar los archivos.' }, { status: 502 });
    }

    const filas = await prisma.$transaction([
      ...subidos.map((f) =>
        prisma.chatProjectFile.create({
          data: {
            id_project: conv.idProject,
            file_name: f.file_name,
            content_type: f.content_type,
            size_bytes: f.size_bytes,
            onedrive_item_id: f.onedrive_item_id,
            uploaded_by: null,
            uploaded_by_agent: agent.idAgent,
            id_conversation: conv.id,
          },
          select: { id_project_file: true, file_name: true },
        })
      ),
      // Cambia la "versión" del proyecto: el puente vuelve a sincronizar su espejo.
      prisma.chatProject.update({ where: { id_project: conv.idProject }, data: { updated_at: new Date() } }),
    ]);

    const archivados = filas.slice(0, subidos.length).map((r, i) => {
      const fila = r as { id_project_file: number; file_name: string };
      return {
        id: fila.id_project_file,
        fileName: fila.file_name,
        originalName: collected.files[i].fileName,
        renamed: fila.file_name !== collected.files[i].fileName,
      };
    });
    return jsonNoStore({ archived: archivados, idProject: conv.idProject }, { status: 201 });
  } catch (error) {
    return serverError('POST /api/chat/agent/projects/files', error);
  }
}
