/**
 * Auditoría de llamadas. Registra agente, tool, parámetros y timestamp.
 *
 * El modelo UserAuditLog del repo exige un user_id (FK a `user`), por lo que no
 * encaja para agentes de IA que no son usuarios humanos. Por eso la auditoría
 * del MCP se escribe a un archivo de log dedicado (append-only, una línea JSON
 * por evento). NUNCA se registra la API key en claro.
 */
import { appendFile } from 'node:fs/promises';

export interface AuditEvent {
  ts: string;
  agent: string;
  role: string;
  companyIds: number[];
  tool: string;
  params: unknown;
  outcome: 'ok' | 'error' | 'denied';
  rows?: number;
  error?: string;
}

export interface AuditLogger {
  log(event: AuditEvent): Promise<void>;
}

/** Quita cualquier campo que pudiera parecer un secreto antes de persistir. */
function sanitizeParams(params: unknown): unknown {
  if (params === null || typeof params !== 'object') return params;
  const SENSITIVE = /(key|token|secret|password|authorization|bearer)/i;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    out[k] = SENSITIVE.test(k) ? '[redacted]' : v;
  }
  return out;
}

export function createFileAuditLogger(filePath: string): AuditLogger {
  return {
    async log(event: AuditEvent): Promise<void> {
      const line =
        JSON.stringify({ ...event, params: sanitizeParams(event.params) }) + '\n';
      try {
        await appendFile(filePath, line, 'utf8');
      } catch (err) {
        // La auditoría no debe tumbar la respuesta; se reporta a stderr.
        console.error('[audit] no se pudo escribir el log:', (err as Error).message);
      }
    },
  };
}
