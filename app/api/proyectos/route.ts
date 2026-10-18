import { NextRequest } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { getChatAgentAccess } from '../../../../lib/chat/access';
import {
  badRequest,
  jsonNoStore,
  readJsonBody,
  resolveSessionUser,
  serverError,
  unauthorized,
} from '../../../../lib/chat/http';
import { eligibleProjectUsers, listProjectsForUser } from '../../../../lib/chat/projects';
import {
  MAX_OWNED_PROJECTS_PER_AGENT,
  MAX_PROJECT_MEMBERS,
  normalizeProjectInstructions,
  normalizeProjectName,
  projectsEnabledFor,
  validateProfileForAgent,
} from '../../../../lib/chat/projects-rules';

export const dynamic = 'force-dynamic';

/**
 * PROYECTOS (hilos de agente) — F1 piloto, 2026-10-17.
 *
 *   GET  /api/chat/projects?agent=<code>   proyectos de ese agente que la
 *        persona puede abrir, más las empresas y los perfiles con los que
 *        puede crear uno.
 *   POST /api/chat/projects                crea un proyecto.
 *        { agentCode, name, idCompany, profile, instructions?, idUsers? }
 *
 * SEGURIDAD
 *   - La persona sale de la SESIÓN; el dueño es SIEMPRE quien crea.
 *   - El agente debe tener proyectos habilitados (CHAT_PROJECTS_AGENTS) y la
 *     persona debe tener su permiso en la empresa escogida.
 *   - El perfil de conectores debe estar habilitado PARA ESE AGENTE.
 *   - Cada invitado debe tener el chat y el permiso del agente en esa
 *     empresa; si alguno no, no se crea nada y se dice quién (con nombre).
 *   - Sin interruptor, todo responde 404.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    const code = (request.nextUrl.searchParams.get('agent') ?? '').trim();
    if (!code) return badRequest('Debe indicar el asistente (agent).');

    const data = await listProjectsForUser(user, code);
    if (!data) return jsonNoStore({ error: 'No hay proyectos para este asistente.' }, { status: 404 });
    return jsonNoStore(data);
  } catch (error) {
    return serverError('GET /api/chat/projects', error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    const payload = await readJsonBody(request);
    if (!payload) return badRequest('El cuerpo debe ser un objeto JSON.');

    const agentCode = typeof payload.agentCode === 'string' ? payload.agentCode.trim().toLowerCase() : '';
    if (!agentCode || !projectsEnabledFor(agentCode)) {
      return jsonNoStore({ error: 'No hay proyectos para este asistente.' }, { status: 404 });
    }

    const nombre = normalizeProjectName(payload.name);
    if (!nombre.ok) return badRequest(nombre.error);
    const instrucciones = normalizeProjectInstructions(payload.instructions);
    if (!instrucciones.ok) return badRequest(instrucciones.error);
    const perfil = validateProfileForAgent(payload.profile, agentCode);
    if (!perfil.ok) return badRequest(perfil.error);

    const idCompany = Number(payload.idCompany);
    if (!Number.isInteger(idCompany) || idCompany <= 0) return badRequest('Escoja la empresa del proyecto.');

    const agente = await prisma.agent.findFirst({
      where: { code: agentCode, is_active: true },
      select: { id_agent: true },
    });
    if (!agente) return jsonNoStore({ error: 'No hay proyectos para este asistente.' }, { status: 404 });

    // La persona debe tener el permiso del agente EN ESA empresa.
    const acceso = await getChatAgentAccess(user.email, agente.id_agent);
    if (!acceso) return jsonNoStore({ error: 'No hay proyectos para este asistente.' }, { status: 404 });
    if (!acceso.companies.some((c) => c.idCompany === idCompany)) {
      return jsonNoStore(
        { error: 'No tiene este asistente habilitado en esa empresa.' },
        { status: 403 }
      );
    }

    // Invitados: sin duplicados ni el propio dueño, y todos elegibles.
    const crudos = Array.isArray(payload.idUsers) ? payload.idUsers : [];
    const idUsers = [
      ...new Set(
        crudos
          .filter((x): x is string => typeof x === 'string')
          .map((x) => x.trim())
          .filter((x) => x && x !== user.id)
      ),
    ];
    if (idUsers.length + 1 > MAX_PROJECT_MEMBERS) {
      return badRequest(`Un proyecto admite máximo ${MAX_PROJECT_MEMBERS} miembros.`);
    }
    if (idUsers.length > 0) {
      const elegibles = new Set(
        (await eligibleProjectUsers(agente.id_agent, idCompany, idUsers)).map((u) => u.id)
      );
      const faltantes = idUsers.filter((id) => !elegibles.has(id));
      if (faltantes.length > 0) {
        const nombres = await prisma.user.findMany({
          where: { id: { in: faltantes } },
          select: { id: true, name: true, email: true },
        });
        const legibles = faltantes.map((id) => {
          const u = nombres.find((x) => x.id === id);
          return u ? u.name?.trim() || u.email : 'una persona desconocida';
        });
        return jsonNoStore(
          {
            error:
              'Estas personas no tienen el asistente habilitado en esa empresa, así que no podrían entrar: ' +
              legibles.join(', ') +
              '.',
            missingUsers: legibles,
          },
          { status: 409 }
        );
      }
    }

    // Tope de proyectos activos por dueño y agente: cada proyecto despierta
    // sesiones del modelo, y el consumo sale del mismo límite de la flota.
    const propios = await prisma.chatProject.count({
      where: {
        id_agent: agente.id_agent,
        archived: false,
        members: { some: { id_user: user.id, role: 'owner' } },
      },
    });
    if (propios >= MAX_OWNED_PROJECTS_PER_AGENT) {
      return jsonNoStore(
        {
          error: `Ya es dueño de ${MAX_OWNED_PROJECTS_PER_AGENT} proyectos activos con este asistente. Archive uno antes de crear otro.`,
        },
        { status: 409 }
      );
    }

    const now = new Date();
    const creado = await prisma.$transaction(async (tx) => {
      const proyecto = await tx.chatProject.create({
        data: {
          name: nombre.value,
          id_agent: agente.id_agent,
          id_company: idCompany,
          profile: perfil.value,
          instructions: instrucciones.value,
          created_by: user.id,
          members: {
            create: [
              { id_user: user.id, role: 'owner', added_by: user.id },
              ...idUsers.map((id) => ({ id_user: id, role: 'member', added_by: user.id })),
            ],
          },
        },
        select: { id_project: true },
      });

      // Primera conversación del proyecto, para entrar a trabajar de una vez.
      const conversacion = await tx.chatConversation.create({
        data: {
          kind: 'project',
          id_project: proyecto.id_project,
          title: 'Conversación inicial',
          id_company: idCompany,
          id_user: user.id,
          created_by: user.id,
          id_agent: agente.id_agent,
          last_message_at: now,
        },
        select: { id: true },
      });

      await tx.chatMessage.create({
        data: {
          id_conversation: conversacion.id,
          role: 'system',
          body:
            `Se creó el proyecto **${nombre.value}**. ` +
            'Todo lo que se escriba aquí lo atiende el asistente con el contexto, las instrucciones y los archivos de este proyecto, aparte de sus demás conversaciones.',
          created_at: now,
          delivered_at: now,
        },
      });

      return { idProject: proyecto.id_project, idConversation: conversacion.id };
    });

    return jsonNoStore(creado, { status: 201 });
  } catch (error) {
    return serverError('POST /api/chat/projects', error);
  }
}
