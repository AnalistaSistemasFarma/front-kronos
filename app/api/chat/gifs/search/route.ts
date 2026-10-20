import { NextRequest } from 'next/server';
import { buscarGifs, gifConfig, rutaProxyFirmada } from '../../../../../lib/chat/gif';
import { accesoAMedia } from '../../../../../lib/chat/media-access';
import { forbidden, jsonNoStore, resolveSessionUser, serverError, unauthorized } from '../../../../../lib/chat/http';

export const dynamic = 'force-dynamic';

/**
 * Buscador de GIF del chat (2026-10-20).
 *
 *   GET /api/chat/gifs/search?q=gracias&offset=0
 *     -> { items: [{ id, title, width, height, previewUrl }], next }
 *   (sin `q`: los populares)
 *
 * La consulta a GIPHY la hace el SERVIDOR con su llave y con rating estricto
 * (lib/chat/gif.ts). Al navegador solo le llegan ids, títulos y rutas del
 * proxy FIRMADAS: ni la llave ni la URL de GIPHY, y las imágenes las pide a
 * SynerLink, no a GIPHY.
 *
 * Apagado (sin CHAT_GIPHY_API_KEY): 404 `{ enabled: false }`.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();
    const cfg = gifConfig();
    if (!cfg.enabled) return jsonNoStore({ enabled: false, error: 'Los GIF no están habilitados.' }, { status: 404 });
    const acceso = await accesoAMedia(user);
    if (!acceso.ok) return forbidden('No tiene habilitado el chat.');

    const sp = request.nextUrl.searchParams;
    const q = (sp.get('q') ?? '').slice(0, 50);
    const offset = Number.parseInt(sp.get('offset') ?? '0', 10) || 0;

    let resultado;
    try {
      resultado = await buscarGifs(q, offset, cfg);
    } catch (error) {
      console.error('[chat] búsqueda de GIF en GIPHY falló:', error);
      return jsonNoStore({ error: 'El servicio de GIF no respondió. Intente de nuevo.' }, { status: 502 });
    }
    return jsonNoStore({
      enabled: true,
      items: resultado.gifs.map((g) => ({
        id: g.id,
        title: g.title,
        width: g.width,
        height: g.height,
        previewUrl: rutaProxyFirmada(g.url),
      })),
      next: resultado.siguiente,
    });
  } catch (error) {
    return serverError('GET /api/chat/gifs/search', error);
  }
}
