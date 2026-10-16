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
 * QUIÉN PUEDE QUÉ (decisión de Nicolás del 2026-10-06: "solo el usuario que
 * tiene asignado el agente puede invitarlo al grupo"):
 *  - PERSONAS: solo el 'owner' del grupo (quien lo creó) agrega o quita.
 *  - AGENTES, agregar: cualquier PERSONA integrante del grupo, pero solo un
 *    agente que tenga asignado ELLA MISMA en la empresa del grupo. Así cada
 *    quien trae sus propios agentes y nadie mete el agente de otro. El owner
 *    no tiene excepción: tampoco puede meter uno que no tenga asignado.
 *  - AGENTES, quitar: el owner, o el integrante que tiene ese agente asignado
 *    en la empresa del grupo. No hay columna de "quién lo agregó", y no hace
 *    falta: quien tiene el agente asignado es quien pudo haberlo traído.
 *
 * No se usa `checkAdminPrivileges` aquí a propósito: un administrador que no
 * esté en el grupo no lo administra; para eso tendría que estar dentro.
 *
 * Reglas que se validan en el servidor, no en la interfaz:
 *  - Una persona solo entra si tiene el módulo habilitado EN LA EMPRESA del
 *    grupo. Si no, no vería el grupo y figuraría de adorno.
 *  - Un asistente solo entra si el que lo agrega lo tiene asignado en esa
 *    empresa (sea o no el owner).
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

/**
 * ¿Tiene esta persona asignado ese agente en la empresa del grupo?
 *
 * Es la única llave para traer (o sacar, si no se es owner) un agente. Se
 * resuelve con `getChatAgentAccess`, que solo devuelve agentes otorgados al
 * usuario por su subproceso-permiso: un id de agente ajeno en el cuerpo de la
 * petición no pasa.
 */
async function tieneAgenteAsignado(
  email: string,
  idAgent: number,
  idCompany: number | null
): Promise<boolean> {
  const acceso = await getChatAgentAccess(email, idAgent);
  return (
    acceso !== null &&
    (idCompany === null || acceso.companies.some((c) => c.idCompany === idCompany))
  );
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardConversation(id);
    if ('response' in guard) return guard.response;

    if (guard.kind !== 'group') return badRequest('Esa conversación no es un grupo.');

    const payload = await readJsonBody(request);
    if (!payload) return badRequest('El cuerpo debe ser un objeto JSON.');

    const objetivo = leerObjetivo(payload);
    if (!objetivo.ok) return badRequest(objetivo.error);

    // Personas: solo el owner. Agentes: cualquier integrante, con su propio
    // agente (se valida más abajo).
    if ('idUser' in objetivo && guard.groupRole !== 'owner') {
      return jsonNoStore(
        { error: 'Solo quien creó el grupo puede agregar personas.' },
        { status: 403 }
      );
    }

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

      // El permiso sobre el agente se comprueba SIEMPRE, para el owner y para
      // cualquier integrante, y en la empresa del grupo: solo entra un agente
      // que quien lo trae tiene asignado (decisión de Nicolás, 2026-10-06).
      if (!(await tieneAgenteAsignado(guard.user.email, objetivo.idAgent, grupo.id_company))) {
        return jsonNoStore(
          {
            error:
              'Solo puede agregar asistentes que usted tenga asignados en la empresa del grupo.',
          },
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

    const payload = await readJsonBody(request);
    if (!payload) return badRequest('El cuerpo debe ser un objeto JSON.');

    const objetivo = leerObjetivo(payload);
    if (!objetivo.ok) return badRequest(objetivo.error);

    // Personas: solo el owner. Agentes: el owner, o quien tiene ese agente
    // asignado en la empresa del grupo (el que pudo haberlo traído).
    if (guard.groupRole !== 'owner') {
      let permitido = false;
      if ('idAgent' in objetivo) {
        const grupo = await prisma.chatConversation.findUnique({
          where: { id: guard.conversationId },
          select: { id_company: true },
        });
        permitido =
          grupo !== null &&
          (await tieneAgenteAsignado(guard.user.email, objetivo.idAgent, grupo.id_company));
      }
      if (!permitido) {
        return jsonNoStore(
          {
            error:
              'idUser' in objetivo
                ? 'Solo quien creó el grupo puede sacar personas.'
                : 'Solo quien creó el grupo o quien tiene asignado ese asistente puede sacarlo.',
          },
          { status: 403 }
        );
      }
    }

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
