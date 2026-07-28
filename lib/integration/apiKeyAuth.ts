import { createHash, timingSafeEqual, randomBytes } from 'node:crypto';

/**
 * Auth por API key para integraciones externas (SharePoint / Power Automate).
 * Independiente de NextAuth: no usa cookies ni sesión de usuario.
 *
 * Configuración (.env):
 *   INTEGRATION_API_KEYS=clave-larga-secreta
 *   o varias: INTEGRATION_API_KEYS=key1,key2
 *   o JSON: INTEGRATION_API_KEYS=["key1","key2"]
 *
 * Uso:
 *   Authorization: Bearer <clave>
 */

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

/** Extrae el token de `Authorization: Bearer <token>`. */
export function extractBearer(authorizationHeader: string | null | undefined): string | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!match?.[1]) return null;
  return match[1].trim();
}

function parseIntegrationApiKeys(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];

  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((k): k is string => typeof k === 'string')
        .map((k) => k.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  return trimmed
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

/** Keys configuradas en el entorno (vacío = integración deshabilitada). */
export function getIntegrationApiKeys(): string[] {
  return parseIntegrationApiKeys(process.env.INTEGRATION_API_KEYS);
}

/**
 * Valida el Bearer contra INTEGRATION_API_KEYS (comparación timing-safe).
 * Recorre todas las keys sin cortocircuito para no filtrar cuál existe.
 */
export function isValidIntegrationApiKey(token: string | null | undefined): boolean {
  if (!token) return false;
  const keys = getIntegrationApiKeys();
  if (keys.length === 0) return false;

  let matched = false;
  for (const key of keys) {
    if (safeEqual(token, key)) {
      matched = true;
    }
  }
  return matched;
}

/** Genera una key aleatoria (útil para rotación / setup). */
export function generateIntegrationApiKey(): string {
  return randomBytes(32).toString('base64url');
}
