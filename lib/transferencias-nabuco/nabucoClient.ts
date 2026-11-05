import 'server-only';
import {
  NabucoDiagnosticoError,
  PWD_OCULTO,
  diagnosticoHttp,
  diagnosticoRed,
  diagnosticoValidacion,
  enmascararCabeceras,
  enmascararToken,
  pareceToken,
  parsearJson,
  recortar,
  respuestaDiagnostico,
  sanitizarDiagnostico,
  type ContextoHttp,
  type DiagnosticoNabuco,
  type PeticionDiagnostico,
} from './diagnostico';

export { NabucoDiagnosticoError };

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
  diagnostico: DiagnosticoNabuco;
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
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    throw new NabucoDiagnosticoError(diagnosticoValidacion(`La URL de Nabuco «${base}» no es válida.`, 'Escriba la URL completa con protocolo, p. ej. https://servidor:puerto'));
  }
  if (!protocoloNabucoPermitido(u)) throw new NabucoDiagnosticoError(diagnosticoValidacion(MENSAJE_PROTOCOLO_NABUCO, 'Use https; http solo con NABUCO_PERMITIR_HTTP=1 en el servidor de pruebas.'));
  return `${base.replace(/\/+$/, '')}/${ruta.replace(/^\/+/, '')}`;
}

/** Error de autenticación con el HTTP que devolvió Nabuco (sin credenciales en el mensaje). */
export class NabucoAuthError extends NabucoDiagnosticoError {
  constructor(d: DiagnosticoNabuco) {
    super(d);
    this.name = 'NabucoDiagnosticoError';
  }
}

/** URL completa de la ruta de token / de solicitudes (valida el protocolo). */
export function urlToken(c: NabucoConexion): string {
  return unir(c.url, c.rutaToken);
}
export function urlSolicitudes(c: NabucoConexion): string {
  return unir(c.url, c.rutaSolicitudes);
}

/** Llama a fetch y convierte una falla de red/timeout en NabucoDiagnosticoError (etapa 'red'). */
async function llamar(
  contexto: ContextoHttp,
  c: NabucoConexion,
  peticion: PeticionDiagnostico,
  init: RequestInit,
  fetcher: typeof fetch,
  inicio: number,
  secretos: string[]
): Promise<{ res: Response; texto: string }> {
  let res: Response;
  try {
    res = await fetcher(peticion.url, { ...init, signal: AbortSignal.timeout(c.timeoutMs) });
  } catch (e) {
    throw new NabucoDiagnosticoError(sanitizarDiagnostico(diagnosticoRed(e, contexto, peticion, inicio, c.timeoutMs), secretos));
  }
  const texto = await res.text().catch(() => '');
  return { res, texto };
}

export interface TokenDetalle {
  token: string;
  status: number;
  diagnostico: DiagnosticoNabuco;
}

/**
 * Pide el token (POST {ruta_token} con {usr, pwd, org}) y devuelve el HTTP y el diagnóstico.
 * El API devuelve el token como cuerpo JSON (string entre comillas) o como {token|accessToken}.
 * Falla → NabucoAuthError (un NabucoDiagnosticoError) con el diagnóstico (pwd SIEMPRE '•••').
 */
export async function pedirTokenDetalle(c: NabucoConexion, fetcher: typeof fetch = fetch): Promise<TokenDetalle> {
  const inicio = Date.now();
  const url = urlToken(c);
  const cabeceras = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const peticion: PeticionDiagnostico = { metodo: 'POST', url, cabeceras, cuerpo: JSON.stringify({ usr: c.usuario, pwd: PWD_OCULTO, org: c.org }) };
  const secretos = [c.password];
  const { res, texto } = await llamar('autenticacion', c, peticion, { method: 'POST', headers: cabeceras, body: JSON.stringify({ usr: c.usuario, pwd: c.password, org: c.org }) }, fetcher, inicio, secretos);
  // El cuerpo de /AuthBI ES el token: nunca se guarda completo en el diagnóstico.
  const crudoSeguro = (t: string) => (pareceToken(t) ? enmascararToken(t.trim().replace(/^"|"$/g, '')) : t);
  const respuesta = respuestaDiagnostico(res.status, res.statusText, res.headers, '');
  respuesta.cuerpo_crudo = recortar(crudoSeguro(texto));
  if (!res.ok) {
    const j = parsearJson(texto);
    if (j.ok) respuesta.cuerpo_json = j.valor;
    throw new NabucoAuthError(sanitizarDiagnostico(diagnosticoHttp('autenticacion', peticion, respuesta, inicio), secretos));
  }
  let token: unknown = texto;
  const j = parsearJson(texto);
  if (j.ok) token = j.valor;
  if (token && typeof token === 'object') {
    const o = token as Record<string, unknown>;
    token = o.token ?? o.accessToken ?? o.access_token ?? null;
  }
  const t = typeof token === 'string' ? token.trim() : '';
  // Un token no lleva espacios ni marcas HTML: una página de login/error no es un token.
  if (!t || /[\s<>]/.test(t)) {
    const d: DiagnosticoNabuco = {
      ...diagnosticoHttp('autenticacion', peticion, respuesta, inicio),
      ok: false,
      etapa: 'respuesta',
      mensaje: `Nabuco respondió HTTP ${res.status} pero no devolvió un token reconocible.`,
      detalle: `Se esperaba un string JSON o un objeto {token|accessToken|access_token}. Llegó (${texto.length} caracteres): ${recortar(crudoSeguro(texto), 500) || '(vacío)'}`,
      sugerencia: 'Revise que la ruta de token sea la de autenticación (p. ej. /AuthBI) y no otra página del servidor.',
    };
    throw new NabucoAuthError(sanitizarDiagnostico(d, secretos));
  }
  return { token: t, status: res.status, diagnostico: sanitizarDiagnostico(diagnosticoHttp('autenticacion', peticion, respuesta, inicio), [...secretos, t]) };
}

/** Pide el token. Preferir obtenerToken() de tokenCache.ts (no pedir AuthBI en cada llamada). */
export async function pedirToken(c: NabucoConexion, fetcher: typeof fetch = fetch): Promise<string> {
  return (await pedirTokenDetalle(c, fetcher)).token;
}

/**
 * Envía un cuerpo JSON YA serializado tal cual. No lanza por HTTP != 2xx: devuelve status, cuerpo y
 * diagnóstico. Lanza NabucoDiagnosticoError solo por falla de red/timeout o URL inválida.
 */
export async function enviarSolicitudCruda(
  c: NabucoConexion,
  token: string,
  cuerpoJson: string,
  fetcher: typeof fetch = fetch,
  maxCuerpo = 20000
): Promise<RespuestaNabuco> {
  const inicio = Date.now();
  const url = urlSolicitudes(c);
  const cabeceras = { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` };
  const peticion: PeticionDiagnostico = { metodo: 'POST', url, cabeceras: enmascararCabeceras(cabeceras), cuerpo: recortar(cuerpoJson) };
  const secretos = [token, c.password];
  const { res, texto } = await llamar('envio', c, peticion, { method: 'POST', headers: cabeceras, body: cuerpoJson }, fetcher, inicio, secretos);
  const cuerpo = texto.slice(0, maxCuerpo);
  const diagnostico = sanitizarDiagnostico(diagnosticoHttp('envio', peticion, respuestaDiagnostico(res.status, res.statusText, res.headers, texto), inicio), secretos);
  return { ok: res.ok, status: res.status, cuerpo, diagnostico };
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
