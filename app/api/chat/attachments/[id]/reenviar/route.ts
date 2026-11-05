import { NextRequest } from 'next/server';
import { destinosDe, reenviarArchivo } from '../../../../../../lib/chat/reenviar-archivo';
import { prisma } from '../../../../../../lib/prisma';
import {
  guardConversation,
  jsonNoStore,
  resolveSessionUser,
  serverError,
  unauthorized,
  type ChatSessionUser,
} from '../../../../../../lib/chat/http';

export const dynamic = 'force-dynamic';

/**
 * REENVIAR UN ADJUNTO DEL CHAT a otra conversación (2026-10-24).
 *
 *   GET  /api/chat/attachments/42/reenviar
 *        → { destinos: DestinoReenvio[] }   a dónde lo puede reenviar
 *   POST /api/chat/attachments/42/reenviar   { "idConversation": 77, "body": "opcional" }
 *        → 201 { message }                   el mensaje nuevo en el destino
 *
 * Pedido de Nicolás Rivera: «quiero que podamos enviar por chat interno de
 * SynerLink los adjuntos». Destinos: personas, grupos y conversaciones de
 * proyecto. Los hilos directos con un agente NO: reenviarle un archivo a un
 * agente lo despertaría sin que nadie se lo pidiera.
 *
 * SEGURIDAD — DOS PUERTAS, las mismas de siempre:
 *   1. ORIGEN: guardConversation() sobre la conversación DEL ADJUNTO (la misma
 *      del visor y de la descarga). Quien no puede ver el adjunto recibe 404
 *      sin pistas: nadie reenvía lo que no puede ver.
 *   2. DESTINO: guardConversation() sobre la conversación elegida
 *      (assertPeopleAccess, assertGroupAccess o la membresía del proyecto con
 *      permiso de ESCRITURA). El id llega del cliente y se valida completo.
 *
 * EL ARCHIVO SE COPIA, no se enlaza: se baja de OneDrive con el token del
 * servidor y se sube a la carpeta de la conversación destino, igual que un
 * adjunto nuevo. Así cada conversación es dueña de su copia (borrar o retener
 * una no toca la otra) y ninguna URL de OneDrive sale del servidor.
 *
 * El mensaje se publica con publicarMensajeDePersona(): mismo autor (la
 * sesión), mismas entregas, mismo push que un envío normal.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const origen = await adjuntoVisible(id);
    if ('response' in origen) return origen.response;

    const destinos = await destinosDe(origen.user, origen.idConversationOrigen);
    return jsonNoStore({ destinos });
  } catch (error) {
    return serverError('GET /api/chat/attachments/[id]/reenviar', error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const origen = await adjuntoVisible(id);
    if ('response' in origen) return origen.response;
    const { adjunto } = origen;

    return await reenviarArchivo(request, adjunto, origen.idConversationOrigen);
  } catch (error) {
    return serverError('POST /api/chat/attachments/[id]/reenviar', error);
  }
}

/* ───────────────────────────── Ayudantes ────────────────────────────── */

type AdjuntoOrigen = {
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
  onedrive_item_id: string;
};

/**
 * 1. Puerta del ORIGEN: el adjunto existe, tiene archivo y quien pide puede
 * ver su conversación. Si no, 404 sin pistas (mismo cuerpo en todos los casos).
 */
async function adjuntoVisible(
  rawId: string
): Promise<{ response: Response } | { user: ChatSessionUser; adjunto: AdjuntoOrigen; idConversationOrigen: number }> {
  const attachmentId = Number.parseInt(rawId, 10);
  if (!/^\d+$/.test(rawId) || !Number.isInteger(attachmentId) || attachmentId <= 0) return { response: notFound() };

  // Primero la sesión: sin ella, 401 sin mirar si el adjunto existe.
  const user = await resolveSessionUser();
  if (!user) return { response: unauthorized() };

  const fila = await prisma.chatAttachment.findUnique({
    where: { id: attachmentId },
    select: {
      file_name: true,
      content_type: true,
      size_bytes: true,
      onedrive_item_id: true,
      message: { select: { id_conversation: true } },
    },
  });
  if (!fila || !fila.onedrive_item_id) return { response: notFound() };

  const guard = await guardConversation(String(fila.message.id_conversation));
  if ('response' in guard) return { response: notFound() };

  return {
    user,
    idConversationOrigen: fila.message.id_conversation,
    adjunto: {
      file_name: fila.file_name,
      content_type: fila.content_type,
      size_bytes: fila.size_bytes,
      onedrive_item_id: fila.onedrive_item_id,
    },
  };
}

function notFound() {
  return jsonNoStore({ error: 'Adjunto no encontrado.' }, { status: 404 });
}
