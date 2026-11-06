import { badRequest, forbidden, jsonNoStore, readJsonBody, resolveSessionUser, serverError, unauthorized } from '../../../../../../../lib/chat/http';
import { accesoAMedia } from '../../../../../../../lib/chat/media-access';
import { ErrorMiSticker, MisStickersNoDisponibles, proponerMiSticker } from '../../../../../../../lib/chat/stickers-personales';

/**
 * Proponer un sticker propio a la empresa (2026-10-21).
 *
 *   POST /api/chat/stickers/mios/7/propuesta   { "idCompany": 3 }
 *
 * Solo el dueño y solo a una empresa donde usa el chat. Un administrador la
 * aprueba (queda como sticker de esa empresa) o la rechaza.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    const acceso = await accesoAMedia(user);
    if (!acceso.ok) return forbidden('No tiene habilitado el chat.');
    const id = Number.parseInt((await params).id, 10);
    if (!Number.isInteger(id) || id <= 0) return jsonNoStore({ error: 'Ese sticker no existe.' }, { status: 404 });
    const body = await readJsonBody(request);
    const idCompany = Number(body?.idCompany);
    if (!Number.isInteger(idCompany) || idCompany <= 0) return badRequest('Escoja la empresa.');
    await proponerMiSticker(user.id, id, idCompany, acceso.nombresEmpresas.map((e) => e.id));
    return jsonNoStore({ ok: true });
  } catch (error) {
    if (error instanceof ErrorMiSticker) return jsonNoStore({ error: error.message }, { status: error.status });
    if (error instanceof MisStickersNoDisponibles) return jsonNoStore({ error: error.message }, { status: 503 });
    return serverError('POST /api/chat/stickers/mios/[id]/propuesta', error);
  }
}
