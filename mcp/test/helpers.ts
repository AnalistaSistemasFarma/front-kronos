/**
 * Utilidades de prueba: mock de Prisma y un cliente MCP en memoria.
 *
 * El mock de Prisma simula tanto $queryRaw (para requests_general / case) como
 * los métodos de modelo (user, process, etc.). Captura el SQL parametrizado
 * que generan las tools para poder verificar el enforcement de empresa.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface CapturedRawQuery {
  /** SQL final con los placeholders. */
  text: string;
  /** Valores parametrizados (lo que Prisma enviaría como parámetros). */
  values: unknown[];
}

export interface MockPrisma {
  capturedRaw: CapturedRawQuery[];
  // Datos simulados por modelo.
  rawRows: Record<string, unknown[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $queryRaw: (...args: any[]) => Promise<unknown[]>;
  user: { findMany: (args: unknown) => Promise<unknown[]> };
  process: { findMany: (args: unknown) => Promise<unknown[]> };
  activity: { findMany: (args: unknown) => Promise<unknown[]> };
  department: { findMany: (args: unknown) => Promise<unknown[]> };
  category: { findMany: (args: unknown) => Promise<unknown[]> };
  // captura del where pasado a user.findMany
  lastUserWhere?: unknown;
}

/**
 * Convierte un Prisma.Sql en {text, values}. Reconstruimos el texto sustituyendo
 * cada parámetro por su representación para poder hacer aserciones de seguridad
 * (p.ej. que un texto de inyección viajó como VALOR, no como SQL crudo).
 */
interface SqlLike {
  sql: string;
  values: unknown[];
}

/** El cliente generado no exporta la clase Prisma.Sql, así que detectamos por forma. */
function isSqlLike(x: unknown): x is SqlLike {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as { sql?: unknown }).sql === 'string' &&
    Array.isArray((x as { values?: unknown }).values)
  );
}

function unwrapSql(sql: SqlLike): CapturedRawQuery {
  return { text: sql.sql, values: sql.values };
}

export function createMockPrisma(seed: Partial<MockPrisma['rawRows']> = {}): MockPrisma {
  const mock: MockPrisma = {
    capturedRaw: [],
    rawRows: {
      requests_general: [],
      case: [],
      notes: [],
      ...seed,
    },
    async $queryRaw(strings: unknown, ...rest: unknown[]) {
      // Prisma.sql`...` se pasa como un único objeto Prisma.Sql cuando se invoca
      // como prisma.$queryRaw(Prisma.sql`...`).
      let captured: CapturedRawQuery;
      if (isSqlLike(strings)) {
        captured = unwrapSql(strings);
      } else {
        captured = { text: String(strings), values: rest };
      }
      mock.capturedRaw.push(captured);

      const t = captured.text.toLowerCase();
      if (t.includes('from requests_general')) return mock.rawRows.requests_general ?? [];
      if (t.includes('from notes')) return mock.rawRows.notes ?? [];
      if (t.includes('from [case]') || t.includes('from case')) return mock.rawRows.case ?? [];
      return [];
    },
    user: {
      async findMany(args: unknown) {
        mock.lastUserWhere = (args as { where?: unknown }).where;
        return (mock.rawRows.user as unknown[]) ?? [];
      },
    },
    process: { async findMany() { return (mock.rawRows.process as unknown[]) ?? []; } },
    activity: { async findMany() { return (mock.rawRows.activity as unknown[]) ?? []; } },
    department: { async findMany() { return (mock.rawRows.department as unknown[]) ?? []; } },
    category: { async findMany() { return (mock.rawRows.category as unknown[]) ?? []; } },
  };
  return mock;
}

/** Conecta un Client MCP a un McpServer ya armado, vía transporte en memoria. */
export async function connectClient(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

/** Llama una tool y devuelve el JSON parseado del primer bloque de texto. */
export async function callJson(
  client: Client,
  name: string,
  args: Record<string, unknown> = {}
): Promise<{ raw: unknown; data: unknown; isError?: boolean }> {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  const text = res.content?.[0]?.text ?? 'null';
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { raw: res, data, isError: res.isError };
}
