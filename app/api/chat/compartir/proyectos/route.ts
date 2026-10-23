import { prisma } from '../../../../../lib/prisma';
import { jsonNoStore, resolveSessionUser, serverError, unauthorized } from '../../../../../lib/chat/http';
import { projectModuleCompanies } from '../../../../../lib/chat/projects';
import type { DestinoCompartir } from '../../../../../lib/chat/compartir';

export const dynamic = 'force-dynamic';

/**
 * Conversaciones de PROYECTO a las que la persona puede compartir, para la
 * pantalla «Compartir en SynerLink».
 *
 *   GET /api/chat/compartir/proyectos  ->  { destinos: DestinoCompartir[] }
 *
 * Es solo la LISTA: proyectos activos de las empresas donde tiene el módulo,
 * donde es dueño o editor (el lector no escribe). Al enviar, la ruta de
 * mensajes vuelve a pasar por guardConversation + projectWritable, que es la
 * reja que manda (permiso vigente del agente, perfil habilitado).
 */
export async function GET() {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    const empresas = await projectModuleCompanies(user.id);
    if (empresas.length === 0) return jsonNoStore({ destinos: [] });

    const filas = await prisma.chatConversation.findMany({
      where: {
        kind: 'project',
        archived: false,
        project: {
          archived: false,
          id_company: { in: empresas.map((e) => e.idCompany) },
          members: { some: { id_user: user.id, role: { in: ['owner', 'editor', 'member'] } } },
        },
      },
      select: {
        id: true,
        title: true,
        last_message_at: true,
        agent: { select: { id_agent: true, code: true, display_name: true, avatar_url: true, avatar_updated_at: true } },
        project: { select: { id_project: true, name: true } },
      },
      orderBy: [{ last_message_at: 'desc' }, { id: 'desc' }],
      take: 100,
    });

    const destinos: DestinoCompartir[] = filas.map((f) => ({
      key: `conv:${f.id}`,
      tipo: 'proyecto',
      nombre: f.project?.name ?? 'Proyecto',
      detalle: [f.agent.display_name, f.title?.trim()].filter(Boolean).join(' · ') || null,
      avatarCode: f.agent.code,
      avatarUrl: f.agent.avatar_url ?? null,
      avatarVersion: f.agent.avatar_updated_at ? f.agent.avatar_updated_at.getTime() : null,
      idConversation: f.id,
      idAgent: f.agent.id_agent,
      agentCode: f.agent.code,
      idProject: f.project?.id_project,
      lastMessageAt: f.last_message_at ? f.last_message_at.toISOString() : null,
    }));

    return jsonNoStore({ destinos });
  } catch (error) {
    return serverError('GET /api/chat/compartir/proyectos', error);
  }
}
