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
  /** SQL capturado por la vía de ESCRITURA (executeRaw dentro de transacción). */
  capturedWrite: CapturedRawQuery[];
  // Datos simulados por modelo.
  rawRows: Record<string, unknown[]>;
  /**
   * Resolutores opcionales para $queryRaw que dependen del SQL (p.ej. validar
   * existencia/coherencia en las tools de escritura). Si una función devuelve
   * `undefined`, se cae al comportamiento por defecto (lookup por FROM).
   */
  rawResolvers?: ((q: CapturedRawQuery) => unknown[] | undefined)[];
  /** Filas afectadas que devuelve cada $executeRaw, en orden de llamada. */
  executeRawResults?: number[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $queryRaw: (...args: any[]) => Promise<unknown[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $executeRaw: (...args: any[]) => Promise<number>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $transaction: (fn: (tx: any) => Promise<unknown>) => Promise<unknown>;
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
  function capture(strings: unknown, rest: unknown[]): CapturedRawQuery {
    if (isSqlLike(strings)) return unwrapSql(strings);
    return { text: String(strings), values: rest };
  }

  function resolveQuery(captured: CapturedRawQuery): unknown[] {
    // Resolutores explícitos (para escenarios de escritura) primero.
    for (const r of mock.rawResolvers ?? []) {
      const out = r(captured);
      if (out !== undefined) return out;
    }
    const t = captured.text.toLowerCase();
    if (t.includes('from requests_general')) return mock.rawRows.requests_general ?? [];
    if (t.includes('from notes')) return mock.rawRows.notes ?? [];
    if (t.includes('from [case]') || t.includes('from case')) return mock.rawRows.case ?? [];
    return [];
  }

  const mock: MockPrisma = {
    capturedRaw: [],
    capturedWrite: [],
    rawRows: {
      requests_general: [],
      case: [],
      notes: [],
      ...seed,
    },
    async $queryRaw(strings: unknown, ...rest: unknown[]) {
      // Prisma.sql`...` se pasa como un único objeto Prisma.Sql cuando se invoca
      // como prisma.$queryRaw(Prisma.sql`...`).
      const captured = capture(strings, rest);
      mock.capturedRaw.push(captured);
      return resolveQuery(captured);
    },
    async $executeRaw(strings: unknown, ...rest: unknown[]) {
      const captured = capture(strings, rest);
      mock.capturedWrite.push(captured);
      const seq = mock.executeRawResults ?? [];
      const idx = mock.capturedWrite.length - 1;
      return idx < seq.length ? seq[idx] : 1;
    },
    async $transaction(fn: (tx: unknown) => Promise<unknown>) {
      // El tx expone los mismos $queryRaw/$executeRaw del mock (misma captura).
      const tx = { $queryRaw: mock.$queryRaw, $executeRaw: mock.$executeRaw };
      return fn(tx);
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
