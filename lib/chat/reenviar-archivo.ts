import { NextRequest } from 'next/server';
import { serializeMessage, listUserConversations } from './conversations';
import { readClientOrigin } from './client-origin';
import { normalizeMessageBody } from './constants';
import { badRequest, forbidden, guardConversation, jsonNoStore, readJsonBody, type ChatSessionUser } from './http';
import { MAX_CHAT_ATTACHMENT_BYTES, isBlockedAttachmentExtension } from './attachments';
import { downloadChatAttachment, uploadChatAttachments } from './attachmentStorage';
import { publicarMensajeDePersona } from './publicar-mensaje';
import { conversacionesDeProyectoEscribibles } from './projects';
import { MAX_NOTA_REENVIO, ordenarDestinos, type DestinoReenvio } from './compartir';

/**
 * REENVIAR UN ARCHIVO a otra conversación — la parte común (2026-11-05). La usan los
 * adjuntos del chat (app/api/chat/attachments/[id]/reenviar, donde está documentada la
 * seguridad) y los archivos de un proyecto (app/api/proyectos/[id]/archivos/[fileId]/reenviar):
 * «que se pueda previsualizar y compartir idéntico como lo tenemos en el chat».
 *
 * Quien llama YA pasó la puerta del ORIGEN; aquí se valida el DESTINO y se copia el archivo.
 */
export interface ArchivoOrigen {
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
  onedrive_item_id: string;
}

/** POST: copia el archivo a la conversación elegida y publica el mensaje. `idOrigen` = null si no viene de una conversación. */
export async function reenviarArchivo(request: NextRequest, adjunto: ArchivoOrigen, idOrigen: number | null) {
  const datos = await readJsonBody(request);
  if (!datos) return badRequest('El cuerpo debe ser un objeto JSON.');

  const idDestino = Number(datos.idConversation);
  if (!Number.isInteger(idDestino) || idDestino <= 0) return badRequest('Elija a dónde reenviar el archivo.');
  if (idOrigen !== null && idDestino === idOrigen) return badRequest('El archivo ya está en esta conversación.');

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
}

/** Personas y grupos de la bandeja + conversaciones de proyecto con escritura, sin la de origen. */
export async function destinosDe(user: ChatSessionUser, idOrigen: number | null): Promise<DestinoReenvio[]> {
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
