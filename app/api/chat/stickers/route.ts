import { prisma } from '../../../../lib/prisma';
import { STICKERS_GSS, urlStickerGss } from '../../../../lib/chat/stickers-catalog';
import { gifConfig } from '../../../../lib/chat/gif';
import { accesoAMedia } from '../../../../lib/chat/media-access';
import { tablaAusente } from '../../../../lib/chat/message-extras';
import { forbidden, jsonNoStore, resolveSessionUser, serverError, unauthorized } from '../../../../lib/chat/http';

export const dynamic = 'force-dynamic';

/**
 * Catálogo del selector de stickers y GIF (2026-10-20).
 *
 *   GET /api/chat/stickers
 *     -> { gif: boolean, stickers: [{ key, provider, code?, idSticker?, label, src }] }
 *
 * `gif` dice si la pestaña de GIF va (hay llave de GIPHY). Los stickers son el
 * paquete propio de GSS (archivos versionados) más los que un administrador
 * cargue para las empresas de quien pregunta (tabla chat_sticker; si la tabla
 * aún no existe, solo el paquete propio). Se pide al abrir el selector, no en
 * cada vuelta del sondeo.
 */
export async function GET() {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    const acceso = await accesoAMedia(user);
    if (!acceso.ok) return forbidden('No tiene habilitado el chat.');

    const propios = STICKERS_GSS.map((s) => ({
      key: `gss:${s.code}`,
      provider: 'gss' as const,
      code: s.code,
      label: s.label,
      keywords: s.keywords,
      src: urlStickerGss(s.code),
    }));

    let deEmpresa: { key: string; provider: 'empresa'; idSticker: number; label: string; keywords: string; src: string }[] = [];
    try {
      const filas = await prisma.chatSticker.findMany({
        where: {
          active: true,
          OR: [{ id_company: null }, ...(acceso.empresas.length ? [{ id_company: { in: acceso.empresas } }] : [])],
        },
        select: { id_sticker: true, label: true, keywords: true },
        orderBy: [{ sort_order: 'asc' }, { id_sticker: 'asc' }],
        take: 200,
      });
      deEmpresa = filas.map((f) => ({
        key: `empresa:${f.id_sticker}`,
        provider: 'empresa' as const,
        idSticker: f.id_sticker,
        label: f.label,
        keywords: f.keywords ?? '',
        src: `/api/chat/stickers/${f.id_sticker}`,
      }));
    } catch (error) {
      if (!tablaAusente(error)) throw error;
    }

    return jsonNoStore({ gif: gifConfig().enabled, stickers: [...propios, ...deEmpresa] });
  } catch (error) {
    return serverError('GET /api/chat/stickers', error);
  }
}
