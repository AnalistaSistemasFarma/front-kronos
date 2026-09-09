import { NextRequest } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { checkAdminPrivileges } from '../../../../lib/access-control';
import { CHAT_MODULE_URL, getChatAccess } from '../../../../lib/chat/access';
import { getConversationPayload } from '../../../../lib/chat/conversations';
import {
  MAX_GROUP_AGENTS,
  MAX_GROUP_NAME_CHARS,
  MAX_GROUP_USERS,
} from '../../../../lib/chat/groups';
import {
  badRequest,
  jsonNoStore,
  readJsonBody,
  resolveSessionUser,
  serverError,
  unauthorized,
} from '../../../../lib/chat/http';

/**
 * CREAR UN GRUPO del chat: varias personas y varios agentes en un mismo hilo.
 *
 *   POST /api/chat/groups
 *   { "title": "Cierre de mes", "idCompany": 8, "idAgents": [1,20], "idUsers": ["c…","c…"] }
 *
 * Pedido de Nicolás (2026-09-08): "quiero empezar a hacer grupos para poder
 * hablar personas y que los agentes se comuniquen entre si en esos grupos".
 *
 * -------------------------------------------------------------------------
 * SOLO ADMINISTRADORES
 * -------------------------------------------------------------------------
 * Decisión de Nicolás del 2026-09-08. El motivo no es jerárquico sino de
 * costo: cada agente que entra a un grupo es una sesión de Claude que puede
 * despertarse con una mención. Si cualquiera pudiera armar grupos con ocho
 * agentes, el consumo de la flota se iría sin que nadie pueda rastrear quién
 * lo abrió.
 *
 * Se usa `checkAdminPrivileges`, la misma fuente de verdad de Administración →
 * Usuarios y del mensaje masivo, no un rol suelto: así no aparece un segundo
 * criterio de "quién es administrador" que después se desincronice.
 *
 * -------------------------------------------------------------------------
 * TODO GRUPO PERTENECE A UNA EMPRESA
 * -------------------------------------------------------------------------
 * También decisión de Nicolás. Un grupo transversal dejaría a alguien de
 * Farmalógica leyendo lo que se habla de Ryan, y en SynerLink eso está
 * separado a propósito (el permiso del chat es por empresa). De ahí las tres
 * validaciones, que se hacen TODAS antes de escribir nada:
 *
 *   1. El creador tiene el módulo en esa empresa.
 *   2. Cada agente PERTENECE a esa empresa y el creador tiene permiso sobre él.
 *   3. Cada persona invitada tiene el módulo en esa empresa. Si no, se rechaza
 *      con su nombre: agregarla igual crearía un grupo donde alguien figura
 *      pero nunca lo ve, y eso se descubre tarde y de la peor forma.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    if (!(await checkAdminPrivileges(user.email))) {
      return jsonNoStore(
        { error: 'Crear grupos está reservado a los administradores.' },
        { status: 403 }
      );
    }

    const payload = await readJsonBody(request);
    if (!payload) return badRequest('El cuerpo debe ser un objeto JSON.');

    // ── nombre ──────────────────────────────────────────────────────────
    if (typeof payload.title !== 'string' || payload.title.trim() === '') {
      return badRequest('El grupo necesita un nombre.');
    }
    const title = payload.title.trim().slice(0, MAX_GROUP_NAME_CHARS);

    // ── empresa ─────────────────────────────────────────────────────────
    const idCompany = Number(payload.idCompany);
    if (!Number.isInteger(idCompany) || idCompany <= 0) {
      return badRequest('Debe indicar la empresa del grupo.');
    }

    const access = await getChatAccess(user.email);
    if (!access.canUseChat) {
      return jsonNoStore(
        { error: 'No tiene habilitado el módulo de Chat.' },
        { status: 403 }
      );
    }
    if (!access.companies.some((c) => c.idCompany === idCompany)) {
      return jsonNoStore(
        { error: 'No tiene el módulo habilitado en esa empresa.' },
        { status: 403 }
      );
    }

    // ── agentes ─────────────────────────────────────────────────────────
    if (!Array.isArray(payload.idAgents) || payload.idAgents.length === 0) {
      return badRequest('El grupo necesita al menos un asistente.');
    }
    if (payload.idAgents.length > MAX_GROUP_AGENTS) {
      return badRequest(`Un grupo admite como máximo ${MAX_GROUP_AGENTS} asistentes.`);
    }
    const idAgents: number[] = [];
    for (const item of payload.idAgents) {
      const n = Number(item);
      if (!Number.isInteger(n) || n <= 0) return badRequest('idAgents solo admite enteros positivos.');
      if (!idAgents.includes(n)) idAgents.push(n);
    }

    // Cada agente tiene que estar disponible para el creador EN ESA EMPRESA.
    const sinPermiso = idAgents.filter((id) => {
      const a = access.agents.find((x) => x.idAgent === id);
      return !a || !a.companies.some((c) => c.idCompany === idCompany);
    });
    if (sinPermiso.length > 0) {
      return jsonNoStore(
        {
          error:
            'Hay asistentes que no están disponibles para usted en esa empresa: ' +
            sinPermiso.join(', '),
        },
        { status: 403 }
      );
    }

    // ── personas ────────────────────────────────────────────────────────
    const idUsers: string[] = [];
    if (payload.idUsers !== undefined) {
      if (!Array.isArray(payload.idUsers)) return badRequest('idUsers debe ser un arreglo.');
      for (const item of payload.idUsers) {
        if (typeof item !== 'string' || item.trim() === '') {
          return badRequest('idUsers solo admite identificadores de usuario.');
        }
        const id = item.trim();
        // El creador entra siempre; que venga repetido en la lista no es error.
        if (id !== user.id && !idUsers.includes(id)) idUsers.push(id);
      }
    }
    if (idUsers.length + 1 > MAX_GROUP_USERS) {
      return badRequest(`Un grupo admite como máximo ${MAX_GROUP_USERS} personas.`);
    }

    if (idUsers.length > 0) {
      // Que existan, estén activos y tengan el módulo EN ESA EMPRESA.
      const habilitados = await prisma.user.findMany({
        where: {
          id: { in: idUsers },
          isActive: true,
          companyUsers: {
            some: {
              id_company: idCompany,
              subprocesses: { some: { subprocess: { subprocess_url: CHAT_MODULE_URL } } },
            },
          },
        },
        select: { id: true },
      });
      const habilitadosSet = new Set(habilitados.map((u) => u.id));
      const faltantes = idUsers.filter((id) => !habilitadosSet.has(id));

      if (faltantes.length > 0) {
        // Se devuelven los NOMBRES: un id de usuario no le dice nada a nadie.
        const nombres = await prisma.user.findMany({
          where: { id: { in: faltantes } },
          select: { id: true, name: true, email: true },
        });
        const legibles = faltantes.map((id) => {
          const u = nombres.find((x) => x.id === id);
          return u ? u.name?.trim() || u.email : id;
        });
        return jsonNoStore(
          {
            error:
              'Estas personas no tienen habilitado el chat en esa empresa, así que no verían el grupo: ' +
              legibles.join(', ') +
              '. Habilíteselo en Administración → Usuarios y vuelva a intentarlo.',
            missingUsers: legibles,
          },
          { status: 409 }
        );
      }
    }

    // ── creación ────────────────────────────────────────────────────────
    // El agente ANFITRIÓN es el primero de la lista: `chat_conversation`
    // .id_agent es NOT NULL y en un grupo se usa como la cara del grupo en la
    // bandeja (ver el encabezado de la migración add_chat_groups). No es un
    // permiso ni le da un papel especial dentro del grupo.
    const idAnfitrion = idAgents[0];
    const now = new Date();

    const created = await prisma.$transaction(async (tx) => {
      const grupo = await tx.chatConversation.create({
        data: {
          kind: 'group',
          title,
          id_company: idCompany,
          id_user: user.id,
          created_by: user.id,
          id_agent: idAnfitrion,
          last_message_at: now,
          participants: {
            create: [
              // El creador queda 'owner': puede agregar y quitar integrantes.
              { id_user: user.id, role: 'owner' },
              ...idUsers.map((id) => ({ id_user: id, role: 'member' })),
              ...idAgents.map((id) => ({ id_agent: id, role: 'member' })),
            ],
          },
        },
        select: { id: true },
      });

      // Mensaje de apertura, de sistema (no lo escribió nadie). Explica la
      // regla de la mención ahí mismo: si no está a la vista, la primera
      // pregunta de todo el mundo va a ser por qué los asistentes no
      // contestan.
      await tx.chatMessage.create({
        data: {
          id_conversation: grupo.id,
          role: 'system',
          body:
            `Se creó el grupo **${title}**. ` +
            'Los asistentes de este grupo responden **solo cuando se los menciona** con `@`.',
          created_at: now,
          delivered_at: now,
        },
      });

      return grupo;
    });

    const conversation = await getConversationPayload(created.id, user.id);
    return jsonNoStore({ conversation }, { status: 201 });
  } catch (error) {
    return serverError('POST /api/chat/groups', error);
  }
}
