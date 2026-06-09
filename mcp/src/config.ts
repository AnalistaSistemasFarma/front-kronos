/**
 * Carga y validación de configuración del servidor MCP de Kronos.
 *
 * Las API keys y su alcance NO se versionan: se leen de la variable de entorno
 * MCP_API_KEYS (JSON) o, alternativamente, de un archivo apuntado por
 * MCP_API_KEYS_FILE. Cada key se mapea a un agente, una lista de empresas
 * permitidas (companyIds) y un rol de solo lectura.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const apiKeySchema = z.object({
  /** Token secreto que el agente envía como `Authorization: Bearer <key>`. */
  key: z.string().min(16, 'Cada API key debe tener al menos 16 caracteres'),
  /** Nombre del agente, usado solo para auditoría (nunca se registra la key). */
  agent: z.string().min(1),
  /**
   * Alcance de empresas que esta key puede consultar.
   * - `"*"` (comodín): TODAS las empresas. Reservado a agentes admin; no
   *   aplica filtro de empresa en las consultas (ve todo).
   * - arreglo no vacío de enteros positivos: lista cerrada de empresas. El
   *   filtro de empresa es OBLIGATORIO y nunca se puede ampliar desde el cliente.
   */
  companyIds: z.union([
    z.literal('*'),
    z.array(z.number().int().positive()).min(1),
  ]),
  /** Rol/nivel informativo: "admin" o "reader". En esta versión todo es solo lectura. */
  role: z.string().default('reader'),
});

export type ApiKeyEntry = z.infer<typeof apiKeySchema>;

const apiKeysSchema = z.array(apiKeySchema).min(1, 'Debe definir al menos una API key');

export interface McpConfig {
  port: number;
  apiKeys: ApiKeyEntry[];
  /** Tope máximo de filas devuelto por cualquier consulta paginada. */
  maxPageSize: number;
  defaultPageSize: number;
  /** Ruta del archivo de auditoría de respaldo (si no se usa UserAuditLog). */
  auditLogFile: string;
}

function loadApiKeysRaw(env: NodeJS.ProcessEnv): unknown {
  const inline = env.MCP_API_KEYS;
  const file = env.MCP_API_KEYS_FILE;

  let rawJson: string | undefined;
  if (inline && inline.trim().length > 0) {
    rawJson = inline;
  } else if (file && file.trim().length > 0) {
    rawJson = readFileSync(file, 'utf8');
  } else {
    throw new Error(
      'Falta configuración de API keys: defina MCP_API_KEYS (JSON inline) o MCP_API_KEYS_FILE (ruta a archivo JSON).'
    );
  }

  try {
    return JSON.parse(rawJson);
  } catch (err) {
    throw new Error(`MCP_API_KEYS no es JSON válido: ${(err as Error).message}`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const apiKeys = apiKeysSchema.parse(loadApiKeysRaw(env));

  // Defensa: no permitir keys duplicadas (colisión de alcance).
  const seen = new Set<string>();
  for (const k of apiKeys) {
    if (seen.has(k.key)) {
      throw new Error('Hay API keys duplicadas en MCP_API_KEYS.');
    }
    seen.add(k.key);
  }

  const port = Number.parseInt(env.MCP_PORT ?? '3020', 10);
  const maxPageSize = Number.parseInt(env.MCP_MAX_PAGE_SIZE ?? '200', 10);
  const defaultPageSize = Number.parseInt(env.MCP_DEFAULT_PAGE_SIZE ?? '50', 10);

  return {
    port: Number.isFinite(port) ? port : 3020,
    apiKeys,
    maxPageSize: Number.isFinite(maxPageSize) ? maxPageSize : 200,
    defaultPageSize: Number.isFinite(defaultPageSize) ? defaultPageSize : 50,
    auditLogFile: env.MCP_AUDIT_LOG_FILE ?? 'kronos-mcp-audit.log',
  };
}
