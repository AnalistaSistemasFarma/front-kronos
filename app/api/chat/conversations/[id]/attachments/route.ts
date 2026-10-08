import { NextRequest } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { parseNonNegativeInt, parsePositiveInt } from '../../../../../../lib/chat/constants';
import { badRequest, guardConversation, jsonNoStore, serverError } from '../../../../../../lib/chat/http';
import { esImagenAdjunta } from '../../../../../../lib/chat/attachments';
import type { ChatSharedFileDto } from '../../../../../../lib/chat/client';

export const dynamic = 'force-dynamic';

const PAGE_DEFAULT = 60;
const PAGE_MAX = 120;

/**
 * "MULTIMEDIA Y ARCHIVOS" de una conversación (como "Medios compartidos" de
 * Telegram o "Archivos, enlaces y documentos" de WhatsApp). SOLO LECTURA.
 *
 *   GET /api/chat/conversations/12/attachments?limit=60&before=<idAdjunto>
 *
 * Devuelve los adjuntos de los mensajes del hilo, del más reciente al más
 * antiguo, paginados por id. El panel los separa en Fotos y Archivos con el
 * flag `isImage` (misma regla de la vista previa: nunca SVG).
 *
 * Seguridad: guardConversation() — la MISMA puerta del hilo y de la descarga
 * (/api/chat/attachments/[id]): sesión + dueño y permiso vigente sobre el
 * agente en el hilo directo, assertGroupAccess en un grupo, assertPeopleAccess
 * entre personas; 404 si no corresponde. Nunca sale `web_url` ni nada de
 * OneDrive: solo `downloadUrl` hacia /api/chat/attachments/<id>, que vuelve a
 * verificar el permiso en cada descarga.
 *
 * Rendimiento: chat_message(id_conversation, id DESC) y chat_attachment
 * (id_message) ya están indexados; no hace falta un índice nuevo. El panel lo
 * pide solo al abrirse, sin sondeo.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const guard = await guardConversation(id);
    if ('response' in guard) return guard.response;

    const sp = request.nextUrl.searchParams;
    const limit = parsePositiveInt(sp.get('limit'), PAGE_DEFAULT, PAGE_MAX);
    const rawBefore = sp.get('before');
    const before = parseNonNegativeInt(rawBefore);
    if (rawBefore !== null && rawBefore.trim() !== '' && before === null) {
      return badRequest('El cursor "before" debe ser un entero positivo.');
    }

    const filas = await prisma.chatAttachment.findMany({
      where: {
        message: { id_conversation: guard.conversationId },
        ...(before ? { id: { lt: before } } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
      select: {
        id: true,
        file_name: true,
        content_type: true,
        size_bytes: true,
        created_at: true,
        message: {
          select: {
            role: true,
            id_user_author: true,
            userAuthor: { select: { name: true, email: true } },
            agentAuthor: { select: { display_name: true } },
          },
        },
      },
    });

    const hayMas = filas.length > limit;
    const pagina = hayMas ? filas.slice(0, limit) : filas;

    const items: ChatSharedFileDto[] = pagina.map((f) => {
      const m = f.message;
      const esMio =
        m.role === 'user' &&
        (m.id_user_author === guard.user.id || (guard.kind === 'direct' && !m.id_user_author));
      const sentBy = esMio
        ? 'Usted'
        : m.role === 'agent'
          ? m.agentAuthor?.display_name || 'Asistente'
          : m.userAuthor?.name?.trim() || m.userAuthor?.email || 'Alguien';
      return {
        id: f.id,
        fileName: f.file_name,
        contentType: f.content_type,
        sizeBytes: f.size_bytes,
        downloadUrl: `/api/chat/attachments/${f.id}`,
        createdAt: f.created_at.toISOString(),
        sentBy,
        isImage: esImagenAdjunta({ contentType: f.content_type, fileName: f.file_name }),
      };
    });

    return jsonNoStore({
      items,
      nextCursor: hayMas ? pagina[pagina.length - 1].id : null,
    });
  } catch (error) {
    return serverError('GET /api/chat/conversations/[id]/attachments', error);
  }
}
