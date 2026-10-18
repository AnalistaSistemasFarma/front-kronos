import { NextRequest } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { badRequest, forbidden, jsonNoStore, readJsonBody, serverError } from '../../../../../lib/chat/http';
import { writeAccessForAgent } from '../../../../../lib/chat/projects';
import { guardProject } from '../../../../../lib/chat/projects-guard';
import { MAX_PROJECT_CONVERSATIONS } from '../../../../../lib/chat/projects-rules';
import { MAX_TITLE_CHARS } from '../../../../../lib/chat/constants';

export const dynamic = 'force-dynamic';

/**
 * NUEVA CONVERSACIÓN dentro de un proyecto, con UNO de sus agentes.
 *
 *   POST { agentCode, title? }  ->  { idConversation }
 *
 * Solo dueño o editor, y solo con un agente designado que la persona tenga
 * asignado en la empresa del proyecto (lib/chat/projects.ts, (d)–(f)). Cada
 * conversación es un hilo con SU sesión del modelo, que lleva el puente de
 * ESE agente con su plan y su token. Los mensajes van por las rutas de siempre
 * (/api/chat/conversations/[id]/…), cuya puerta reconoce kind = 'project'.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;

    const payload = (await readJsonBody(request)) ?? {};
    const code = typeof payload.agentCode === 'string' ? payload.agentCode.trim().toLowerCase() : '';
    if (!code) return badRequest('Escoja el asistente de la conversación.');

    let title = 'Nueva conversación';
    if (payload.title !== undefined && payload.title !== null) {
      if (typeof payload.title !== 'string') return badRequest('El título debe ser texto.');
      title = payload.title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_CHARS) || title;
    }

    const agente = await prisma.agent.findFirst({ where: { code }, select: { id_agent: true, display_name: true } });
    if (!agente) return badRequest('Ese asistente no está en el proyecto.');
    const permiso = await writeAccessForAgent(guard.user, guard.project, agente.id_agent);
    if (!permiso.ok) return forbidden(permiso.motivo);

    const activas = await prisma.chatConversation.count({
      where: { id_project: guard.project.idProject, archived: false },
    });
    if (activas >= MAX_PROJECT_CONVERSATIONS) {
      return jsonNoStore({ error: `El proyecto ya tiene ${MAX_PROJECT_CONVERSATIONS} conversaciones activas.` }, { status: 409 });
    }

    const now = new Date();
    const conversacion = await prisma.$transaction(async (tx) => {
      const c = await tx.chatConversation.create({
        data: {
          kind: 'project',
          id_project: guard.project.idProject,
          title,
          id_company: guard.project.idCompany,
          id_user: guard.user.id,
          created_by: guard.user.id,
          id_agent: agente.id_agent,
          last_message_at: now,
        },
        select: { id: true },
      });
      await tx.chatMessage.create({
        data: {
          id_conversation: c.id,
          role: 'system',
          body:
            `Conversación con **${agente.display_name}** en el proyecto **${guard.project.name}**. ` +
            'Tiene su propia memoria y trabaja con las instrucciones, los archivos y lo vinculado al proyecto. Todos los miembros la pueden leer.',
          created_at: now,
          delivered_at: now,
        },
      });
      await tx.chatProject.update({ where: { id_project: guard.project.idProject }, data: { updated_at: now } });
      return c;
    });

    return jsonNoStore({ idConversation: conversacion.id }, { status: 201 });
  } catch (error) {
    return serverError('POST /api/proyectos/[id]/conversaciones', error);
  }
}
