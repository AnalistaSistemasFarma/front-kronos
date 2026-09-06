/**
 * Llaves de la API del AGENTE — parte PURA (sin base de datos).
 *
 * Aquí solo hay criptografía y validación de configuración, sin dependencias
 * de Prisma ni de red, para poder probarlo de verdad con vitest (mismo
 * criterio que lib/proveedor/isolation.ts: la lógica de seguridad crítica se
 * aísla para que sea testeable). La resolución contra la tabla `agent` vive en
 * lib/chat/agent-auth.ts.
 *
 * Reutiliza el ESQUEMA de mcp/src/auth.ts y mcp/src/config.ts: Bearer, digest
 * SHA-256 + timingSafeEqual, llaves en una variable de entorno con JSON — nunca
 * versionadas.
 *
 * Configuración (en el .env del servidor, NO en el repo):
 *
 *   CHAT_AGENT_API_KEYS=[{"key":"<>=32 chars>","agent":"horus","label":"orus-test"}]
 *
 * o CHAT_AGENT_API_KEYS_FILE=<ruta a un JSON con ese mismo arreglo>.
 * `agent` es el `code` de la tabla `agent` ('horus'), no el display_name.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Una llave configurada. `agent` es el `code` del agente en la tabla `agent`. */
export interface ChatAgentKeyEntry {
  key: string;
  agent: string;
  /** Etiqueta informativa para logs. NUNCA se registra la llave. */
  label?: string;
}

/**
 * Longitud mínima de una llave. Más exigente que el MCP (16) porque estas
 * llaves viven en máquinas de bots y no rotan solas.
 */
export const MIN_AGENT_KEY_LENGTH = 32;

/**
 * Compara dos secretos en tiempo constante. Ambos se reducen antes a un digest
 * de tamaño fijo para que la diferencia de longitud no filtre información
 * (mismo truco que mcp/src/auth.ts).
 */
export function safeEqualSecret(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

/** Extrae el token de un header `Authorization: Bearer <token>`. */
export function extractBearer(authorizationHeader: string | null | undefined): string | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!match || !match[1]) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

/**
 * Valida el JSON de configuración de llaves. Lanza con un mensaje claro si algo
 * está mal: es preferible fallar ruidosamente a quedar con una configuración a
 * medias que "casi" funciona.
 */
export function parseAgentKeys(raw: string): ChatAgentKeyEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`CHAT_AGENT_API_KEYS no es JSON válido: ${(err as Error).message}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('CHAT_AGENT_API_KEYS debe ser un arreglo con al menos una llave.');
  }

  const entries: ChatAgentKeyEntry[] = [];
  const seen = new Set<string>();

  for (const item of parsed) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error('Cada entrada de CHAT_AGENT_API_KEYS debe ser un objeto.');
    }
    const { key, agent, label } = item as Record<string, unknown>;

    if (typeof key !== 'string' || key.length < MIN_AGENT_KEY_LENGTH) {
      throw new Error(
        `Cada llave de CHAT_AGENT_API_KEYS debe tener al menos ${MIN_AGENT_KEY_LENGTH} caracteres.`
      );
    }
    if (typeof agent !== 'string' || agent.trim().length === 0) {
      throw new Error('Cada entrada de CHAT_AGENT_API_KEYS debe indicar el "agent" (code del agente).');
    }
    if (label !== undefined && typeof label !== 'string') {
      throw new Error('El "label" de una llave, si viene, debe ser texto.');
    }
    // Llaves duplicadas = dos identidades para el mismo secreto. Se rechaza.
    if (seen.has(key)) {
      throw new Error('Hay llaves duplicadas en CHAT_AGENT_API_KEYS.');
    }
    seen.add(key);

    const agentCode = agent.trim();
    entries.push({ key, agent: agentCode, label: (label ?? '').trim() || agentCode });
  }

  return entries;
}

/**
 * Resuelve la entrada de llave a partir del token presentado.
 *
 * Recorre TODAS las llaves sin cortocircuito: salir en la primera coincidencia
 * haría que el tiempo de respuesta delatara la posición de la llave en la
 * lista. Devuelve null si no hay coincidencia.
 */
export function matchAgentKey(
  token: string | null,
  keys: ChatAgentKeyEntry[]
): ChatAgentKeyEntry | null {
  if (!token) return null;
  let matched: ChatAgentKeyEntry | null = null;
  for (const entry of keys) {
    if (safeEqualSecret(token, entry.key)) {
      matched = entry;
    }
  }
  return matched;
}

/** Caché del parseo: el JSON de llaves no cambia sin reiniciar el proceso. */
let cachedKeys: ChatAgentKeyEntry[] | null = null;
let cachedFromRaw: string | null = null;

function readRawKeys(env: NodeJS.ProcessEnv): string | null {
  const inline = env.CHAT_AGENT_API_KEYS;
  if (inline && inline.trim().length > 0) return inline;

  const file = env.CHAT_AGENT_API_KEYS_FILE;
  if (file && file.trim().length > 0) {
    try {
      return readFileSync(file.trim(), 'utf8');
    } catch (err) {
      console.error(
        '[chat/agent-keys] no se pudo leer CHAT_AGENT_API_KEYS_FILE:',
        (err as Error).message
      );
      return null;
    }
  }
  return null;
}

/**
 * Devuelve las llaves configuradas, o un arreglo VACÍO si no hay configuración
 * válida.
 *
 * CERRADO POR DEFECTO: sin llaves, `matchAgentKey` no puede casar nada y toda
 * la API del agente responde 401. Nunca "sin llaves configuradas = pasa
 * cualquiera".
 */
export function loadAgentKeys(env: NodeJS.ProcessEnv = process.env): ChatAgentKeyEntry[] {
  const raw = readRawKeys(env);
  if (!raw) return [];
  if (cachedKeys && cachedFromRaw === raw) return cachedKeys;

  try {
    cachedKeys = parseAgentKeys(raw);
    cachedFromRaw = raw;
    return cachedKeys;
  } catch (err) {
    // Se registra el motivo (nunca la llave) y se falla cerrado.
    console.error('[chat/agent-keys] configuración de llaves inválida:', (err as Error).message);
    cachedKeys = [];
    cachedFromRaw = raw;
    return cachedKeys;
  }
}

/** Solo para pruebas: descarta la caché del parseo. */
export function __resetAgentKeysCache(): void {
  cachedKeys = null;
  cachedFromRaw = null;
}
