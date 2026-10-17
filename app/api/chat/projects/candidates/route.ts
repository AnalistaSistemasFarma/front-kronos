import { NextRequest } from 'next/server';
import { getChatAccess } from '../../../../../lib/chat/access';
import { badRequest, jsonNoStore, resolveSessionUser, serverError, unauthorized } from '../../../../../lib/chat/http';
import { eligibleProjectUsers } from '../../../../../lib/chat/projects';
import { projectsEnabledFor } from '../../../../../lib/chat/projects-rules';

export const dynamic = 'force-dynamic';

/**
 * Personas que se pueden invitar a un proyecto NUEVO de ese agente en esa
 * empresa: activas, con el chat y con el permiso del agente allí.
 *
 *   GET /api/chat/projects/candidates?agent=<code>&idCompany=<id>
 *
 * Solo responde si quien pregunta también tiene el agente en esa empresa.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    const code = (request.nextUrl.searchParams.get('agent') ?? '').trim().toLowerCase();
    const idCompany = Number(request.nextUrl.searchParams.get('idCompany'));
    if (!code) return badRequest('Debe indicar el asistente (agent).');
    if (!Number.isInteger(idCompany) || idCompany <= 0) return badRequest('Debe indicar idCompany.');
    if (!projectsEnabledFor(code)) {
      return jsonNoStore({ error: 'No hay proyectos para este asistente.' }, { status: 404 });
    }

    const access = await getChatAccess(user.email);
    const agente = access.agents.find((a) => a.code.toLowerCase() === code);
    if (!agente || !agente.companies.some((c) => c.idCompany === idCompany)) {
      return jsonNoStore({ error: 'No tiene este asistente habilitado en esa empresa.' }, { status: 403 });
    }

    const users = await eligibleProjectUsers(agente.idAgent, idCompany);
    return jsonNoStore({
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        avatarUrl: u.image,
        isSelf: u.id === user.id,
      })),
    });
  } catch (error) {
    return serverError('GET /api/chat/projects/candidates', error);
  }
}
