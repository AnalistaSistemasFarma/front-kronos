import 'server-only';
import { createHash } from 'crypto';
import type { DiagnosticoNabuco } from './diagnostico';
import { enviarSolicitudCruda, pedirTokenDetalle, type NabucoConexion, type RespuestaNabuco } from './nabucoClient';

/**
 * Caché del token de Nabuco en memoria del proceso. El instructivo de Nabuco pide no
 * llamar /AuthBI en cada envío («es costoso y puede provocar bloqueos; llamar solo cuando
 * reciba un 401»). Clave = id_config + URL + usuario + hash de la contraseña CIFRADA: si
 * cambia cualquiera de ellos la entrada vieja deja de servir (y se borra). El token nunca
 * sale del servidor ni se guarda en BD.
 *
 * Vigencia: `exp` del JWT menos 60 s de margen; si el token no es un JWT con `exp`, 50 min.
 */

export const MARGEN_EXP_MS = 60_000;
export const VIGENCIA_SIN_EXP_MS = 50 * 60_000;

export interface IdentidadToken {
  idConfig: number;
  url: string;
  usuario: string;
  /** Contraseña tal como está guardada (cifrada); solo se usa su hash. */
  passwordEnc: string;
}

interface Entrada {
  token: string;
  obtenido: number;
  expira: number;
}

const cache = new Map<string, Entrada>();

export function claveToken(i: IdentidadToken): string {
  const h = createHash('sha256').update(i.passwordEnc, 'utf8').digest('hex').slice(0, 32);
  return `${i.idConfig}|${i.url.trim().toLowerCase()}|${i.usuario.trim()}|${h}`;
}

/** Hora (ms) hasta la que se usa el token: `exp` del JWT − 60 s, o 50 min si no hay `exp`. */
export function expiracionToken(token: string, ahora: number): number {
  const partes = token.split('.');
  if (partes.length === 3) {
    try {
      const json = JSON.parse(Buffer.from(partes[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as { exp?: unknown };
      if (typeof json.exp === 'number' && Number.isFinite(json.exp)) return json.exp * 1000 - MARGEN_EXP_MS;
    } catch {
      /* no es un JWT legible: vigencia por defecto */
    }
  }
  return ahora + VIGENCIA_SIN_EXP_MS;
}

export interface OpcionesToken {
  fetcher?: typeof fetch;
  ahora?: () => number;
}

function guardar(id: IdentidadToken, token: string, ahora: number): void {
  const clave = claveToken(id);
  // Credenciales nuevas para la misma config: las entradas viejas ya no sirven.
  for (const k of cache.keys()) if (k.startsWith(`${id.idConfig}|`) && k !== clave) cache.delete(k);
  cache.set(clave, { token, obtenido: ahora, expira: expiracionToken(token, ahora) });
}

/** Token vigente de la caché o uno nuevo (si `forzar`, siempre pide uno nuevo y actualiza la caché). */
export async function obtenerToken(id: IdentidadToken, c: NabucoConexion, opts: OpcionesToken & { forzar?: boolean } = {}): Promise<string> {
  const ahora = (opts.ahora ?? Date.now)();
  const e = cache.get(claveToken(id));
  if (!opts.forzar && e && e.expira > ahora) return e.token;
  const { token } = await pedirTokenDetalle(c, opts.fetcher);
  guardar(id, token, ahora);
  return token;
}

/** «Probar conexión»: SIEMPRE pide token nuevo, actualiza la caché y devuelve el HTTP de /AuthBI. */
export async function renovarToken(id: IdentidadToken, c: NabucoConexion, opts: OpcionesToken = {}): Promise<{ status: number; diagnostico: DiagnosticoNabuco }> {
  const ahora = (opts.ahora ?? Date.now)();
  const r = await pedirTokenDetalle(c, opts.fetcher);
  guardar(id, r.token, ahora);
  return { status: r.status, diagnostico: r.diagnostico };
}

export function invalidarToken(id: IdentidadToken): void {
  cache.delete(claveToken(id));
}

/** Solo para pruebas. */
export function limpiarCacheTokens(): void {
  cache.clear();
}

/**
 * Envía un cuerpo JSON (ya serializado) con el token en caché. Si Nabuco responde 401,
 * invalida, pide un token nuevo UNA vez y reintenta UNA sola vez.
 */
export async function enviarConToken(
  id: IdentidadToken,
  c: NabucoConexion,
  cuerpoJson: string,
  opts: OpcionesToken & { maxCuerpo?: number } = {}
): Promise<RespuestaNabuco & { tokenRenovado: boolean }> {
  const token = await obtenerToken(id, c, opts);
  const r = await enviarSolicitudCruda(c, token, cuerpoJson, opts.fetcher, opts.maxCuerpo);
  if (r.status !== 401) return { ...r, tokenRenovado: false };
  invalidarToken(id);
  const nuevo = await obtenerToken(id, c, { ...opts, forzar: true });
  const r2 = await enviarSolicitudCruda(c, nuevo, cuerpoJson, opts.fetcher, opts.maxCuerpo);
  const nota = 'El primer intento recibió HTTP 401 (token vencido): se pidió un token nuevo y se reintentó una vez.';
  return { ...r2, diagnostico: { ...r2.diagnostico, detalle: r2.diagnostico.detalle ? `${nota} ${r2.diagnostico.detalle}` : nota }, tokenRenovado: true };
}
