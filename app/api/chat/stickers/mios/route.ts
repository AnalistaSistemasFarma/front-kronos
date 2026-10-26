import { NextRequest } from 'next/server';
import { accesoAMedia } from '../../../../../lib/chat/media-access';
import { badRequest, forbidden, jsonNoStore, resolveSessionUser, serverError, unauthorized } from '../../../../../lib/chat/http';
import {
  ErrorMiSticker,
  MisStickersNoDisponibles,
  crearMiSticker,
  misStickers,
} from '../../../../../lib/chat/stickers-personales';
import { MAX_BYTES_STICKER, limpiarNombreSticker } from '../../../../../lib/chat/stickers-personales-reglas';

export const dynamic = 'force-dynamic';

/**
 * «MIS STICKERS» (2026-10-21).
 *
 *   GET  /api/chat/stickers/mios            -> { stickers: MiStickerDto[] }
 *   POST /api/chat/stickers/mios            multipart: archivo (WebP), nombre
 *                                           -> 201 { sticker: MiStickerDto }
 *
 * Solo quien usa el chat. El archivo se valida por sus BYTES (WebP estático o
 * animado, hasta 512 KB, entre 64 y 1024 px por lado): la extensión y el tipo
 * que mande el navegador no cuentan.
 */
export async function GET() {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    const acceso = await accesoAMedia(user);
    if (!acceso.ok) return forbidden('No tiene habilitado el chat.');
    const lista = await misStickers(user.id);
    if (!lista) return jsonNoStore({ error: new MisStickersNoDisponibles().message }, { status: 503 });
    return jsonNoStore({ stickers: lista });
  } catch (error) {
    return serverError('GET /api/chat/stickers/mios', error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    const acceso = await accesoAMedia(user);
    if (!acceso.ok) return forbidden('No tiene habilitado el chat.');

    // Tope antes de leer el cuerpo: el archivo más el formulario.
    const largo = Number(request.headers.get('content-length') ?? '0');
    if (largo > MAX_BYTES_STICKER + 64 * 1024) return badRequest('El sticker pesa más de 512 KB.');

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return badRequest('Envíe el sticker como formulario (archivo y nombre).');
    }
    const archivo = form.get('archivo');
    if (!(archivo instanceof Blob)) return badRequest('Falta el archivo del sticker.');
    if (archivo.size > MAX_BYTES_STICKER) return badRequest('El sticker pesa más de 512 KB.');
    const nombre = limpiarNombreSticker(form.get('nombre'));
    if (!nombre) return badRequest('Póngale un nombre al sticker.');

    const bytes = new Uint8Array(await archivo.arrayBuffer());
    const sticker = await crearMiSticker(user.id, nombre, bytes);
    return jsonNoStore({ sticker }, { status: 201 });
  } catch (error) {
    if (error instanceof ErrorMiSticker) return jsonNoStore({ error: error.message }, { status: error.status });
    if (error instanceof MisStickersNoDisponibles) return jsonNoStore({ error: error.message }, { status: 503 });
    return serverError('POST /api/chat/stickers/mios', error);
  }
}
