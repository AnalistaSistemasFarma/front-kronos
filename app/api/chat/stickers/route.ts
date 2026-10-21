import { PAQUETES_PROPIOS, PAQUETE_EMPRESA, PAQUETE_MIOS, todosLosStickersPropios } from '../../../../lib/chat/stickers-paquetes';
import { misStickers, stickersDeEmpresa } from '../../../../lib/chat/stickers-personales';
import { checkAdminPrivileges } from '../../../../lib/access-control';
import { gifConfig } from '../../../../lib/chat/gif';
import { accesoAMedia } from '../../../../lib/chat/media-access';
import { tablaAusente } from '../../../../lib/chat/message-extras';
import { forbidden, jsonNoStore, resolveSessionUser, serverError, unauthorized } from '../../../../lib/chat/http';

export const dynamic = 'force-dynamic';

/**
 * Catálogo del selector de stickers y GIF (2026-10-20).
 *
 *   GET /api/chat/stickers
 *     -> { gif: boolean,
 *          packs: [{ id, nombre }],
 *          stickers: [{ key, provider, pack, code?, idSticker?, label, src, animated, poster }] }
 *
 * `gif` dice si la pestaña de GIF va (hay llave de GIPHY). Los stickers son el
 * paquete propio de GSS (archivos versionados) más los que un administrador
 * cargue para las empresas de quien pregunta (tabla chat_sticker; si la tabla
 * aún no existe, solo el paquete propio).
 *
 * Desde el 2026-10-20 hay varios PAQUETES (barra de paquetes del panel, como
 * Telegram): 'animados' (Noto Emoji Animation, WebP animado), 'gss' (el
 * estático del #698) y 'empresa' (si hay alguno cargado). `animated` y
 * `poster` le dicen al panel cuáles se mueven y cuál es su cuadro fijo.
 * Desde el 2026-10-21 va primero 'mios' («Mis stickers», los que carga cada
 * persona), si la tabla chat_sticker_personal existe. Se pide al abrir el selector, no en
 * cada vuelta del sondeo.
 */
export async function GET() {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    const acceso = await accesoAMedia(user);
    if (!acceso.ok) return forbidden('No tiene habilitado el chat.');

    const propios = todosLosStickersPropios().map((s) => ({
      key: `gss:${s.code}`,
      provider: 'gss' as const,
      pack: s.paquete,
      code: s.code,
      label: s.label,
      keywords: s.keywords,
      src: s.src,
      animated: s.animated,
      poster: s.poster,
    }));

    let deEmpresa: {
      key: string;
      provider: 'empresa';
      pack: 'empresa' | 'mios';
      idSticker: number;
      label: string;
      keywords: string;
      src: string;
      animated: boolean;
      poster: null;
    }[] = [];
    try {
      // Nunca los personales de otras personas (stickersDeEmpresa los excluye).
      const filas = await stickersDeEmpresa(acceso.empresas);
      deEmpresa = filas.map((f) => ({
        key: `empresa:${f.id_sticker}`,
        provider: 'empresa' as const,
        pack: 'empresa' as const,
        idSticker: f.id_sticker,
        label: f.label,
        keywords: f.keywords ?? '',
        src: `/api/chat/stickers/${f.id_sticker}`,
        // Un WebP o GIF animado de la empresa se mueve solo; no hay cuadro fijo.
        animated: false,
        poster: null,
      }));
    } catch (error) {
      if (!tablaAusente(error)) throw error;
    }

    // «Mis stickers» (2026-10-21): null = la tabla aún no existe en esta base.
    let mios: typeof deEmpresa = [];
    let misDisponibles = false;
    try {
      const lista = await misStickers(user.id);
      if (lista) {
        misDisponibles = true;
        mios = lista.map((m) => ({
          key: `mio:${m.idSticker}`,
          provider: 'empresa' as const,
          pack: 'mios' as const,
          idSticker: m.idSticker,
          label: m.label,
          keywords: `${m.label} propio`,
          src: m.src,
          animated: false,
          poster: null,
        }));
      }
    } catch (error) {
      if (!tablaAusente(error)) throw error;
    }

    const packs = [
      ...(misDisponibles ? [PAQUETE_MIOS] : []),
      ...PAQUETES_PROPIOS,
      ...(deEmpresa.length ? [PAQUETE_EMPRESA] : []),
    ];
    return jsonNoStore({
      gif: gifConfig().enabled,
      packs,
      stickers: [...mios, ...propios, ...deEmpresa],
      // Para la pantalla de «Mis stickers»: a qué empresas se puede proponer y
      // si quien mira revisa propuestas. La reja de verdad está en cada ruta.
      misStickers: misDisponibles,
      empresas: acceso.nombresEmpresas,
      puedeRevisar: misDisponibles ? await checkAdminPrivileges(user.email) : false,
    });
  } catch (error) {
    return serverError('GET /api/chat/stickers', error);
  }
}
