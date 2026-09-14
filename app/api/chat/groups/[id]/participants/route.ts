import { NextRequest } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { CHAT_MODULE_URL, getChatAgentAccess } from '../../../../../../lib/chat/access';
import { getConversationPayload } from '../../../../../../lib/chat/conversations';
import { MAX_GROUP_AGENTS, MAX_GROUP_USERS } from '../../../../../../lib/chat/groups';
import {
  badRequest,
  guardConversation,
  jsonNoStore,
  readJsonBody,
  serverError,
} from '../../../../../../lib/chat/http';

/**
 * INTEGRANTES de un grupo: agregar y quitar.
 *
 *   POST   /api/chat/groups/12/participants  { "idUser": "c…" }
 *   POST   /api/chat/groups/12/participants  { "idAgent": 20 }
 *   DELETE /api/chat/groups/12/participants  { "idUser": "c…" }
 *   DELETE /api/chat/groups/12/participants  { "idAgent": 20 }
 *
 * Solo el 'owner' del grupo (quien lo creó) administra los integrantes. No se
 * usa `checkAdminPrivileges` aquí a propósito: crear un grupo es una decisión
 * de la organización —de ahí la reja de administrador— pero decidir quién
 * entra a UN grupo ya creado es del dueño de ese grupo. Un administrador que
 * no esté en el grupo no lo administra; para eso tendría que estar dentro.
 *
 * Reglas que se validan en el servidor, no en la interfaz:
 *  - Una persona solo entra si tiene el módulo habilitado EN LA EMPRESA del
 *    grupo. Si no, no vería el grupo y figuraría de adorno.
 *  - Un asistente solo entra si el que lo agrega puede usarlo en esa empresa.
 *  - No se puede quedar sin asistentes ni sin 'owner'.
 *  - Al sacar a alguien NO se borran sus mensajes: el hilo es el registro de
 *    lo que se dijo y borrarlo hacia atrás sería reescribir la historia.
 */

/** Lee `idUser` / `idAgent` del cuerpo. Exactamente uno de los dos. */
function leerObjetivo(
  payload: Record<string, unknown>
): { ok: true; idUser: string } | { ok: true; idAgent: number } | { ok: false; error: string } {
  const tieneUsuario = payload.idUser !== undefined && payload.idUser !== null;
  const tieneAgente = payload.idAgent !== undefined && payload.idAgent !== null;

  if (tieneUsuario === tieneAgente) {
    return { ok: false, error: 'Indique idUser o idAgent, uno de los dos.' };
  }
  if (tieneUsuario) {
    if (typeof payload.idUser !== 'string' || payload.idUser.trim() === '') {
      return { ok: false, error: 'idUser debe ser un identificador de usuario.' };
    }
    return { ok: true, idUser: payload.idUser.trim() };
  }
  const n = Number(payload.idAgent);
  if (!Number.isInteger(n) || n <= 0) {
    return { ok: false, error: 'idAgent debe ser un entero positivo.' };
  }
  return { ok: true, idAgent: n };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardConversation(id);
    if ('response' in guard) return guard.response;

    if (guard.kind !== 'group') return badRequest('Esa conversación no es un grupo.');
    if (guard.groupRole !== 'owner') {
      return jsonNoStore(
        { error: 'Solo quien creó el grupo puede cambiar sus integrantes.' },
        { status: 403 }
      );
    }

    const payload = await readJsonBody(request);
    if (!payload) return badRequest('El cuerpo debe ser un objeto JSON.');

    const objetivo = leerObjetivo(payload);
    if (!objetivo.ok) return badRequest(objetivo.error);

    const grupo = await prisma.chatConversation.findUnique({
      where: { id: guard.conversationId },
      select: {
        id_company: true,
        participants: { select: { id_user: true, id_agent: true } },
      },
    });
    if (!grupo) return jsonNoStore({ error: 'Grupo no encontrado.' }, { status: 404 });

    const personas = grupo.participants.filter((p) => p.id_user !== null).length;
    const agentes = grupo.participants.filter((p) => p.id_agent !== null).length;

    if ('idUser' in objetivo) {
      if (grupo.participants.some((p) => p.id_user === objetivo.idUser)) {
        return jsonNoStore({ error: 'Esa persona ya está en el grupo.' }, { status: 409 });
      }
      if (personas + 1 > MAX_GROUP_USERS) {
        return badRequest(`Un grupo admite como máximo ${MAX_GROUP_USERS} personas.`);
      }

      const habilitado = await prisma.user.findFirst({
        where: {
          id: objetivo.idUser,
          isActive: true,
          ...(grupo.id_company !== null
            ? {
                companyUsers: {
                  some: {
                    id_company: grupo.id_company,
                    subprocesses: { some: { subprocess: { subprocess_url: CHAT_MODULE_URL } } },
                  },
                },
              }
            : {}),
        },
        select: { id: true, name: true, email: true },
      });
      if (!habilitado) {
        return jsonNoStore(
          {
            error:
              'Esa persona no tiene habilitado el chat en la empresa del grupo, así que no lo vería. ' +
              'Habilíteselo en Administración → Usuarios y vuelva a intentarlo.',
          },
          { status: 409 }
        );
      }

      await prisma.chatParticipant.create({
        data: { id_conversation: guard.conversationId, id_user: objetivo.idUser, role: 'member' },
      });
    } else {
      if (grupo.participants.some((p) => p.id_agent === objetivo.idAgent)) {
        return jsonNoStore({ error: 'Ese asistente ya está en el grupo.' }, { status: 409 });
      }
      if (agentes + 1 > MAX_GROUP_AGENTS) {
        return badRequest(`Un grupo admite como máximo ${MAX_GROUP_AGENTS} asistentes.`);
      }

      // El permiso sobre el agente se comprueba SIEMPRE, y en la empresa del
      // grupo: si no, un dueño podría meter al grupo un agente al que él mismo
      // no tiene acceso.
      const acceso = await getChatAgentAccess(guard.user.email, objetivo.idAgent);
      const disponible =
        acceso !== null &&
        (grupo.id_company === null ||
          acceso.companies.some((c) => c.idCompany === grupo.id_company));
      if (!disponible) {
        return jsonNoStore(
          { error: 'No tiene ese asistente disponible en la empresa del grupo.' },
          { status: 403 }
        );
      }

      await prisma.chatParticipant.create({
        data: { id_conversation: guard.conversationId, id_agent: objetivo.idAgent, role: 'member' },
      });
    }

    const conversation = await getConversationPayload(guard.conversationId, guard.user.id);
    return jsonNoStore({ conversation }, { status: 201 });
  } catch (error) {
    return serverError('POST /api/chat/groups/[id]/participants', error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardConversation(id);
    if ('response' in guard) return guard.response;

    if (guard.kind !== 'group') return badRequest('Esa conversación no es un grupo.');
    if (guard.groupRole !== 'owner') {
      return jsonNoStore(
        { error: 'Solo quien creó el grupo puede cambiar sus integrantes.' },
        { status: 403 }
      );
    }

    const payload = await readJsonBody(request);
    if (!payload) return badRequest('El cuerpo debe ser un objeto JSON.');

    const objetivo = leerObjetivo(payload);
    if (!objetivo.ok) return badRequest(objetivo.error);

    const fila = await prisma.chatParticipant.findFirst({
      where: {
        id_conversation: guard.conversationId,
        ...('idUser' in objetivo ? { id_user: objetivo.idUser } : { id_agent: objetivo.idAgent }),
      },
      select: { id_participant: true, role: true, id_user: true, id_agent: true },
    });
    if (!fila) return jsonNoStore({ error: 'Ese integrante no está en el grupo.' }, { status: 404 });

    // Un grupo sin dueño no se puede administrar nunca más, y uno sin
    // asistentes deja de ser lo que se pidió. Se frena antes de escribir.
    if (fila.role === 'owner') {
      return badRequest('No se puede sacar del grupo a quien lo creó.');
    }
    if (fila.id_agent !== null) {
      const agentes = await prisma.chatParticipant.count({
        where: { id_conversation: guard.conversationId, id_agent: { not: null } },
      });
      if (agentes <= 1) {
        return badRequest('El grupo tiene que quedar con al menos un asistente.');
      }
    }

    // Se borra la PERTENENCIA, no los mensajes: el hilo es el registro de lo
    // que se dijo.
    await prisma.chatParticipant.delete({ where: { id_participant: fila.id_participant } });

    const conversation = await getConversationPayload(guard.conversationId, guard.user.id);
    return jsonNoStore({ conversation });
  } catch (error) {
    return serverError('DELETE /api/chat/groups/[id]/participants', error);
  }
}
