import { NextRequest } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { serializeMessage, listUserConversations } from '../../../../../../lib/chat/conversations';
import { readClientOrigin } from '../../../../../../lib/chat/client-origin';
import { normalizeMessageBody } from '../../../../../../lib/chat/constants';
import {
  badRequest,
  forbidden,
  guardConversation,
  jsonNoStore,
  readJsonBody,
  resolveSessionUser,
  serverError,
  unauthorized,
  type ChatSessionUser,
} from '../../../../../../lib/chat/http';
import { MAX_CHAT_ATTACHMENT_BYTES, isBlockedAttachmentExtension } from '../../../../../../lib/chat/attachments';
import { downloadChatAttachment, uploadChatAttachments } from '../../../../../../lib/chat/attachmentStorage';
import { publicarMensajeDePersona } from '../../../../../../lib/chat/publicar-mensaje';
import { conversacionesDeProyectoEscribibles } from '../../../../../../lib/chat/projects';
import { MAX_NOTA_REENVIO, ordenarDestinos, type DestinoReenvio } from '../../../../../../lib/chat/compartir';

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

    const datos = await readJsonBody(request);
    if (!datos) return badRequest('El cuerpo debe ser un objeto JSON.');

    const idDestino = Number(datos.idConversation);
    if (!Number.isInteger(idDestino) || idDestino <= 0) return badRequest('Elija a dónde reenviar el archivo.');
    if (idDestino === origen.idConversationOrigen) return badRequest('El archivo ya está en esta conversación.');

    // Comentario opcional: con adjunto el texto puede ir vacío.
    let body = '';
    if (typeof datos.body === 'string' && datos.body.trim() !== '') {
      const normalizado = normalizeMessageBody(datos.body, MAX_NOTA_REENVIO);
      if (!normalizado.ok) return badRequest(normalizado.error);
      body = normalizado.body;
    }

    // 2. Puerta del DESTINO.
    const destino = await guardConversation(String(idDestino));
    if ('response' in destino) return destino.response;
    if (destino.kind === 'direct') {
      return badRequest('Solo se puede reenviar a una persona, un grupo o una conversación de proyecto.');
    }
    if (destino.kind === 'project' && !destino.projectWritable.ok) {
      return forbidden(destino.projectWritable.motivo);
    }

    // Mismas reglas que un adjunto nuevo (por si cambiaron desde que se subió).
    if (isBlockedAttachmentExtension(adjunto.file_name)) {
      return badRequest('Este tipo de archivo no se puede reenviar.');
    }
    if (adjunto.size_bytes !== null && adjunto.size_bytes > MAX_CHAT_ATTACHMENT_BYTES) {
      return badRequest('El archivo supera el tamaño máximo de un adjunto.');
    }

    // OneDrive primero (bajar y subir), la base después: si algo falla no
    // queda ningún mensaje a medias.
    const now = new Date();
    let uploaded;
    try {
      const contenido = await downloadChatAttachment(adjunto.onedrive_item_id);
      if (!contenido?.stream) throw new Error('No se pudo bajar el archivo de OneDrive');
      const blob = await new Response(contenido.stream).blob();
      if (blob.size > MAX_CHAT_ATTACHMENT_BYTES) {
        return badRequest('El archivo supera el tamaño máximo de un adjunto.');
      }
      uploaded = await uploadChatAttachments(
        destino.conversationId,
        [{ fileName: adjunto.file_name, contentType: adjunto.content_type, size: blob.size, blob }],
        now
      );
    } catch (error) {
      console.error('[chat/reenviar] no se pudo copiar el adjunto en OneDrive:', error);
      return jsonNoStore({ error: 'No se pudo copiar el archivo. No se reenvió.' }, { status: 502 });
    }

    const { clientIp, userAgent } = readClientOrigin(request);
    const { message } = await publicarMensajeDePersona(destino, { body, uploaded, clientIp, userAgent, now });

    return jsonNoStore({ message: serializeMessage(message) }, { status: 201 });
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

/** Personas y grupos de la bandeja + conversaciones de proyecto con escritura, sin la de origen. */
async function destinosDe(user: ChatSessionUser, idOrigen: number): Promise<DestinoReenvio[]> {
  const [bandeja, proyectos] = await Promise.all([
    listUserConversations(user.id, user.email, { archived: false }),
    conversacionesDeProyectoEscribibles(user),
  ]);

  const destinos: DestinoReenvio[] = [];
  for (const c of bandeja) {
    if (c.id === idOrigen) continue;
    if (c.kind === 'people') {
      const personas = (c.participants ?? []).filter((p) => p.kind === 'user');
      const otra = personas.find((p) => String(p.id) !== user.id) ?? personas[0];
      destinos.push({
        idConversation: c.id,
        tipo: 'persona',
        titulo: otra?.name?.trim() || c.title?.trim() || 'Persona',
        detalle: null,
        lastMessageAt: c.lastMessageAt,
      });
    } else if (c.kind === 'group') {
      destinos.push({
        idConversation: c.id,
        tipo: 'grupo',
        titulo: c.title?.trim() || 'Grupo sin nombre',
        detalle: c.company?.companyName ?? null,
        lastMessageAt: c.lastMessageAt,
      });
    }
  }
  for (const p of proyectos) {
    if (p.idConversation === idOrigen) continue;
    destinos.push({
      idConversation: p.idConversation,
      tipo: 'proyecto',
      titulo: p.proyecto,
      detalle: `${p.titulo?.trim() || 'Conversación'} · ${p.agente}`,
      lastMessageAt: p.lastMessageAt ? p.lastMessageAt.toISOString() : null,
    });
  }
  return ordenarDestinos(destinos);
}

function notFound() {
  return jsonNoStore({ error: 'Adjunto no encontrado.' }, { status: 404 });
}
