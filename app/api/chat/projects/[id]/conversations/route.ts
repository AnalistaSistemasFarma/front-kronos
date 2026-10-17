import { NextRequest } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { badRequest, jsonNoStore, readJsonBody, serverError } from '../../../../../../lib/chat/http';
import { guardProject } from '../../../../../../lib/chat/projects-guard';
import { MAX_PROJECT_CONVERSATIONS } from '../../../../../../lib/chat/projects-rules';
import { MAX_TITLE_CHARS } from '../../../../../../lib/chat/constants';

export const dynamic = 'force-dynamic';

/**
 * NUEVA CONVERSACIÓN dentro de un proyecto. Cualquier miembro.
 *
 *   POST { title? }  ->  { idConversation }
 *
 * Cada conversación es un hilo con SU sesión del modelo (la lleva el puente
 * de hilos); todas comparten las instrucciones, los archivos y la carpeta del
 * proyecto. Los mensajes se leen y se escriben por las rutas de siempre
 * (/api/chat/conversations/[id]/…), cuya puerta reconoce kind = 'project'.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardProject(id);
    if ('response' in guard) return guard.response;

    const payload = (await readJsonBody(request)) ?? {};
    let title = 'Nueva conversación';
    if (payload.title !== undefined && payload.title !== null) {
      if (typeof payload.title !== 'string') return badRequest('El título debe ser texto.');
      title = payload.title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_CHARS) || title;
    }

    const activas = await prisma.chatConversation.count({
      where: { id_project: guard.project.idProject, archived: false },
    });
    if (activas >= MAX_PROJECT_CONVERSATIONS) {
      return jsonNoStore(
        { error: `El proyecto ya tiene ${MAX_PROJECT_CONVERSATIONS} conversaciones activas.` },
        { status: 409 }
      );
    }

    const now = new Date();
    const conversacion = await prisma.chatConversation.create({
      data: {
        kind: 'project',
        id_project: guard.project.idProject,
        title,
        id_company: guard.project.idCompany,
        id_user: guard.user.id,
        created_by: guard.user.id,
        id_agent: guard.project.idAgent,
        last_message_at: now,
      },
      select: { id: true },
    });
    await prisma.chatProject.update({
      where: { id_project: guard.project.idProject },
      data: { updated_at: now },
    });

    return jsonNoStore({ idConversation: conversacion.id }, { status: 201 });
  } catch (error) {
    return serverError('POST /api/chat/projects/[id]/conversations', error);
  }
}
