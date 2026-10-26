import 'server-only';

/**
 * Cliente del API de Nabuco WMS. Usa el fetch nativo: valida TLS SIEMPRE
 * (sin NODE_TLS_REJECT_UNAUTHORIZED ni agentes inseguros). El token vive solo en
 * memoria durante la corrida; nunca se registra ni se devuelve al navegador.
 */
export interface NabucoConexion {
  url: string;
  usuario: string;
  password: string;
  org: string;
  rutaToken: string;
  rutaSolicitudes: string;
  timeoutMs: number;
}

export interface RespuestaNabuco {
  ok: boolean;
  status: number;
  cuerpo: string;
}

/**
 * HTTPS siempre. HTTP solo si el servidor tiene NABUCO_PERMITIR_HTTP=1: el ambiente de
 * pruebas de Nabuco solo publica por HTTP (puerto 90). Esa variable va únicamente en testing.
 */
export function protocoloNabucoPermitido(u: URL, env: Record<string, string | undefined> = process.env): boolean {
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && env.NABUCO_PERMITIR_HTTP === '1';
}

export const MENSAJE_PROTOCOLO_NABUCO = 'La URL de Nabuco debe ser https (HTTP solo se permite en el ambiente de pruebas de SynerLink).';

function unir(base: string, ruta: string): string {
  const u = new URL(base);
  if (!protocoloNabucoPermitido(u)) throw new Error(MENSAJE_PROTOCOLO_NABUCO);
  return `${base.replace(/\/+$/, '')}/${ruta.replace(/^\/+/, '')}`;
}

/** Error de autenticación con el HTTP que devolvió Nabuco (sin credenciales en el mensaje). */
export class NabucoAuthError extends Error {
  status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'NabucoAuthError';
    this.status = status;
  }
}

/** URL completa de la ruta de token / de solicitudes (valida el protocolo). */
export function urlToken(c: NabucoConexion): string {
  return unir(c.url, c.rutaToken);
}
export function urlSolicitudes(c: NabucoConexion): string {
  return unir(c.url, c.rutaSolicitudes);
}

/**
 * Pide el token (POST {ruta_token} con {usr, pwd, org}) y devuelve también el HTTP.
 * El API devuelve el token como cuerpo JSON (string entre comillas) o como {token|accessToken}.
 */
export async function pedirTokenDetalle(c: NabucoConexion, fetcher: typeof fetch = fetch): Promise<{ token: string; status: number }> {
  const res = await fetcher(urlToken(c), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ usr: c.usuario, pwd: c.password, org: c.org }),
    signal: AbortSignal.timeout(c.timeoutMs),
  });
  const texto = await res.text().catch(() => '');
  if (!res.ok) throw new NabucoAuthError(`Nabuco rechazó la autenticación (HTTP ${res.status}).`, res.status);
  let token: unknown = texto;
  try {
    token = JSON.parse(texto);
  } catch {
    /* texto plano */
  }
  if (token && typeof token === 'object') {
    const o = token as Record<string, unknown>;
    token = o.token ?? o.accessToken ?? o.access_token ?? null;
  }
  const t = typeof token === 'string' ? token.trim() : '';
  if (!t) throw new NabucoAuthError('Nabuco no devolvió un token.', res.status);
  return { token: t, status: res.status };
}

/** Pide el token. Preferir obtenerToken() de tokenCache.ts (no pedir AuthBI en cada llamada). */
export async function pedirToken(c: NabucoConexion, fetcher: typeof fetch = fetch): Promise<string> {
  return (await pedirTokenDetalle(c, fetcher)).token;
}

/** Envía un cuerpo JSON YA serializado tal cual. No lanza por HTTP != 2xx: devuelve status y cuerpo. */
export async function enviarSolicitudCruda(
  c: NabucoConexion,
  token: string,
  cuerpoJson: string,
  fetcher: typeof fetch = fetch,
  maxCuerpo = 20000
): Promise<RespuestaNabuco> {
  const res = await fetcher(urlSolicitudes(c), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: cuerpoJson,
    signal: AbortSignal.timeout(c.timeoutMs),
  });
  const cuerpo = (await res.text().catch(() => '')).slice(0, maxCuerpo);
  return { ok: res.ok, status: res.status, cuerpo };
}

/** Envía una solicitud de alistamiento. No lanza por HTTP != 2xx: devuelve status y cuerpo. */
export async function enviarSolicitud(
  c: NabucoConexion,
  token: string,
  payload: unknown,
  fetcher: typeof fetch = fetch
): Promise<RespuestaNabuco> {
  return enviarSolicitudCruda(c, token, JSON.stringify(payload), fetcher);
}
