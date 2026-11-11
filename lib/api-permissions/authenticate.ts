/**
 * PERMISOS API — autenticación de clientes de API en rutas REST de integración.
 *
 * Uso en una ruta nueva (ver docs/permisos-api.md):
 *
 *   const auth = await requireApiPermission(request, 'kronos_list_requests', { companyId });
 *   if (!auth.ok) return auth.response;
 *   // auth.client: id, nombre, empresas, permisos…
 *
 * Falla CERRADO: sin llave, llave con forma rara, llave revocada, cliente
 * inactivo, permiso no marcado o inactivo, empresa fuera del alcance o error de
 * base → no hay acceso. Las respuestas no dicen cuál de esas fue.
 */
import 'server-only';
import { NextResponse } from 'next/server';
import { findActiveKeyByHash, touchApiKeyLastUsed, type ApiClientKeyRecord } from './db';
import {
  clientCoversCompany,
  extractBearerToken,
  hashApiKey,
  looksLikeApiKey,
  safeEqualHash,
  shouldTouchLastUsed,
} from './rules';

export type ApiClientPrincipal = Omit<ApiClientKeyRecord, 'keyHash'>;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/** Último `last_used_at` escrito por llave en este proceso (la base además lo limita a 1/min). */
const lastTouched = new Map<number, number>();

function touchLastUsed(keyId: number): void {
  const now = Date.now();
  if (!shouldTouchLastUsed(lastTouched.get(keyId), now)) return;
  lastTouched.set(keyId, now);
  void touchApiKeyLastUsed(keyId).catch((error: unknown) => {
    console.error('[permisos-api] No se pudo marcar el último uso:', error instanceof Error ? error.message : error);
  });
}

/** Resuelve el cliente de la llave Bearer, o null. Nunca lanza. */
export async function authenticateApiClient(request: Request): Promise<ApiClientPrincipal | null> {
  const token = extractBearerToken(request.headers.get('authorization'));
  if (!looksLikeApiKey(token)) return null;
  try {
    const hash = hashApiKey(token);
    const record = await findActiveKeyByHash(hash);
    if (!record || !safeEqualHash(hash, record.keyHash)) return null;
    touchLastUsed(record.keyId);
    return {
      keyId: record.keyId,
      clientId: record.clientId,
      name: record.name,
      clientType: record.clientType,
      agentCode: record.agentCode,
      allCompanies: record.allCompanies,
      companyIds: record.companyIds,
      permissions: record.permissions,
    };
  } catch (error) {
    console.error('[permisos-api] Error al validar la llave:', error instanceof Error ? error.message : error);
    return null;
  }
}

export type RequireApiPermissionResult =
  | { ok: true; client: ApiClientPrincipal }
  | { ok: false; response: NextResponse };

/**
 * Exige una llave válida con `permissionCode` marcado y, si se pasa
 * `companyId`, que el cliente cubra esa empresa.
 */
export async function requireApiPermission(
  request: Request,
  permissionCode: string,
  options: { companyId?: number } = {}
): Promise<RequireApiPermissionResult> {
  const client = await authenticateApiClient(request);
  if (!client) {
    return { ok: false, response: NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: NO_STORE }) };
  }
  const companyOk =
    options.companyId === undefined ||
    (Number.isInteger(options.companyId) && options.companyId > 0 && clientCoversCompany(client, options.companyId));
  if (!client.permissions.includes(permissionCode) || !companyOk) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Sin permiso para esta operación' }, { status: 403, headers: NO_STORE }),
    };
  }
  return { ok: true, client };
}
