import { NextRequest } from 'next/server';
import { prisma } from '../../../../../../../../lib/prisma';
import { esReaccionPermitida } from '../../../../../../../../lib/chat/reactions-catalog';
import { cambiarReaccion, leerAccion, ReaccionError } from '../../../../../../../../lib/chat/reactions';
import { ExtrasNoDisponibles } from '../../../../../../../../lib/chat/message-extras';
import {
  badRequest,
  forbidden,
  guardConversation,
  jsonNoStore,
  readJsonBody,
  serverError,
} from '../../../../../../../../lib/chat/http';

/**
 * Reaccionar a un mensaje (2026-10-20).
 *
 *   POST /api/chat/conversations/12/messages/345/reactions
 *   { "emoji": "👍", "action": "toggle" | "add" | "remove" }   -> { reactions: [...] }
 *
 * PERMISOS: los mismos del hilo. guardConversation() valida sesión y que quien
 * reacciona sea parte de la conversación (dueño del hilo directo, participante
 * del grupo o del hilo entre personas, miembro del proyecto con permiso
 * vigente); si no, 404 como en todo el chat. En un PROYECTO además se exige
 * poder escribir: un lector no reacciona. El mensaje tiene que ser de ESA
 * conversación (no se puede reaccionar por id a un mensaje ajeno) y no puede
 * ser un aviso del sistema.
 *
 * El emoji tiene que estar en el catálogo cerrado (lib/chat/reactions-catalog).
 * Quien reacciona sale de la sesión, nunca del cuerpo.
 *
 * No despierta al agente (ver lib/chat/reactions.ts).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  try {
    const { id, messageId } = await params;
    const guard = await guardConversation(id);
    if ('response' in guard) return guard.response;

    if (guard.kind === 'project' && !guard.projectWritable.ok) {
      return forbidden(guard.projectWritable.motivo);
    }

    const idMessage = Number.parseInt(messageId, 10);
    if (!Number.isInteger(idMessage) || idMessage <= 0) return badRequest('Mensaje inválido.');

    const body = await readJsonBody(request);
    if (!body) return badRequest('El cuerpo debe ser un objeto JSON.');
    if (!esReaccionPermitida(body.emoji)) return badRequest('Esa reacción no está disponible.');
    const accion = leerAccion(body.action);
    if (!accion) return badRequest('La acción debe ser "add", "remove" o "toggle".');

    const mensaje = await prisma.chatMessage.findUnique({
      where: { id: idMessage },
      select: { id_conversation: true, role: true },
    });
    // Mismo 404 para «no existe» y «es de otra conversación».
    if (!mensaje || mensaje.id_conversation !== guard.conversationId) {
      return jsonNoStore({ error: 'Mensaje no encontrado.' }, { status: 404 });
    }
    if (mensaje.role === 'system') return badRequest('No se puede reaccionar a un aviso del sistema.');

    const reactions = await cambiarReaccion({
      idConversation: guard.conversationId,
      idMessage,
      idUser: guard.user.id,
      emoji: body.emoji,
      accion,
    });
    return jsonNoStore({ reactions });
  } catch (error) {
    if (error instanceof ReaccionError) return jsonNoStore({ error: error.message }, { status: error.status });
    if (error instanceof ExtrasNoDisponibles) return jsonNoStore({ error: error.message }, { status: 503 });
    return serverError('POST /api/chat/conversations/[id]/messages/[messageId]/reactions', error);
  }
}
