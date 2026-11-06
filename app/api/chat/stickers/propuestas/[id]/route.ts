import { checkAdminPrivileges } from '../../../../../../lib/access-control';
import { badRequest, forbidden, jsonNoStore, readJsonBody, resolveSessionUser, serverError, unauthorized } from '../../../../../../lib/chat/http';
import { ErrorMiSticker, MisStickersNoDisponibles, revisarPropuesta } from '../../../../../../lib/chat/stickers-personales';

/**
 * Aprobar o rechazar una propuesta de sticker (2026-10-21). SOLO
 * administradores.
 *
 *   POST /api/chat/stickers/propuestas/7   { "accion": "aprobar" | "rechazar" }
 *
 * Aprobar COPIA el sticker como sticker de la empresa propuesta; la persona
 * conserva el suyo en «Mis stickers».
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    if (!(await checkAdminPrivileges(user.email))) return forbidden('Solo un administrador revisa las propuestas.');
    const id = Number.parseInt((await params).id, 10);
    if (!Number.isInteger(id) || id <= 0) return jsonNoStore({ error: 'Esa propuesta no existe.' }, { status: 404 });
    const body = await readJsonBody(request);
    const accion = body?.accion;
    if (accion !== 'aprobar' && accion !== 'rechazar') return badRequest('Indique si la aprueba o la rechaza.');
    await revisarPropuesta(user.id, id, accion);
    return jsonNoStore({ ok: true });
  } catch (error) {
    if (error instanceof ErrorMiSticker) return jsonNoStore({ error: error.message }, { status: error.status });
    if (error instanceof MisStickersNoDisponibles) return jsonNoStore({ error: error.message }, { status: 503 });
    return serverError('POST /api/chat/stickers/propuestas/[id]', error);
  }
}
