import { NextRequest } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { authenticateAgent } from '../../../../../../lib/chat/agent-auth';
import { badRequest, jsonNoStore, serverError, unauthorized } from '../../../../../../lib/chat/http';
import { assertAgentProjectConversation } from '../../../../../../lib/chat/projects';
import { profileLabel } from '../../../../../../lib/chat/projects-rules';

export const dynamic = 'force-dynamic';

/**
 * CONTEXTO DE UN PROYECTO para el PUENTE DE HILOS.
 *
 *   GET /api/chat/agent/projects/context?idConversation=12
 *   Authorization: Bearer <llave del agente con scope "projects">
 *
 * Devuelve lo que el puente necesita para preparar la carpeta y la sesión del
 * hilo: nombre, empresa, PERFIL de conectores, instrucciones, lista de
 * archivos y una `version` (updated_at del proyecto) para no volver a bajar
 * los archivos si nada cambió.
 *
 * Solo con la llave del puente: la del bot vivo responde 404 aquí, igual que
 * una conversación que no es de un proyecto de ESTE agente.
 */
export async function GET(request: NextRequest) {
  try {
    const agent = await authenticateAgent(request);
    if (!agent) return unauthorized();
    if (agent.scope !== 'projects') {
      return jsonNoStore({ error: 'Conversación no encontrada.' }, { status: 404 });
    }

    const idConversation = Number(request.nextUrl.searchParams.get('idConversation'));
    if (!Number.isInteger(idConversation) || idConversation <= 0) {
      return badRequest('Debe indicar idConversation.');
    }

    const conv = await assertAgentProjectConversation(agent.idAgent, idConversation);
    if (!conv) return jsonNoStore({ error: 'Conversación no encontrada.' }, { status: 404 });

    const p = await prisma.chatProject.findUnique({
      where: { id_project: conv.idProject },
      select: {
        id_project: true,
        name: true,
        profile: true,
        instructions: true,
        updated_at: true,
        company: { select: { id_company: true, company: true } },
        files: {
          select: { id_project_file: true, file_name: true, content_type: true, size_bytes: true },
          orderBy: { id_project_file: 'asc' },
        },
        conversations: { where: { id: idConversation }, select: { title: true } },
      },
    });
    if (!p) return jsonNoStore({ error: 'Conversación no encontrada.' }, { status: 404 });

    return jsonNoStore({
      project: {
        idProject: p.id_project,
        name: p.name,
        company: { idCompany: p.company.id_company, companyName: p.company.company },
        profile: { key: p.profile, label: profileLabel(p.profile) },
        instructions: p.instructions,
        version: p.updated_at.toISOString(),
        files: p.files.map((f) => ({
          id: f.id_project_file,
          fileName: f.file_name,
          contentType: f.content_type,
          sizeBytes: f.size_bytes,
          downloadUrl: `/api/chat/agent/projects/files/${f.id_project_file}`,
        })),
      },
      conversation: { id: idConversation, title: p.conversations[0]?.title ?? null },
    });
  } catch (error) {
    return serverError('GET /api/chat/agent/projects/context', error);
  }
}
