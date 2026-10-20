import { NextRequest, NextResponse } from 'next/server';
import { leerRutaProxy, MAX_GIF_BYTES } from '../../../../../lib/chat/gif';
import { NO_STORE, resolveSessionUser, serverError, unauthorized } from '../../../../../lib/chat/http';

export const dynamic = 'force-dynamic';

/**
 * PROXY de imágenes de GIF (2026-10-20).
 *
 *   GET /api/chat/gifs/proxy?u=<url en base64url>&s=<firma>
 *
 * Existe para que GIPHY NUNCA vea la IP, el navegador ni la sesión de quien mira
 * un GIF en SynerLink: la imagen la baja el servidor y la entrega como propia.
 *
 * No es un proxy abierto:
 *   - exige sesión;
 *   - solo sirve URLs que este servidor FIRMÓ (las del buscador y las de los
 *     mensajes ya enviados), y solo de los dominios de imágenes de GIPHY por
 *     https (lib/chat/gif.ts, urlDeGiphyValida);
 *   - no sigue redirecciones, no reenvía cookies ni cabeceras del navegador;
 *   - solo devuelve image/gif o image/webp, hasta MAX_GIF_BYTES.
 *
 * La respuesta lleva caché privada larga (la misma URL siempre es la misma
 * imagen), `nosniff` y una CSP sin scripts por si alguien la abre directo.
 */
const TIPOS = new Set(['image/gif', 'image/webp']);

export async function GET(request: NextRequest) {
  try {
    const user = await resolveSessionUser();
    if (!user) return unauthorized();

    const sp = request.nextUrl.searchParams;
    const url = leerRutaProxy(sp.get('u'), sp.get('s'));
    if (!url) return NextResponse.json({ error: 'Imagen no válida.' }, { status: 404, headers: NO_STORE });

    let res: Response;
    try {
      res = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
        cache: 'no-store',
        headers: { Accept: 'image/webp,image/gif' },
      });
    } catch {
      return NextResponse.json({ error: 'No se pudo traer la imagen.' }, { status: 502, headers: NO_STORE });
    }
    const tipo = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const largo = Number(res.headers.get('content-length') ?? '0');
    if (!res.ok || !TIPOS.has(tipo) || largo > MAX_GIF_BYTES) {
      return NextResponse.json({ error: 'No se pudo traer la imagen.' }, { status: 502, headers: NO_STORE });
    }
    const datos = await res.arrayBuffer();
    if (datos.byteLength > MAX_GIF_BYTES) {
      return NextResponse.json({ error: 'La imagen es demasiado grande.' }, { status: 502, headers: NO_STORE });
    }
    return new NextResponse(datos, {
      headers: {
        'Content-Type': tipo,
        'Content-Length': String(datos.byteLength),
        'Cache-Control': 'private, max-age=604800, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (error) {
    return serverError('GET /api/chat/gifs/proxy', error);
  }
}
