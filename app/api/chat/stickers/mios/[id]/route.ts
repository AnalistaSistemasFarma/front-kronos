import { forbidden, jsonNoStore, resolveSessionUser, serverError, unauthorized } from '../../../../../../lib/chat/http';
import { accesoAMedia } from '../../../../../../lib/chat/media-access';
import { ErrorMiSticker, MisStickersNoDisponibles, quitarMiSticker } from '../../../../../../lib/chat/stickers-personales';

/**
 * Quitar un sticker de «Mis stickers» (2026-10-21).
 *
 *   DELETE /api/chat/stickers/mios/7
 *
 * Solo el dueño. La imagen NO se borra: los mensajes que ya lo enviaron lo
 * siguen mostrando.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    const acceso = await accesoAMedia(user);
    if (!acceso.ok) return forbidden('No tiene habilitado el chat.');
    const id = Number.parseInt((await params).id, 10);
    if (!Number.isInteger(id) || id <= 0) return jsonNoStore({ error: 'Ese sticker no existe.' }, { status: 404 });
    await quitarMiSticker(user.id, id);
    return jsonNoStore({ ok: true });
  } catch (error) {
    if (error instanceof ErrorMiSticker) return jsonNoStore({ error: error.message }, { status: error.status });
    if (error instanceof MisStickersNoDisponibles) return jsonNoStore({ error: error.message }, { status: 503 });
    return serverError('DELETE /api/chat/stickers/mios/[id]', error);
  }
}
