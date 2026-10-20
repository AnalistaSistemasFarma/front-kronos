import { NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { tablaAusente } from '../../../../../lib/chat/message-extras';
import { NO_STORE, resolveSessionUser, serverError, unauthorized } from '../../../../../lib/chat/http';

/**
 * Imagen de un sticker cargado por una empresa (2026-10-20).
 *
 *   GET /api/chat/stickers/7
 *
 * Exige sesión. No se limita por empresa a propósito: un sticker ya enviado a
 * un grupo con personas de otra empresa tiene que verse para todos; la imagen
 * de un sticker no es información de la conversación (el mensaje sí, y ese
 * sigue protegido por las reglas del hilo).
 *
 * La base solo admite PNG, WebP o GIF (CHECK): nunca se sirve un SVG subido,
 * que podría llevar script. Igual van `nosniff` y una CSP sin scripts.
 * Un sticker desactivado deja de servirse.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    const { id } = await params;
    const idSticker = Number.parseInt(id, 10);
    const noEncontrado = () => NextResponse.json({ error: 'Sticker no encontrado.' }, { status: 404, headers: NO_STORE });
    if (!Number.isInteger(idSticker) || idSticker <= 0) return noEncontrado();

    let fila: { content_type: string; image_data: Uint8Array; updated_at: Date } | null = null;
    try {
      fila = await prisma.chatSticker.findFirst({
        where: { id_sticker: idSticker, active: true },
        select: { content_type: true, image_data: true, updated_at: true },
      });
    } catch (error) {
      if (tablaAusente(error)) return noEncontrado();
      throw error;
    }
    if (!fila || !['image/png', 'image/webp', 'image/gif'].includes(fila.content_type)) return noEncontrado();

    return new NextResponse(Buffer.from(fila.image_data), {
      headers: {
        'Content-Type': fila.content_type,
        'Cache-Control': 'private, max-age=86400',
        ETag: `"${idSticker}-${fila.updated_at.getTime()}"`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return serverError('GET /api/chat/stickers/[id]', error);
  }
}
