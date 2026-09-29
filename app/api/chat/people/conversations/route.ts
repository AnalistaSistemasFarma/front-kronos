import { NextRequest } from 'next/server';
import { getConversationPayload } from '../../../../../lib/chat/conversations';
import { openPeopleConversation } from '../../../../../lib/chat/people';
import {
  badRequest,
  jsonNoStore,
  readJsonBody,
  resolveSessionUser,
  serverError,
  unauthorized,
} from '../../../../../lib/chat/http';

/**
 * Abre (o crea) la conversación privada con OTRA persona.
 *
 *   POST /api/chat/people/conversations   { "idUser": "<id de la persona>" }
 *
 * Idempotente: un par de personas = un hilo (chat_conversation.dm_key con
 * índice único filtrado). Si ya existe, lo devuelve; si no, lo crea con las
 * dos personas como participantes.
 *
 * Reglas (lib/chat/people-rules.ts):
 *   - CREAR exige el piloto `/process/chat/personas` en una empresa que las
 *     dos personas compartan con el Chat (D2).
 *   - REABRIR uno que ya existe solo exige la regla D1: quien recibió el
 *     primer mensaje no necesita el piloto para contestar.
 *
 * Seguridad: quien pide sale de la sesión; del cliente solo llega el id de la
 * otra persona, y se valida contra la regla en cada llamada.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    const body = await readJsonBody(request);
    if (!body) return badRequest('El cuerpo debe ser un objeto JSON.');

    const idUser = typeof body.idUser === 'string' ? body.idUser.trim() : '';
    if (!idUser || idUser.length > 1000) return badRequest('Debe indicar la persona (idUser).');

    const resultado = await openPeopleConversation(user.id, idUser);
    if (!resultado.ok) {
      return jsonNoStore({ error: resultado.error }, { status: resultado.status });
    }

    const conversation = await getConversationPayload(resultado.idConversation, user.id);
    return jsonNoStore(
      { conversation, created: resultado.created },
      { status: resultado.created ? 201 : 200 }
    );
  } catch (error) {
    return serverError('POST /api/chat/people/conversations', error);
  }
}
