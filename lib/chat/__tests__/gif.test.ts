import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _vaciarCacheGifs,
  buscarGifs,
  convertirGif,
  gifConfig,
  idDeGifValido,
  leerRutaProxy,
  obtenerGifParaEnviar,
  rutaProxyFirmada,
  urlDeGiphyValida,
} from '../gif';

/*
 * GIF del chat (2026-10-20): llave fuera del navegador, proxy FIRMADO y no
 * abierto, rating estricto también al enviar.
 */
const ENV = { NEXTAUTH_SECRET: 'secreto-de-pruebas-123456', CHAT_GIPHY_API_KEY: 'llave' } as unknown as NodeJS.ProcessEnv;
const URL_OK = 'https://media2.giphy.com/media/abc123/200w.webp?cid=x&rid=200w.webp';

describe('configuración', () => {
  it('sin llave o sin secreto queda APAGADO', () => {
    expect(gifConfig({ NEXTAUTH_SECRET: 'secreto-de-pruebas-123456' } as unknown as NodeJS.ProcessEnv).enabled).toBe(false);
    expect(gifConfig({ CHAT_GIPHY_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv).enabled).toBe(false);
    expect(gifConfig(ENV).enabled).toBe(true);
  });

  it('rating g por defecto; pg solo si se pide; cualquier otro valor cae a g', () => {
    expect(gifConfig(ENV).ratingBusqueda).toBe('g');
    expect([...gifConfig(ENV).ratingsPermitidos].sort()).toEqual(['g', 'y']);
    const pg = gifConfig({ ...ENV, CHAT_GIF_RATING: 'PG' } as NodeJS.ProcessEnv);
    expect(pg.ratingBusqueda).toBe('pg');
    expect(pg.ratingsPermitidos.has('pg-13')).toBe(false);
    expect(pg.ratingsPermitidos.has('r')).toBe(false);
    expect(gifConfig({ ...ENV, CHAT_GIF_RATING: 'r' } as NodeJS.ProcessEnv).ratingBusqueda).toBe('g');
  });
});

describe('proxy firmado', () => {
  it('solo acepta imágenes de GIPHY por https, sin puerto ni credenciales', () => {
    expect(urlDeGiphyValida(URL_OK)).toBe(true);
    expect(urlDeGiphyValida('https://i.giphy.com/abc.webp')).toBe(true);
    expect(urlDeGiphyValida('http://media.giphy.com/media/abc/200w.gif')).toBe(false);
    expect(urlDeGiphyValida('https://media.giphy.com.evil.com/x.gif')).toBe(false);
    expect(urlDeGiphyValida('https://evil.com/media.giphy.com/x.gif')).toBe(false);
    expect(urlDeGiphyValida('https://media.giphy.com:8443/x.gif')).toBe(false);
    expect(urlDeGiphyValida('https://user:pw@media.giphy.com/x.gif')).toBe(false);
    expect(urlDeGiphyValida('https://192.168.10.5/x.gif')).toBe(false);
    expect(urlDeGiphyValida('no es url')).toBe(false);
  });

  it('firma y verifica ida y vuelta', () => {
    const ruta = rutaProxyFirmada(URL_OK, ENV);
    const qs = new URL(ruta, 'http://x').searchParams;
    expect(ruta.startsWith('/api/chat/gifs/proxy?')).toBe(true);
    expect(leerRutaProxy(qs.get('u'), qs.get('s'), ENV)).toBe(URL_OK);
  });

  it('rechaza firmas alteradas, URLs cambiadas y firmas de otro secreto', () => {
    const qs = new URL(rutaProxyFirmada(URL_OK, ENV), 'http://x').searchParams;
    const otraUrl = Buffer.from('https://media.giphy.com/media/OTRO/200w.webp').toString('base64url');
    expect(leerRutaProxy(otraUrl, qs.get('s'), ENV)).toBeNull();
    expect(leerRutaProxy(qs.get('u'), 'AAAA', ENV)).toBeNull();
    expect(leerRutaProxy(qs.get('u'), qs.get('s'), { NEXTAUTH_SECRET: 'otro-secreto-distinto-999' } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(leerRutaProxy(null, null, ENV)).toBeNull();
  });

  it('aunque esté firmada, una URL que no es de GIPHY no se sirve', () => {
    // Firma "válida" de una URL interna: el proxy igual la rechaza por dominio.
    const qs = new URL(rutaProxyFirmada('https://serfarma05.local/secreto', ENV), 'http://x').searchParams;
    expect(leerRutaProxy(qs.get('u'), qs.get('s'), ENV)).toBeNull();
  });
});

describe('respuesta de GIPHY', () => {
  it('valida el id y prefiere WebP', () => {
    expect(idDeGifValido('abc123')).toBe(true);
    expect(idDeGifValido('../x')).toBe(false);
    expect(idDeGifValido('a b')).toBe(false);
    const g = convertirGif({
      id: 'abc123',
      title: 'Thanks GIF by Someone',
      rating: 'G',
      images: { fixed_width: { url: 'https://media.giphy.com/media/abc123/200w.gif', webp: URL_OK, width: '200', height: '150' } },
    });
    expect(g).toEqual({ id: 'abc123', title: 'Thanks', rating: 'g', url: URL_OK, width: 200, height: 150 });
    expect(convertirGif({ id: 'abc123', images: { fixed_width: { url: 'https://evil.com/x.gif' } } })).toBeNull();
    expect(convertirGif({ id: '../../x', images: { fixed_width: { url: URL_OK } } })).toBeNull();
  });
});

describe('búsqueda y envío (fetch simulado)', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    _vaciarCacheGifs();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const gif = (id: string, rating: string) => ({
    id,
    title: `${id} GIF`,
    rating,
    images: { fixed_width: { url: `https://media.giphy.com/media/${id}/200w.gif`, width: '200', height: '200' } },
  });

  it('busca con rating estricto, filtra lo que no es apto y usa caché', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [gif('aaa', 'g'), gif('bbb', 'r'), gif('ccc', 'pg')], pagination: { total_count: 100 } }))
    );
    const cfg = gifConfig(ENV);
    const r = await buscarGifs('gracias', 0, cfg);
    expect(r.gifs.map((g) => g.id)).toEqual(['aaa']);
    expect(r.siguiente).toBe(3);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/v1/gifs/search');
    expect(url.searchParams.get('rating')).toBe('g');
    expect(url.searchParams.get('q')).toBe('gracias');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
    await buscarGifs('gracias', 0, cfg);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sin texto trae los populares', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [], pagination: { total_count: 0 } })));
    const r = await buscarGifs('', 0, gifConfig(ENV));
    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe('/v1/gifs/trending');
    expect(r).toEqual({ gifs: [], siguiente: null });
  });

  it('al ENVIAR vuelve a consultar el GIF y rechaza un rating no permitido', async () => {
    const cfg = gifConfig(ENV);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: gif('zzz', 'r') })));
    expect(await obtenerGifParaEnviar('zzz', cfg)).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: gif('yyy', 'g') })));
    expect((await obtenerGifParaEnviar('yyy', cfg))?.id).toBe('yyy');
    // Un id que no coincide con el pedido tampoco.
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: gif('otro', 'g') })));
    expect(await obtenerGifParaEnviar('yyy', cfg)).toBeNull();
    expect(await obtenerGifParaEnviar('../x', cfg)).toBeNull();
  });

  it('un error de GIPHY se propaga (la ruta responde 502)', async () => {
    fetchMock.mockResolvedValue(new Response('no', { status: 429 }));
    await expect(buscarGifs('x', 0, gifConfig(ENV))).rejects.toThrow(/429/);
  });
});
