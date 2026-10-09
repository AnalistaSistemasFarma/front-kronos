/**
 * Servidor MCP HTTP para front-kronos (SynerLink).
 *
 * - Transporte: Streamable HTTP en la ruta /mcp (patrón del MCP de SAP).
 * - Autenticación: API key por agente (Bearer). Sin login humano.
 * - Alcance: cada key se filtra SIEMPRE por sus empresas permitidas.
 * - 24 tools: 19 de LECTURA (candado assertReadOnlySql intacto) + 5 de
 *   ESCRITURA acotadas a categorización, por una ruta de escritura separada
 *   (src/write.ts), transaccional, parametrizada y auditada.
 */
import express, { type Request, type Response } from 'express';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadConfig } from './config.js';
import { extractBearer, resolveScope, type AuthScope } from './auth.js';
import { createFileAuditLogger, type AuditLogger } from './audit.js';
import { registerTools, TOOL_CAPABILITIES } from './tools/index.js';

/** Nombres de todas las herramientas que el servidor sabe registrar. */
export const KNOWN_TOOLS: ReadonlySet<string> = new Set([
  ...TOOL_CAPABILITIES.readOnly,
  ...TOOL_CAPABILITIES.write,
]);

/**
 * Nombres de herramientas que una petición JSON-RPC intenta llamar
 * (tools/call), soportando lotes. Sirve para rechazar en HTTP, antes de llegar
 * al SDK, cualquier llamada fuera de la lista blanca de la key.
 */
export function calledToolNames(body: unknown): string[] {
  const msgs = Array.isArray(body) ? body : [body];
  const names: string[] = [];
  for (const m of msgs) {
    if (m && typeof m === 'object' && (m as { method?: unknown }).method === 'tools/call') {
      const name = (m as { params?: { name?: unknown } }).params?.name;
      names.push(typeof name === 'string' ? name : '');
    }
  }
  return names;
}

/** Construye una instancia de McpServer ya configurada para un alcance. */
export function buildMcpServer(
  scope: AuthScope,
  audit: AuditLogger,
  opts: { maxPageSize: number; defaultPageSize: number }
): McpServer {
  const restricted = Array.isArray(scope.allowedTools);
  const server = new McpServer(
    { name: 'kronos-mcp', version: '1.0.0' },
    {
      instructions: restricted
        ? `Servidor de SynerLink/Kronos con acceso RESTRINGIDO para el agente ${scope.agent}. Solo dispone de: ${scope.allowedTools!.join(', ')}.`
        : 'Servidor de SynerLink/Kronos. Las consultas SQL siguen limitadas a las empresas del alcance de la API key. Incluye herramientas de lectura de reuniones/transcripciones de Teams mediante Microsoft Graph; estas usan el usuario Graph configurado en el servidor y requieren permisos de aplicación con consentimiento de administrador.',
    }
  );
  registerTools(server, { scope, audit, ...opts });
  return server;
}

export function createApp(
  config = loadConfig(),
  audit: AuditLogger = createFileAuditLogger(config.auditLogFile)
) {
  // Una lista blanca con nombres desconocidos es un error de configuración:
  // mejor no arrancar que dejar una key con herramientas que no existen.
  for (const k of config.apiKeys) {
    for (const t of k.allowedTools ?? []) {
      if (!KNOWN_TOOLS.has(t)) {
        throw new Error(`La key del agente "${k.agent}" lista una herramienta desconocida en allowedTools: ${t}`);
      }
    }
  }

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Healthcheck SIN auth (no expone datos).
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', readOnly: false, writeTools: ['kronos_categorize_case', 'kronos_categorize_request'] });
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

    // Lista blanca: además de no registrar las demás herramientas, se rechaza
    // en HTTP cualquier tools/call fuera de la lista (defensa en profundidad).
    if (scope.allowedTools) {
      const allowed = new Set(scope.allowedTools);
      const denied = calledToolNames(req.body).filter((n) => !allowed.has(n));
      if (denied.length > 0) {
        void audit.log({
          ts: new Date().toISOString(),
          agent: scope.agent,
          role: scope.role,
          companyIds: scope.companyIds,
          tool: denied.join(','),
          params: {},
          outcome: 'denied',
          error: 'tool fuera de la lista blanca de la key',
        });
        const id = !Array.isArray(req.body) && req.body && typeof req.body === 'object' ? (req.body as { id?: unknown }).id ?? null : null;
        res.status(403).json({
          jsonrpc: '2.0',
          error: { code: -32601, message: 'Herramienta no permitida para esta key' },
          id,
        });
        return;
      }
    }

    const server = buildMcpServer(scope, audit, {
      maxPageSize: config.maxPageSize,
      defaultPageSize: config.defaultPageSize,
    });
    // Stateless REAL: sessionIdGenerator undefined => el transporte NO exige el
    // handshake `initialize` previo en cada petición (cada request usa un
    // transport+server propio y autocontenido). Con un generador definido, el
    // SDK marcaba "Server not initialized" en todo tools/* porque el transport
    // fresco de esa petición nunca veía el initialize.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
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
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const config = loadConfig();
  const app = createApp(config);
  app.listen(config.port, () => {
    console.log(
      `[kronos-mcp] escuchando en http://0.0.0.0:${config.port}/mcp (11 lectura + 2 escritura/categorización, ${config.apiKeys.length} agente(s) configurado(s))`
    );
  });
}
