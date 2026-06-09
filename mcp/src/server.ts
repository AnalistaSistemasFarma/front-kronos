/**
 * Servidor MCP HTTP de SOLO LECTURA para front-kronos (SynerLink).
 *
 * - Transporte: Streamable HTTP en la ruta /mcp (patrón del MCP de SAP).
 * - Autenticación: API key por agente (Bearer). Sin login humano.
 * - Alcance: cada key se filtra SIEMPRE por sus empresas permitidas.
 * - Solo lectura: no se registra ninguna tool de escritura.
 */
import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadConfig } from './config.js';
import { extractBearer, resolveScope, type AuthScope } from './auth.js';
import { createFileAuditLogger, type AuditLogger } from './audit.js';
import { registerTools } from './tools/index.js';

/** Construye una instancia de McpServer ya configurada para un alcance. */
export function buildMcpServer(
  scope: AuthScope,
  audit: AuditLogger,
  opts: { maxPageSize: number; defaultPageSize: number }
): McpServer {
  const server = new McpServer(
    { name: 'kronos-mcp', version: '1.0.0' },
    {
      instructions:
        'Servidor de SOLO LECTURA de SynerLink/Kronos. Todas las consultas están limitadas a las empresas del alcance de la API key. No hay herramientas de escritura.',
    }
  );
  registerTools(server, { scope, audit, ...opts });
  return server;
}

export function createApp(
  config = loadConfig(),
  audit: AuditLogger = createFileAuditLogger(config.auditLogFile)
) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Healthcheck SIN auth (no expone datos).
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', readOnly: true });
  });

  // Endpoint MCP. En modo stateless: una transport+server por petición.
  const handleMcp = async (req: Request, res: Response) => {
    const token = extractBearer(req.header('authorization'));
    const scope = resolveScope(token, config.apiKeys);

    if (!scope) {
      // 401 sin pistas sobre por qué (token ausente vs inválido).
      void audit.log({
        ts: new Date().toISOString(),
        agent: 'unknown',
        role: 'none',
        companyIds: [],
        tool: '(auth)',
        params: {},
        outcome: 'denied',
        error: 'unauthorized',
      });
      res
        .status(401)
        .json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
      return;
    }

    const server = buildMcpServer(scope, audit, {
      maxPageSize: config.maxPageSize,
      defaultPageSize: config.defaultPageSize,
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[mcp] error manejando petición:', (err as Error).message);
      if (!res.headersSent) {
        res
          .status(500)
          .json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
      }
    }
  };

  app.post('/mcp', handleMcp);
  // GET/DELETE en /mcp también requieren auth (el transporte los usa para SSE/cierre).
  app.get('/mcp', handleMcp);
  app.delete('/mcp', handleMcp);

  return app;
}

// Arranque directo (no en tests).
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const config = loadConfig();
  const app = createApp(config);
  app.listen(config.port, () => {
    console.log(
      `[kronos-mcp] escuchando en http://0.0.0.0:${config.port}/mcp (solo lectura, ${config.apiKeys.length} agente(s) configurado(s))`
    );
  });
}
