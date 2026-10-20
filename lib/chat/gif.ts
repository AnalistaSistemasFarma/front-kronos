import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { limpiarTituloGif } from './media-rules';

/**
 * GIF del chat por GIPHY (2026-10-20) — SOLO SERVIDOR.
 *
 * QUÉ PROTEGE ESTE MÓDULO
 *   - La LLAVE de GIPHY (`CHAT_GIPHY_API_KEY`) nunca sale del servidor: el
 *     navegador busca contra /api/chat/gifs/search, no contra GIPHY.
 *   - La IP y la sesión de las personas: las imágenes se sirven por
 *     /api/chat/gifs/proxy, así que GIPHY solo ve al servidor de SynerLink.
 *   - Que el proxy no sea un proxy ABIERTO: solo sirve URLs que este mismo
 *     servidor FIRMÓ (HMAC con una llave derivada de NEXTAUTH_SECRET) y solo de
 *     los dominios de imágenes de GIPHY, por https y sin seguir redirecciones.
 *   - Contenido de oficina: búsqueda con rating estricto (`g` por defecto, a
 *     lo sumo `pg`) y, al ENVIAR, se vuelve a consultar el GIF por su id y se
 *     rechaza si su rating no está permitido (no se confía en el navegador).
 *
 * SIN LLAVE = APAGADO: `gifConfig().enabled` es false, el buscador responde
 * 404 y la interfaz no muestra la pestaña de GIF.
 */

const GIPHY_API = 'https://api.giphy.com/v1/gifs';
const TIMEOUT_MS = 8_000;
/** Tope de lo que el proxy acepta bajar por imagen. Un 200w de GIPHY pesa 50-800 KB. */
export const MAX_GIF_BYTES = 6 * 1024 * 1024;
export const GIFS_POR_PAGINA = 24;

export interface GifConfig {
  enabled: boolean;
  apiKey: string;
  /** Ratings de GIPHY que se aceptan, del más estricto al permitido. */
  ratingBusqueda: 'g' | 'pg';
  ratingsPermitidos: ReadonlySet<string>;
}

/**
 * Configuración vigente, leída del entorno en CADA llamada (así un cambio del
 * .env aplica con el reinicio normal, sin caché que olvidar).
 *   CHAT_GIPHY_API_KEY  llave de la app en developers.giphy.com (vacía = apagado)
 *   CHAT_GIF_RATING     'g' (por defecto) o 'pg'. Cualquier otro valor cae a 'g'.
 */
export function gifConfig(env: NodeJS.ProcessEnv = process.env): GifConfig {
  const apiKey = String(env.CHAT_GIPHY_API_KEY ?? '').trim();
  const rating = String(env.CHAT_GIF_RATING ?? '').trim().toLowerCase() === 'pg' ? 'pg' : 'g';
  const secreto = String(env.NEXTAUTH_SECRET ?? '');
  return {
    // Sin secreto no se puede firmar el proxy: también queda apagado.
    enabled: apiKey.length > 0 && secreto.length >= 16,
    apiKey,
    ratingBusqueda: rating,
    // 'y' (apto para niños) es más estricto que 'g'.
    ratingsPermitidos: new Set(rating === 'pg' ? ['y', 'g', 'pg'] : ['y', 'g']),
  };
}

/* ───────────────────────────── Firma del proxy ─────────────────────────── */

function llave(env: NodeJS.ProcessEnv = process.env): Buffer {
  const secreto = String(env.NEXTAUTH_SECRET ?? '');
  if (secreto.length < 16) throw new Error('NEXTAUTH_SECRET no está configurado.');
  // Llave derivada solo para este uso: el secreto de NextAuth no firma nada más aquí.
  return createHmac('sha256', secreto).update('synerlink-chat-gif-proxy-v1').digest();
}

function firma(url: string, env?: NodeJS.ProcessEnv): string {
  return createHmac('sha256', llave(env)).update(url).digest('base64url');
}

/** Dominios de los que el proxy acepta bajar imágenes. */
const HOST_PERMITIDO = /^(media\d?|i)\.giphy\.com$/;

/** ¿Es una URL de imagen de GIPHY servible? https, host de GIPHY, sin credenciales ni puerto. */
export function urlDeGiphyValida(url: unknown): url is string {
  if (typeof url !== 'string' || url.length > 1000) return false;
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' &&
      HOST_PERMITIDO.test(u.hostname) &&
      u.port === '' &&
      u.username === '' &&
      u.password === ''
    );
  } catch {
    return false;
  }
}

/** Ruta del proxy, firmada, para una URL de GIPHY. */
export function rutaProxyFirmada(url: string, env?: NodeJS.ProcessEnv): string {
  const u = Buffer.from(url, 'utf8').toString('base64url');
  return `/api/chat/gifs/proxy?u=${u}&s=${firma(url, env)}`;
}

/** Verifica una ruta del proxy. Devuelve la URL de GIPHY o null si no es válida. */
export function leerRutaProxy(u: unknown, s: unknown, env?: NodeJS.ProcessEnv): string | null {
  if (typeof u !== 'string' || typeof s !== 'string' || u.length > 1500 || s.length > 100) return null;
  let url: string;
  try {
    url = Buffer.from(u, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!urlDeGiphyValida(url)) return null;
  let esperada: Buffer;
  try {
    esperada = Buffer.from(firma(url, env), 'base64url');
  } catch {
    return null;
  }
  const recibida = Buffer.from(s, 'base64url');
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) return null;
  return url;
}

/* ─────────────────────────────── API de GIPHY ──────────────────────────── */

/** Un GIF tal como lo maneja el servidor (con la URL del proveedor). */
export interface GifDelProveedor {
  id: string;
  title: string;
  rating: string;
  url: string;
  width: number | null;
  height: number | null;
}

/** Id de GIPHY: alfanumérico. Se valida antes de armar cualquier URL con él. */
export function idDeGifValido(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9]{3,64}$/.test(id);
}

type GiphyImagen = { url?: string; webp?: string; width?: string; height?: string };
type GiphyGif = {
  id?: string;
  title?: string;
  rating?: string;
  images?: { fixed_width?: GiphyImagen; fixed_width_downsampled?: GiphyImagen };
};

/** Convierte un GIF de la respuesta de GIPHY; null si no sirve (sin imagen válida). */
export function convertirGif(g: GiphyGif): GifDelProveedor | null {
  if (!idDeGifValido(g.id)) return null;
  const img = g.images?.fixed_width ?? g.images?.fixed_width_downsampled;
  // WebP pesa menos que el GIF; si no viene, el GIF.
  const url = img?.webp && urlDeGiphyValida(img.webp) ? img.webp : img?.url;
  if (!urlDeGiphyValida(url)) return null;
  const n = (v: unknown) => {
    const x = Number.parseInt(String(v ?? ''), 10);
    return Number.isFinite(x) && x > 0 && x < 5000 ? x : null;
  };
  return {
    id: g.id,
    title: limpiarTituloGif(g.title),
    rating: String(g.rating ?? '').toLowerCase(),
    url,
    width: n(img?.width),
    height: n(img?.height),
  };
}

async function pedirGiphy(ruta: string, params: Record<string, string>, cfg: GifConfig): Promise<unknown> {
  const qs = new URLSearchParams({ ...params, api_key: cfg.apiKey });
  const res = await fetch(`${GIPHY_API}${ruta}?${qs.toString()}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'error',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`GIPHY respondió ${res.status}`);
  return res.json();
}

/* Caché corta POR INSTANCIA de las búsquedas: la llave de GIPHY tiene cupo
 * por hora, y escribir «gracias» en tres celulares no debe gastar tres. */
const CACHE_MS = 5 * 60_000;
const CACHE_MAX = 200;
const cacheBusquedas = new Map<string, { hasta: number; valor: { gifs: GifDelProveedor[]; siguiente: number | null } }>();

/**
 * Busca GIF (o trae los populares si no hay texto), ya filtrados por rating.
 * `offset` es la posición en los resultados de GIPHY.
 */
export async function buscarGifs(
  consulta: string,
  offset: number,
  cfg: GifConfig = gifConfig()
): Promise<{ gifs: GifDelProveedor[]; siguiente: number | null }> {
  const q = consulta.trim().slice(0, 50);
  const off = Math.max(0, Math.min(4_000, Math.trunc(offset) || 0));
  const clave = `${cfg.ratingBusqueda}|${q.toLowerCase()}|${off}`;
  const enCache = cacheBusquedas.get(clave);
  if (enCache && enCache.hasta > Date.now()) return enCache.valor;

  const base = { limit: String(GIFS_POR_PAGINA), offset: String(off), rating: cfg.ratingBusqueda };
  const data = (await pedirGiphy(q ? '/search' : '/trending', q ? { ...base, q, lang: 'es' } : base, cfg)) as {
    data?: GiphyGif[];
    pagination?: { total_count?: number; count?: number; offset?: number };
  };
  const gifs = (data.data ?? [])
    .map(convertirGif)
    .filter((g): g is GifDelProveedor => g !== null && cfg.ratingsPermitidos.has(g.rating));
  const total = Number(data.pagination?.total_count ?? 0);
  const vistos = off + (data.data?.length ?? 0);
  const valor = { gifs, siguiente: (data.data?.length ?? 0) > 0 && vistos < total ? vistos : null };

  if (cacheBusquedas.size >= CACHE_MAX) {
    const primera = cacheBusquedas.keys().next().value;
    if (primera !== undefined) cacheBusquedas.delete(primera);
  }
  cacheBusquedas.set(clave, { hasta: Date.now() + CACHE_MS, valor });
  return valor;
}

/**
 * Trae UN GIF por su id para ENVIARLO. Devuelve null si no existe o si su
 * rating no está permitido: el navegador no decide qué es apto.
 */
export async function obtenerGifParaEnviar(id: string, cfg: GifConfig = gifConfig()): Promise<GifDelProveedor | null> {
  if (!idDeGifValido(id)) return null;
  const data = (await pedirGiphy(`/${id}`, {}, cfg)) as { data?: GiphyGif };
  const gif = data.data ? convertirGif(data.data) : null;
  if (!gif || gif.id !== id || !cfg.ratingsPermitidos.has(gif.rating)) return null;
  return gif;
}

/** Solo para las pruebas. */
export function _vaciarCacheGifs() {
  cacheBusquedas.clear();
}
