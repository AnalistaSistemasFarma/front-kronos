import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { assertConversationOwnership } from '../../../../../lib/chat/access';
import { authenticateAgent } from '../../../../../lib/chat/agent-auth';
import {
  buildContentDisposition,
  canAccessChatAttachment,
  safeDownloadContentType,
  type ChatAttachmentRequester,
} from '../../../../../lib/chat/attachments';
import { downloadChatAttachment } from '../../../../../lib/chat/attachmentStorage';
import { NO_STORE, resolveSessionUser, serverError, unauthorized } from '../../../../../lib/chat/http';

// El archivo se transmite en vivo desde Graph: nada de esto se cachea ni se
// prerenderiza.
export const dynamic = 'force-dynamic';

/**
 * DESCARGA DE UN ADJUNTO.
 *
 *   GET /api/chat/attachments/42
 *   (sesión de NextAuth)  ó  Authorization: Bearer <llave del agente>
 *
 * -------------------------------------------------------------------------
 * ESTE ES EL PUNTO DELICADO DEL MÓDULO
 * -------------------------------------------------------------------------
 * El id del adjunto es un entero secuencial y visible: cambiarlo en la barra de
 * direcciones es el ataque obvio (IDOR). Por eso la ruta autoriza en dos
 * caminos, y ninguno acepta identidad del cliente:
 *
 *   - USUARIO: la identidad sale de la SESIÓN. Solo puede bajar adjuntos de
 *     conversaciones cuyo `id_user` sea el suyo, y además se revalida
 *     `assertConversationOwnership` (que también comprueba que TODAVÍA tenga
 *     permiso sobre ese agente): si le revocaron el módulo, los enlaces viejos
 *     dejan de servir.
 *   - AGENTE: la identidad sale de la LLAVE (lib/chat/agent-auth.ts), jamás de
 *     un parámetro. Solo los adjuntos de conversaciones de SU agente.
 *
 * Todo lo demás responde 404 —nunca 403—: un 403 le confirmaría a quien va
 * probando números que ese adjunto existe pero es de otra persona. Con 404 no
 * aprende nada.
 *
 * -------------------------------------------------------------------------
 * POR QUÉ SE TRANSMITE Y NO SE REDIRIGE
 * -------------------------------------------------------------------------
 * El contenido pasa POR LA APLICACIÓN, con el token de Graph del servidor. NO
 * se redirige al `web_url` guardado ni a la URL preautenticada que devuelve
 * Graph: esas URL funcionan sin sesión y se reenvían por correo o por chat con
 * un copiar y pegar, así que la autorización de arriba se volvería decorativa.
 * Con el paso a través, el permiso se comprueba en CADA descarga.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const attachmentId = Number.parseInt(id, 10);
    if (!Number.isInteger(attachmentId) || attachmentId <= 0) return notFound();

    /* ─────────────────── 1. Quién pide (nunca el cliente) ──────────────── */

    let requester: ChatAttachmentRequester;
    let sessionEmail: string | null = null;

    if (request.headers.get('authorization')) {
      // Si trae Bearer, se resuelve como agente o no se resuelve: no se cae de
      // vuelta a la sesión, para que una llave revocada no pase de agachadas
      // con la cookie de quien tenga el navegador abierto.
      const agent = await authenticateAgent(request);
      if (!agent) return unauthorized();
      requester = { kind: 'agent', idAgent: agent.idAgent };
    } else {
      const user = await resolveSessionUser();
      if (!user) return unauthorized();
      requester = { kind: 'user', userId: user.id };
      sessionEmail = user.email;
    }

    /* ──────────────────── 2. El adjunto y su dueño ─────────────────────── */

    const attachment = await prisma.chatAttachment.findUnique({
      where: { id: attachmentId },
      select: {
        file_name: true,
        content_type: true,
        onedrive_item_id: true,
        message: {
          select: {
            conversation: { select: { id: true, id_user: true, id_agent: true } },
          },
        },
      },
    });
    if (!attachment) return notFound();

    const conversation = attachment.message.conversation;

    const allowed = canAccessChatAttachment(
      {
        conversationUserId: conversation.id_user,
        conversationAgentId: conversation.id_agent,
      },
      requester
    );
    if (!allowed) return notFound();

    // Segunda vuelta para el usuario: propiedad del hilo + permiso VIGENTE
    // sobre el agente. Es el mismo guardia del resto del módulo
    // (lib/chat/http.ts, guardConversation).
    if (requester.kind === 'user') {
      const owned = await assertConversationOwnership(sessionEmail ?? '', conversation.id);
      if (!owned) return notFound();
    }

    /* ─────────────────────── 3. El contenido ───────────────────────────── */

    if (!attachment.onedrive_item_id) return notFound();

    const content = await downloadChatAttachment(attachment.onedrive_item_id);
    if (!content || !content.stream) {
      return NextResponse.json(
        { error: 'No se pudo recuperar el archivo.' },
        { status: 502, headers: NO_STORE }
      );
    }

    const headers = new Headers(NO_STORE);
    headers.set('Content-Type', safeDownloadContentType(attachment.content_type));
    headers.set('Content-Disposition', buildContentDisposition(attachment.file_name));
    // El navegador NO debe adivinar el tipo: con `attachment` + `nosniff`, un
    // archivo subido por un tercero no se puede hacer pasar por HTML.
    headers.set('X-Content-Type-Options', 'nosniff');
    if (content.contentLength) headers.set('Content-Length', content.contentLength);

    return new NextResponse(content.stream, { status: 200, headers });
  } catch (error) {
    return serverError('GET /api/chat/attachments/[id]', error);
  }
}

/** 404 sin pistas: mismo cuerpo tanto si no existe como si es de otra persona. */
function notFound() {
  return NextResponse.json({ error: 'Adjunto no encontrado.' }, { status: 404, headers: NO_STORE });
}
