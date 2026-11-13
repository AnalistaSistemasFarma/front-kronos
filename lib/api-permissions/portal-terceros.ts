/**
 * PERMISOS API — proveedores y clientes desde la API SAP (proyecto api-sap), SOLO servidor.
 *
 * Contrato: GET {SAP_API_URL}/v1/suppliers?nit= o ?nombre= con un JWT EdDSA firmado por
 * SynerLink (llave PRIVADA SAP_API_SYNERLINK_PRIVATE_KEY; la API tiene la pública en
 * SYNERLINK_JWT_PUBLIC_KEY). Un token NUEVO por consulta y por empresa (uso único, 60 s,
 * scope `suppliers:search`), así que se consultan las 8 empresas en paralelo y se unen por NIT.
 * La llave nunca sale de aquí (ni al navegador ni a los registros). Sin caché, sin seguir
 * redirecciones y con tiempo máximo de 10 s. Cualquier falla devuelve un estado genérico: el
 * detalle técnico solo va al registro del servidor.
 */
import 'server-only';
import { createPrivateKey, randomUUID, sign, type KeyObject } from 'node:crypto';
import {
  mergeSapPartners,
  parsePortalAccess,
  resolvePortalAccessConfig,
  resolveSapApiConfig,
  type PortalAcceso,
  SAP_API_COMPANIES,
  sapSupplierQuery,
  type PortalTercero,
  type PortalTerceroEmpresa,
  type SapSupplierQuery,
} from './subject-rules';

const SAP_API_TIMEOUT_MS = 10_000;
const SAP_API_PATH = '/v1/suppliers';
const TOKEN_LIFETIME_SECONDS = 60;
/** `sub` del token (auditoría y límite por minuto de la API SAP). */
const TOKEN_SUBJECT = 'synerlink-permisos-api';

export type PortalResult<T> = { status: 'ok'; value: T } | { status: 'not_configured' } | { status: 'error' };

const b64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

let cachedKey: { pem: string; key: KeyObject } | null = null;
function privateKey(pem: string): KeyObject {
  if (cachedKey?.pem !== pem) cachedKey = { pem, key: createPrivateKey(pem) };
  return cachedKey.key;
}

function signToken(config: { privateKeyPem: string; issuer: string; audience: string }, company: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      iss: config.issuer,
      aud: config.audience,
      sub: TOKEN_SUBJECT,
      jti: randomUUID(),
      iat: now,
      exp: now + TOKEN_LIFETIME_SECONDS,
      scope: 'suppliers:search',
      company,
    })
  );
  const input = `${header}.${payload}`;
  return `${input}.${b64url(sign(null, Buffer.from(input), privateKey(config.privateKeyPem)))}`;
}

type CompanyResult = { empresa: PortalTerceroEmpresa; body: unknown } | null;

async function searchSap(query: SapSupplierQuery): Promise<PortalResult<PortalTercero[]>> {
  const config = resolveSapApiConfig(process.env);
  if (!config.ok) return { status: 'not_configured' };
  try {
    privateKey(config.privateKeyPem);
  } catch {
    console.error('[permisos-api] SAP_API_SYNERLINK_PRIVATE_KEY no es una llave privada válida');
    return { status: 'not_configured' };
  }
  const params = new URLSearchParams('nit' in query ? { nit: query.nit } : { nombre: query.nombre });

  const results: CompanyResult[] = await Promise.all(
    SAP_API_COMPANIES.map(async (empresa): Promise<CompanyResult> => {
      try {
        const res = await fetch(`${config.baseUrl}${SAP_API_PATH}?${params.toString()}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${signToken(config, empresa.clave)}`, Accept: 'application/json' },
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(SAP_API_TIMEOUT_MS),
        });
        if (!res.ok) {
          // 401 = la API SAP no reconoce la llave de SynerLink (falta SYNERLINK_JWT_PUBLIC_KEY o no son pareja).
          console.error(`[permisos-api] API SAP respondió ${res.status} para ${empresa.clave}`);
          return null;
        }
        return { empresa, body: await res.json().catch(() => null) };
      } catch (error) {
        console.error(
          `[permisos-api] API SAP no disponible (${empresa.clave}):`,
          error instanceof Error ? error.name : 'error'
        );
        return null;
      }
    })
  );

  const ok = results.filter((r): r is NonNullable<CompanyResult> => r !== null);
  // Si ninguna empresa respondió, es un error; si fallaron algunas, se muestra lo que llegó.
  if (ok.length === 0) return { status: 'error' };
  return { status: 'ok', value: mergeSapPartners(ok) };
}

/** Búsqueda para la pantalla (`q` ya validado: vacío o 2-60 caracteres). */
export async function searchPortalTerceros(q: string): Promise<PortalResult<PortalTercero[]>> {
  if (!resolveSapApiConfig(process.env).ok) return { status: 'not_configured' };
  const query = sapSupplierQuery(q);
  // Sin texto (o muy corto para la API SAP) no se consulta: hay que escribir nombre o NIT.
  if (!query) return { status: 'ok', value: [] };
  return searchSap(query);
}

/**
 * Qué ve cada NIT en el portal de proveedores: lo pregunta a la API de la landing
 * (GET {PORTAL_TERCEROS_URL}/api/integraciones/terceros/accesos?nits=…, Bearer PORTAL_TERCEROS_KEY).
 * La API SAP no guarda esto: los vínculos y módulos viven en la base de la landing.
 */
export async function fetchPortalAccess(nits: string[]): Promise<PortalResult<Record<string, PortalAcceso>>> {
  const config = resolvePortalAccessConfig(process.env);
  if (!config.ok) return { status: 'not_configured' };
  try {
    const res = await fetch(
      `${config.baseUrl}/api/integraciones/terceros/accesos?${new URLSearchParams({ nits: nits.join(',') }).toString()}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${config.key}`, Accept: 'application/json' },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(SAP_API_TIMEOUT_MS),
      }
    );
    if (!res.ok) {
      // 401 = la llave no coincide con INTEGRACION_SYNERLINK_KEY de la landing; 503 = la landing no la tiene.
      console.error(`[permisos-api] API del portal respondió ${res.status}`);
      return { status: 'error' };
    }
    return { status: 'ok', value: parsePortalAccess(await res.json().catch(() => null), nits) };
  } catch (error) {
    console.error('[permisos-api] API del portal no disponible:', error instanceof Error ? error.name : 'error');
    return { status: 'error' };
  }
}

/**
 * Administración del portal desde SynerLink: reenvía a la API de la landing
 * ({PORTAL_TERCEROS_URL}/api/integraciones/terceros/portal). GET = vista del NIT; POST = una acción
 * ya filtrada por parsePortalAdminBody, con el correo del administrador en X-SynerLink-Actor
 * (auditoría de la landing). Devuelve el estado y el cuerpo de la landing tal cual (sus mensajes
 * de error ya están en español y no traen detalles técnicos).
 */
export async function callPortalAdmin(
  request: { method: 'GET'; nit: string } | { method: 'POST'; body: Record<string, unknown>; actor: string }
): Promise<PortalResult<{ status: number; body: unknown }>> {
  const config = resolvePortalAccessConfig(process.env);
  if (!config.ok) return { status: 'not_configured' };
  const url =
    request.method === 'GET'
      ? `${config.baseUrl}/api/integraciones/terceros/portal?${new URLSearchParams({ nit: request.nit }).toString()}`
      : `${config.baseUrl}/api/integraciones/terceros/portal`;
  try {
    const res = await fetch(url, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${config.key}`,
        Accept: 'application/json',
        ...(request.method === 'POST' ? { 'Content-Type': 'application/json', 'X-SynerLink-Actor': request.actor } : {}),
      },
      body: request.method === 'POST' ? JSON.stringify(request.body) : undefined,
      cache: 'no-store',
      redirect: 'error',
      // Crear usuarios y vincular consultan SAP desde la landing: un poco más de margen.
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 401 || res.status === 503 || res.status === 429 || res.status >= 500) {
      console.error(`[permisos-api] API del portal (administración) respondió ${res.status}`);
    }
    if (res.status === 401 || (res.status === 503 && request.method === 'GET')) return { status: 'error' };
    return { status: 'ok', value: { status: res.status, body: await res.json().catch(() => null) } };
  } catch (error) {
    console.error('[permisos-api] API del portal no disponible:', error instanceof Error ? error.name : 'error');
    return { status: 'error' };
  }
}

/** Confirma un NIT (coincidencia exacta). value = null si SAP no lo tiene en ninguna empresa. */
export async function findPortalTerceroByNit(nit: string): Promise<PortalResult<PortalTercero | null>> {
  const result = await searchSap({ nit });
  if (result.status !== 'ok') return result;
  return { status: 'ok', value: result.value.find((item) => item.nit === nit) ?? null };
}
