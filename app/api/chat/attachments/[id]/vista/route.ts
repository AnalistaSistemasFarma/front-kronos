import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import { NO_STORE, guardConversation, resolveSessionUser, serverError, unauthorized } from '../../../../../../lib/chat/http';
import { responderVista } from '../../../../../../lib/chat/vista-respuesta';

export const dynamic = 'force-dynamic';

/**
 * VISTA PREVIA DE UN ADJUNTO DEL CHAT (2026-10-22).
 *
 *   GET /api/chat/attachments/42/vista            (sesión de NextAuth)
 *   GET /api/chat/attachments/42/vista?como=pdf   (Excel: el PDF de Graph en vez de las hojas)
 *
 * Pedido de Nicolás Rivera: «evitemos la descarga de archivos y tengamos
 * previsualizadores». Lo que responde, según el visor que le toca
 * (lib/chat/visor.ts → tipoDeVisor):
 *
 *   - pdf          → el PDF tal cual (`inline`), para pdf.js en el navegador.
 *   - office       → Word / PowerPoint / Excel viejo convertidos a PDF por
 *                    Microsoft Graph (`content?format=pdf`), con caché.
 *   - hoja (.xlsx) → JSON { hojas: [{ nombre, html }], css }: las hojas como
 *                    tablas con el motor del visor de Excel del SGC (PR #717).
 *                    Con `?como=pdf`, el PDF de Graph.
 *   - markdown, csv, texto → `text/plain; charset=utf-8` (hasta 2 MB; si el
 *                    archivo es más grande se avisa con `X-Visor-Recortado: 1`).
 *                    Nunca el tipo original: un .html o un .svg se ven como
 *                    TEXTO, jamás se interpretan.
 *   - audio, video → el medio en línea con soporte de RANGOS (206): el video
 *                    grande se reproduce en streaming y se puede adelantar.
 *   - imagen       → la imagen en línea (lo mismo que `?inline=1` de la descarga).
 *   - ninguno      → 415: el visor ofrece solo Descargar.
 *
 * SEGURIDAD — la MISMA puerta del hilo y de la descarga:
 *   - Solo con SESIÓN (este visor es para personas; los agentes siguen bajando
 *     por /api/chat/attachments/<id> con su llave).
 *   - guardConversation() sobre la conversación del adjunto: dueño + permiso
 *     vigente sobre el agente en el hilo directo, assertGroupAccess en un
 *     grupo, assertPeopleAccess entre personas, membresía en un proyecto.
 *   - 404 sin pistas tanto si no existe como si es de otra persona.
 *   - El contenido PASA por la aplicación con el token de Graph del servidor:
 *     nunca sale una URL de OneDrive.
 *   - `nosniff` y una CSP que no deja ejecutar nada en todas las respuestas.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const attachmentId = Number.parseInt(id, 10);
    if (!/^\d+$/.test(id) || !Number.isInteger(attachmentId) || attachmentId <= 0) return notFound();

    // Primero la sesión: sin ella, 401 sin mirar si el adjunto existe.
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    const adjunto = await prisma.chatAttachment.findUnique({
      where: { id: attachmentId },
      select: {
        file_name: true,
        content_type: true,
        onedrive_item_id: true,
        message: { select: { id_conversation: true } },
      },
    });
    if (!adjunto) return notFound();

    const guard = await guardConversation(String(adjunto.message.id_conversation));
    if ('response' in guard) return notFound();
    if (!adjunto.onedrive_item_id) return notFound();

    return await responderVista(request, {
      itemId: adjunto.onedrive_item_id,
      nombre: adjunto.file_name,
      contentType: adjunto.content_type,
      etiqueta: 'chat/visor',
    });
  } catch (error) {
    return serverError('GET /api/chat/attachments/[id]/vista', error);
  }
}

/** 404 sin pistas: mismo cuerpo tanto si no existe como si es de otra persona. */
function notFound() {
  return NextResponse.json({ error: 'Adjunto no encontrado.' }, { status: 404, headers: NO_STORE });
}
