import { NextRequest } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { getChatAccess } from '../../../../lib/chat/access';
import { checkAdminPrivileges } from '../../../../lib/access-control';
import { serializeMessage } from '../../../../lib/chat/conversations';
import { MAX_USER_MESSAGE_CHARS, normalizeMessageBody } from '../../../../lib/chat/constants';
import { readClientOrigin } from '../../../../lib/chat/client-origin';
import {
  badRequest,
  jsonNoStore,
  readJsonBody,
  resolveSessionUser,
  serverError,
  unauthorized,
} from '../../../../lib/chat/http';

/**
 * MENSAJE MASIVO: el mismo texto a varios agentes de una sola vez.
 *
 *   POST /api/chat/broadcast   { "body": "…", "idAgents": [1,2,3] }
 *
 * Pedido de Nicolás (2026-09-08): "quiero un botón para poder enviar un mensaje
 * masivo a todos los agentes, y que si voy añadiendo, ese botón también vaya
 * comprendiendo los demás". Es para bajar directivas a la flota.
 *
 * LA CLAVE DE ESE "que vaya comprendiendo los demás": aquí NO hay ninguna lista
 * de agentes escrita. Los destinatarios se resuelven contra los PERMISOS del
 * usuario (getChatAccess), así que un agente sembrado hoy entra al masivo hoy,
 * sin que nadie edite nada. Una lista escrita es exactamente lo que se queda
 * viejo.
 *
 * SEGURIDAD: `idAgents` es un filtro para RESTRINGIR, nunca para ampliar. Todo
 * id que llegue tiene que estar en los agentes que el usuario ya podía usar; si
 * no, la petición se rechaza completa en vez de mandar "lo que se pueda". Sin
 * `idAgents` van todos los que el usuario ve, que es el caso normal.
 *
 * SOLO ADMINISTRADORES, por decisión de Nicolás (2026-09-08): "ese es de solo
 * los administradores". Se usa checkAdminPrivileges, que es la misma fuente de
 * verdad de Administración → Usuarios (rol admin/super_user o el subproceso
 * /process/administration/users), no un rol suelto: así no aparece un segundo
 * criterio de "quién es administrador" que después se desincronice.
 *
 * La reja se comprueba EN EL SERVIDOR, no solo escondiendo el botón: esconder
 * un botón no es seguridad.
 *
 * Sin adjuntos a propósito en esta primera versión: subir el mismo archivo N
 * veces a OneDrive es lento y falla a medias. Si hace falta, se agrega después
 * subiendo una vez y enlazando el mismo adjunto en cada hilo.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    if (!(await checkAdminPrivileges(user.email))) {
      return jsonNoStore(
        { error: 'El mensaje masivo está reservado a los administradores.' },
        { status: 403 }
      );
    }

    const payload = await readJsonBody(request);
    if (!payload) return badRequest('El cuerpo debe ser un objeto JSON.');

    const normalized = normalizeMessageBody(payload.body, MAX_USER_MESSAGE_CHARS);
    if (!normalized.ok) return badRequest(normalized.error);
    const body = normalized.body;

    // Origen de la conexión, para la auditoría (ver lib/chat/client-origin.ts).
    const { clientIp, userAgent } = readClientOrigin(request);

    const access = await getChatAccess(user.email);
    if (!access.canUseChat || access.agents.length === 0) {
      return jsonNoStore({ error: 'No tiene habilitado el módulo de Chat.' }, { status: 403 });
    }

    // Selección opcional. Se valida contra lo que el usuario YA podía usar.
    let destinatarios = access.agents;
    if (payload.idAgents !== undefined) {
      if (!Array.isArray(payload.idAgents) || payload.idAgents.length === 0) {
        return badRequest('idAgents debe ser un arreglo con al menos un agente.');
      }
      const pedidos = payload.idAgents.map((x: unknown) => Number(x));
      if (pedidos.some((n: number) => !Number.isInteger(n) || n <= 0)) {
        return badRequest('idAgents solo admite identificadores válidos.');
      }
      const permitidos = new Set(access.agents.map((a) => a.idAgent));
      const ajenos = pedidos.filter((n: number) => !permitidos.has(n));
      if (ajenos.length > 0) {
        return jsonNoStore(
          { error: 'No tiene permiso para hablar con alguno de los agentes indicados.' },
          { status: 403 }
        );
      }
      const seleccionados = new Set(pedidos);
      destinatarios = access.agents.filter((a) => seleccionados.has(a.idAgent));
    }

    const enviados: { idAgent: number; displayName: string; idConversation: number; idMessage: number }[] = [];
    const fallidos: { idAgent: number; displayName: string; error: string }[] = [];

    // Uno por uno a propósito, no en paralelo: son catorce agentes, cada uno con
    // su transacción, y abrir catorce transacciones simultáneas para ahorrar
    // milisegundos no vale el riesgo de agotar el pool de conexiones. Y si uno
    // falla, los demás siguen: un masivo que se cae completo por un agente es
    // peor que uno que informa a quién no le llegó.
    for (const agente of destinatarios) {
      try {
        const now = new Date();

        // ⚠️ SOLO HILOS DIRECTOS — mismo motivo que en
        // app/api/chat/conversations/route.ts: un GRUPO también guarda
        // `id_user` (creador) e `id_agent` (anfitrión), así que sin este
        // filtro el masivo podía terminar escribiendo dentro de un grupo en
        // vez del hilo privado con ese agente.
        const existente = await prisma.chatConversation.findFirst({
          where: { kind: 'direct', id_user: user.id, id_agent: agente.idAgent, archived: false },
          orderBy: { id: 'desc' },
          select: { id: true },
        });

        const idConversation =
          existente?.id ??
          (
            await prisma.chatConversation.create({
              data: {
                kind: 'direct',
                id_user: user.id,
                id_agent: agente.idAgent,
                title: agente.displayName,
              },
              select: { id: true },
            })
          ).id;

        const mensaje = await prisma.$transaction(async (tx) => {
          const creado = await tx.chatMessage.create({
            data: {
              id_conversation: idConversation,
              role: 'user',
              body,
              created_at: now,
              // Mismo origen para todos los destinatarios del masivo: es una
              // sola petición de una sola persona.
              client_ip: clientIp,
              user_agent: userAgent,
            },
            include: { attachments: true },
          });
          await tx.chatConversation.update({
            where: { id: idConversation },
            data: { last_message_at: now },
          });
          return creado;
        });

        enviados.push({
          idAgent: agente.idAgent,
          displayName: agente.displayName,
          idConversation,
          idMessage: serializeMessage(mensaje).id,
        });
      } catch (error) {
        console.error(`[chat] masivo: falló el envío a ${agente.code}:`, error);
        fallidos.push({
          idAgent: agente.idAgent,
          displayName: agente.displayName,
          error: 'No se pudo entregar el mensaje.',
        });
      }
    }

    // 207 cuando hubo mezcla: el cliente TIENE que mirar la lista de fallidos.
    // Un 200 a secas invitaría a asumir que le llegó a todos.
    const status = fallidos.length === 0 ? 201 : 207;
    return jsonNoStore({ enviados, fallidos, total: destinatarios.length }, { status });
  } catch (error) {
    return serverError('POST /api/chat/broadcast', error);
  }
}
