/**
 * Autenticación por API key (Bearer token) con comparación timing-safe.
 *
 * No hay login de usuario humano: cada agente de IA presenta su propia key.
 * La key se mapea a un alcance (empresas permitidas + rol). El alcance manda
 * sobre cualquier parámetro que el cliente envíe en las tools.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { ApiKeyEntry } from './config.js';

export interface AuthScope {
  agent: string;
  role: string;
  /**
   * `true` para keys admin con alcance comodín `"*"`: ven TODAS las empresas y
   * no se les aplica filtro de empresa. En ese caso `companyIds` queda vacío.
   */
  allCompanies: boolean;
  /**
   * Empresas que la key puede consultar cuando NO es admin. Filtro obligatorio
   * en toda query. Vacío cuando `allCompanies` es `true`.
   */
  companyIds: number[];
}

/**
 * Compara dos secretos en tiempo constante. Para evitar que diferencias de
 * longitud filtren información, ambos se reducen a un digest de tamaño fijo
 * antes de comparar.
 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

/** Extrae el token de un header `Authorization: Bearer <token>`. */
export function extractBearer(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!match || !match[1]) return null;
  return match[1].trim();
}

/**
 * Resuelve el alcance a partir del token presentado. Recorre TODAS las keys
 * configuradas (sin cortocircuito) para no filtrar por tiempo cuál key existe.
 * Devuelve null si no hay coincidencia.
 */
export function resolveScope(token: string | null, apiKeys: ApiKeyEntry[]): AuthScope | null {
  if (!token) return null;

  let matched: ApiKeyEntry | null = null;
  for (const entry of apiKeys) {
    if (safeEqual(token, entry.key)) {
      matched = entry;
    }
  }

  if (!matched) return null;

  const allCompanies = matched.companyIds === '*';
  return {
    agent: matched.agent,
    role: matched.role,
    allCompanies,
    companyIds: allCompanies ? [] : [...(matched.companyIds as number[])],
  };
}
