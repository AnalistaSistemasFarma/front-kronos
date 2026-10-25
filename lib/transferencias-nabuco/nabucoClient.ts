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

function unir(base: string, ruta: string): string {
  const u = new URL(base);
  if (u.protocol !== 'https:') throw new Error('La URL de Nabuco debe ser https.');
  return `${base.replace(/\/+$/, '')}/${ruta.replace(/^\/+/, '')}`;
}

/** Pide el token (POST {ruta_token} con {usr, pwd, org}). El API devuelve el token como cuerpo JSON. */
export async function pedirToken(c: NabucoConexion, fetcher: typeof fetch = fetch): Promise<string> {
  const res = await fetcher(unir(c.url, c.rutaToken), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ usr: c.usuario, pwd: c.password, org: c.org }),
    signal: AbortSignal.timeout(c.timeoutMs),
  });
  const texto = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`Nabuco rechazó la autenticación (HTTP ${res.status}).`);
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
  if (!t) throw new Error('Nabuco no devolvió un token.');
  return t;
}

/** Envía una solicitud de alistamiento. No lanza por HTTP != 2xx: devuelve status y cuerpo. */
export async function enviarSolicitud(
  c: NabucoConexion,
  token: string,
  payload: unknown,
  fetcher: typeof fetch = fetch
): Promise<RespuestaNabuco> {
  const res = await fetcher(unir(c.url, c.rutaSolicitudes), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(c.timeoutMs),
  });
  const cuerpo = (await res.text().catch(() => '')).slice(0, 20000);
  return { ok: res.ok, status: res.status, cuerpo };
}
