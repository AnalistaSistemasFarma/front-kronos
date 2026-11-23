/**
 * Autenticación por API key (Bearer token) con comparación timing-safe.
 *
 * No hay login de usuario humano: cada agente de IA presenta su propia key.
 * La key se mapea a un alcance (empresas permitidas + rol). El alcance manda
 * sobre cualquier parámetro que el cliente envíe en las tools.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { ApiKeyEntry, UsuariosConfig } from './config.js';
import type { DbApiKeyEntry } from './dbKeys.js';

/** Rol de las llaves de la base: sin privilegio de administración (p. ej. kronos_delete_attachment exige "admin"). */
export const DB_KEY_ROLE = 'reader';

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
  /**
   * Lista blanca de herramientas de la key. `undefined` = sin restricción
   * (keys históricas). Si está definida, solo se registran esas herramientas.
   */
  allowedTools?: string[];
  /** Código del agente (agent.code) que presenta la key, si aplica. */
  agentCode?: string;
  /** Permiso de administración de usuarios (solo llaves que lo definen). */
  usuarios?: UsuariosConfig;
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
  return scopeFromFileEntry(matched);
}

function scopeFromFileEntry(matched: ApiKeyEntry): AuthScope {
  const allCompanies = matched.companyIds === '*';
  return {
    agent: matched.agent,
    role: matched.role,
    allCompanies,
    companyIds: allCompanies ? [] : [...(matched.companyIds as number[])],
    ...(matched.allowedTools ? { allowedTools: [...matched.allowedTools] } : {}),
    ...(matched.agentCode ? { agentCode: matched.agentCode } : {}),
    ...(matched.usuarios ? { usuarios: structuredClone(matched.usuarios) } : {}),
  };
}

/** Compara dos hash SHA-256 hex en tiempo constante (falso si alguno no es un hash válido). */
function safeEqualHash(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(a) || !/^[0-9a-f]{64}$/i.test(b)) return false;
  return timingSafeEqual(Buffer.from(a.toLowerCase(), 'hex'), Buffer.from(b.toLowerCase(), 'hex'));
}

/**
 * Herramientas que actúan «en nombre de» un agente (kronos_request_ia_access, correo_* y
 * proyecto*_): sin agentCode, correo/proyectos tomarían el NOMBRE del cliente como código de
 * agente (codigoAgente en src/correo/concesion.ts y src/proyectos/nucleo.ts). En una llave de
 * la base sin código se descartan aunque estén marcadas (SynerLink ya lo valida al guardar).
 */
export function toolRequiresAgentCode(name: string): boolean {
  return name === 'kronos_request_ia_access' || /^correo_/.test(name) || /^proyectos?_/.test(name);
}

/** Alcance de una llave de la base (Permisos API). */
export function scopeFromDbEntry(entry: DbApiKeyEntry): AuthScope {
  return {
    agent: entry.name,
    role: DB_KEY_ROLE,
    allCompanies: entry.allCompanies,
    companyIds: entry.allCompanies ? [] : [...entry.companyIds],
    // SIEMPRE lista blanca (aunque esté vacía): una llave de la base nunca es «sin restricción».
    allowedTools: entry.agentCode
      ? [...entry.allowedTools]
      : entry.allowedTools.filter((t) => !toolRequiresAgentCode(t)),
    ...(entry.agentCode ? { agentCode: entry.agentCode } : {}),
  };
}

export interface ResolvedScope {
  scope: AuthScope;
  /** Id de la llave en la base (para marcar el último uso); ausente si vino del archivo. */
  dbKeyId?: number;
}

/**
 * Resuelve el alcance mirando las llaves de la BASE y las del ARCHIVO. Recorre
 * SIEMPRE las dos listas completas (sin cortocircuito) para no filtrar por
 * tiempo dónde está la llave. Si la misma llave estuviera en ambas, gana la de
 * la base.
 */
export function resolveScopeCombined(
  token: string | null,
  fileKeys: ApiKeyEntry[],
  dbEntries: readonly DbApiKeyEntry[]
): ResolvedScope | null {
  if (!token) return null;

  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
  let dbMatch: DbApiKeyEntry | null = null;
  for (const entry of dbEntries) {
    if (safeEqualHash(tokenHash, entry.keyHash)) dbMatch = entry;
  }
  const fileScope = resolveScope(token, fileKeys);

  if (dbMatch) return { scope: scopeFromDbEntry(dbMatch), dbKeyId: dbMatch.keyId };
  if (fileScope) return { scope: fileScope };
  return null;
}
