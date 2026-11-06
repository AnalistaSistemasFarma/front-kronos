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

/** Nombres de las dos herramientas de usuarios (src/tools/usuarios.ts). */
export const USUARIOS_TOOL_NAMES = ['kronos_usuarios_consultar', 'kronos_usuarios_crear'] as const;

/**
 * Permiso de administración de usuarios de SynerLink para UNA llave (2026-10-22,
 * solicitud #6283). Sin este bloque las herramientas kronos_usuarios_* no se
 * registran para la llave, aunque las liste en allowedTools.
 */
export const usuariosConfigSchema = z
  .object({
    /** Correos de las personas que pueden ordenarle al agente crear usuarios (p. ej. su dueño). */
    solicitantes: z.array(z.string().email().max(255)).min(1),
    /** Empresas donde el agente puede crear y consultar usuarios (lista blanca). */
    companyIds: z.array(z.number().int().positive()).min(1),
    /** Departamentos que puede asignar (lista blanca; vacío = ninguno). */
    departmentIds: z.array(z.number().int().positive()).default([]),
    /** Subprocesos (permisos) que puede asignar (lista blanca; vacío = ninguno). */
    subprocessIds: z.array(z.number().int().positive()).default([]),
    /** Dominios de correo aceptados para usuarios nuevos (sin @), p. ej. "gsslatam.com". */
    dominios: z.array(z.string().min(3).max(120).regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i)).min(1),
    /** Tope de creaciones por hora para esta llave. */
    maxPorHora: z.number().int().min(1).max(20).default(3),
    /** Tope de creaciones por día (24 h móviles) para esta llave. */
    maxPorDia: z.number().int().min(1).max(100).default(10),
    /** Exigir que el correo exista en Entra, habilitado y con licencia (MS Graph). */
    exigirEntra: z.boolean().default(true),
  })
  .strict();

export type UsuariosConfig = z.infer<typeof usuariosConfigSchema>;

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
  /**
   * Lista blanca de herramientas (opcional). Si se define, el servidor SOLO
   * registra estas herramientas para la key: las demás ni se listan ni se
   * pueden llamar (tampoco por HTTP directo). Sin el campo, la key ve todas
   * (comportamiento histórico: horus, nancy, test-local).
   */
  allowedTools: z.array(z.string().min(1)).min(1).optional(),
  /**
   * Código del agente (tabla `agent.code`, p. ej. "galileo", "lisa") que
   * presenta esta key. Lo usan las herramientas que actúan "en nombre de" un
   * agente (kronos_request_ia_access). Nunca se toma del cliente.
   */
  agentCode: z.string().min(1).max(60).optional(),
  /**
   * Administración de usuarios de SynerLink (kronos_usuarios_consultar / _crear).
   * Solo para llaves RESTRINGIDAS (con allowedTools) y con agentCode.
   */
  usuarios: usuariosConfigSchema.optional(),
}).superRefine((entry, ctx) => {
  const pideUsuarios = (entry.allowedTools ?? []).some((t) =>
    (USUARIOS_TOOL_NAMES as readonly string[]).includes(t)
  );
  if (pideUsuarios && !entry.usuarios) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `La key del agente "${entry.agent}" lista herramientas kronos_usuarios_* pero no define el bloque "usuarios".`,
    });
  }
  if (entry.usuarios && (!entry.allowedTools || !entry.agentCode)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `La key del agente "${entry.agent}" define "usuarios": exige allowedTools (llave restringida) y agentCode.`,
    });
  }
  if (entry.allowedTools?.includes('kronos_request_ia_access') && !entry.agentCode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `La key del agente "${entry.agent}" permite kronos_request_ia_access pero no define agentCode.`,
    });
  }
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
