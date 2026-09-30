import { prisma } from '../../../../lib/prisma';
import {
  badRequest,
  jsonNoStore,
  readJsonBody,
  resolveSessionUser,
  serverError,
  unauthorized,
} from '../../../../lib/chat/http';
import { MAX_PINS, isChatRailKey } from '../../../../lib/chat/rail';

/**
 * Chats ANCLADOS de la barra lateral del chat, por persona (2026-09-30).
 *
 *   GET /api/chat/pins                              -> { pins: string[], available }
 *   PUT /api/chat/pins  { key: 'agent:3', pinned }  -> { pins: string[] }
 *
 * Es una preferencia de quien ancla y de nadie más: el usuario sale SIEMPRE de
 * la sesión, nunca del cuerpo. La clave solo dice QUÉ se ancló
 * ('agent:<id>' o 'conv:<id>'); anclar no da acceso a nada —la barra solo
 * pinta las anclas que coinciden con chats que la persona ya puede ver—, así
 * que no hace falta resolver los permisos del chat en cada clic.
 *
 * Tabla aparte (dbo.chat_pin): si el DDL todavía no se aplicó en una base, el
 * GET responde "sin anclas" (`available: false`) y el PUT un 503; el resto del
 * chat no se entera.
 */

function tablaNoExiste(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2021'
  );
}

async function anclasDe(idUser: string): Promise<string[]> {
  const filas = await prisma.chatPin.findMany({
    where: { id_user: idUser },
    select: { target_key: true },
    orderBy: { created_at: 'asc' },
  });
  return filas.map((f) => f.target_key).filter(isChatRailKey);
}

export async function GET() {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    try {
      return jsonNoStore({ pins: await anclasDe(user.id), available: true });
    } catch (error) {
      if (tablaNoExiste(error)) return jsonNoStore({ pins: [], available: false });
      throw error;
    }
  } catch (error) {
    return serverError('GET /api/chat/pins', error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    const body = await readJsonBody(request);
    if (!body || !isChatRailKey(body.key) || typeof body.pinned !== 'boolean') {
      return badRequest("Debe indicar key ('agent:<id>' o 'conv:<id>') y pinned (true o false).");
    }
    const key = body.key;

    try {
      if (body.pinned) {
        const actuales = await prisma.chatPin.count({ where: { id_user: user.id } });
        const yaEsta = await prisma.chatPin.findUnique({
          where: { id_user_target_key: { id_user: user.id, target_key: key } },
          select: { id: true },
        });
        if (!yaEsta) {
          if (actuales >= MAX_PINS) {
            return badRequest(`Puede anclar hasta ${MAX_PINS} chats. Desancle alguno primero.`);
          }
          try {
            await prisma.chatPin.create({ data: { id_user: user.id, target_key: key } });
          } catch (error) {
            // Doble clic o dos pestañas a la vez: el índice único ya lo tiene.
            if ((error as { code?: string })?.code !== 'P2002') throw error;
          }
        }
      } else {
        await prisma.chatPin.deleteMany({ where: { id_user: user.id, target_key: key } });
      }
      return jsonNoStore({ pins: await anclasDe(user.id) });
    } catch (error) {
      if (tablaNoExiste(error)) {
        return jsonNoStore(
          { error: 'Anclar chats todavía no está disponible en este ambiente.' },
          { status: 503 }
        );
      }
      throw error;
    }
  } catch (error) {
    return serverError('PUT /api/chat/pins', error);
  }
}
