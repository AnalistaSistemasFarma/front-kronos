/**
 * Pruebas de las DOS tools de ESCRITURA (categorización):
 *   - kronos_categorize_case          (tabla puente category_case)
 *   - kronos_categorize_request       (tabla puente process_category_request_general)
 *
 * Cubre: camino feliz (UPDATE y UPSERT/INSERT), alcance de empresa, coherencia
 * de la terna, proceso inactivo/no habilitado. Y confirma que el candado de
 * solo lectura NO se debilitó: el SQL de escritura va por executeWrite
 * ($executeRaw), nunca por queryReadOnly, y queryReadOnly sigue rechazando
 * mutaciones.
 *
 * Prisma está mockeado (helpers.ts) — no requiere DB real.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { registerTools } from '../src/tools/index.js';
import { setPrisma } from '../src/db.js';
import type { AuthScope } from '../src/auth.js';
import {
  createMockPrisma,
  connectClient,
  callJson,
  type MockPrisma,
  type CapturedRawQuery,
} from './helpers.js';

const noopAudit = { log: async () => {} };

const scopeA: AuthScope = { agent: 'horus', role: 'reader', allCompanies: false, companyIds: [1] };
const scopeAdmin: AuthScope = { agent: 'admin', role: 'admin', allCompanies: true, companyIds: [] };

let mock: MockPrisma;

function buildServer(scope: AuthScope = scopeA): McpServer {
  const server = new McpServer({ name: 'test', version: '1.0.0' });
  registerTools(server, { scope, audit: noopAudit, maxPageSize: 200, defaultPageSize: 50 });
  return server;
}

beforeEach(() => {
  mock = createMockPrisma();
  // @ts-expect-error mock parcial compatible para pruebas
  setPrisma(mock);
});

/** Resolutor de validación que reconoce las SELECT de las tools de escritura. */
function resolver(rules: { match: RegExp; rows: unknown[] }[]) {
  return (q: CapturedRawQuery): unknown[] | undefined => {
    const t = q.text.replace(/\s+/g, ' ');
    for (const r of rules) {
      if (r.match.test(t)) return r.rows;
    }
    return undefined;
  };
}

// ============================================================================
// kronos_categorize_case
// ============================================================================
describe('kronos_categorize_case (ESCRITURA)', () => {
  it('camino feliz: caso en alcance + terna coherente -> UPDATE (rowsAffected=1)', async () => {
    mock.rawResolvers = [
      resolver([
        { match: /FROM \[case\] c WHERE/i, rows: [{ ok: 1 }] }, // existe y en alcance
        { match: /FROM activity a INNER JOIN subcategory s/i, rows: [{ ok: 1 }] }, // coherente o nombres
      ]),
    ];
    mock.executeRawResults = [1]; // UPDATE afecta 1 fila (no INSERT)

    const server = buildServer();
    const client: Client = await connectClient(server);
    const { data, isError } = await callJson(client, 'kronos_categorize_case', {
      id_case: 100,
      id_category: 5,
      id_subcategory: 9,
      id_activity: 20,
    });

    expect(isError ?? false).toBe(false);
    const r = data as { action: string; id_case: number; rowsAffected: number };
    expect(r.action).toBe('updated');
    expect(r.id_case).toBe(100);
    expect(r.rowsAffected).toBe(1);

    // El UPDATE fue por la vía de escritura, con valores PARAMETRIZADOS.
    const upd = mock.capturedWrite.find((q) => /UPDATE category_case/i.test(q.text));
    expect(upd).toBeDefined();
    expect(upd!.values).toEqual(expect.arrayContaining([5, 9, 20, 100]));
    expect(upd!.text).not.toContain('100'); // el id viaja como parámetro
    // El SELECT de alcance llevó el filtro de empresa.
    const scopeSel = mock.capturedRaw.find((q) =>
      /FROM \[case\] c WHERE/i.test(q.text.replace(/\s+/g, ' '))
    );
    expect(scopeSel!.text).toContain('c.company IN');
  });

  it('UPSERT: si el UPDATE afecta 0 filas, hace INSERT (action=inserted)', async () => {
    mock.rawResolvers = [
      resolver([
        { match: /FROM \[case\] c WHERE/i, rows: [{ ok: 1 }] },
        { match: /FROM activity a INNER JOIN subcategory s/i, rows: [{ ok: 1 }] },
      ]),
    ];
    mock.executeRawResults = [0]; // UPDATE no afectó nada -> debe INSERTAR

    const server = buildServer();
    const client = await connectClient(server);
    const { data } = await callJson(client, 'kronos_categorize_case', {
      id_case: 200,
      id_category: 1,
      id_subcategory: 2,
      id_activity: 3,
    });
    const r = data as { action: string };
    expect(r.action).toBe('inserted');
    expect(mock.capturedWrite.some((q) => /INSERT INTO category_case/i.test(q.text))).toBe(true);
  });

  it('caso fuera de alcance -> error genérico, NO escribe', async () => {
    mock.rawResolvers = [
      resolver([{ match: /FROM \[case\] c WHERE/i, rows: [] }]), // no en alcance
    ];
    const server = buildServer();
    const client = await connectClient(server);
    const { data, isError } = await callJson(client, 'kronos_categorize_case', {
      id_case: 999,
      id_category: 1,
      id_subcategory: 2,
      id_activity: 3,
    });
    expect(isError).toBe(true);
    expect(JSON.stringify(data)).toMatch(/inexistente o fuera de alcance/i);
    // Ninguna escritura emitida.
    expect(mock.capturedWrite.length).toBe(0);
  });

  it('terna incoherente -> error, NO escribe', async () => {
    mock.rawResolvers = [
      resolver([
        { match: /FROM \[case\] c WHERE/i, rows: [{ ok: 1 }] }, // sí en alcance
        { match: /FROM activity a INNER JOIN subcategory s/i, rows: [] }, // terna NO coherente
      ]),
    ];
    const server = buildServer();
    const client = await connectClient(server);
    const { data, isError } = await callJson(client, 'kronos_categorize_case', {
      id_case: 100,
      id_category: 5,
      id_subcategory: 9,
      id_activity: 21,
    });
    expect(isError).toBe(true);
    expect(JSON.stringify(data)).toMatch(/terna.*inconsistente/i);
    expect(mock.capturedWrite.length).toBe(0);
  });
});

// ============================================================================
// kronos_categorize_request
// ============================================================================
describe('kronos_categorize_request (ESCRITURA)', () => {
  it('camino feliz: solicitud en alcance + proceso activo/habilitado -> UPDATE', async () => {
    mock.rawResolvers = [
      resolver([
        { match: /FROM requests_general rg WHERE/i, rows: [{ id_company: 1 }] },
        { match: /FROM process_category pc INNER JOIN company_category_request/i, rows: [{ ok: 1 }] },
        { match: /FROM process_category pc WHERE pc.id =/i, rows: [{ process_category: 'Pagos' }] },
      ]),
    ];
    mock.executeRawResults = [1, 1]; // UPDATE puente (1) + UPDATE legacy (1)

    const server = buildServer();
    const client = await connectClient(server);
    const { data, isError } = await callJson(client, 'kronos_categorize_request', {
      id_request: 50,
      id_process_category: 7,
    });
    expect(isError ?? false).toBe(false);
    const r = data as { action: string; id_company: number; process: { name: string } };
    expect(r.action).toBe('updated');
    expect(r.id_company).toBe(1);
    expect(r.process.name).toBe('Pagos');

    const upd = mock.capturedWrite.find((q) =>
      /UPDATE process_category_request_general/i.test(q.text)
    );
    expect(upd).toBeDefined();
    expect(upd!.values).toEqual(expect.arrayContaining([7, 50]));
    // Sincronización legacy también emitida.
    expect(mock.capturedWrite.some((q) => /UPDATE requests_general/i.test(q.text))).toBe(true);
    // El SELECT de alcance llevó el filtro de empresa.
    const scopeSel = mock.capturedRaw.find((q) =>
      /FROM requests_general rg WHERE/i.test(q.text.replace(/\s+/g, ' '))
    );
    expect(scopeSel!.text).toContain('rg.id_company IN');
  });

  it('UPSERT: UPDATE 0 filas -> INSERT en la tabla puente', async () => {
    mock.rawResolvers = [
      resolver([
        { match: /FROM requests_general rg WHERE/i, rows: [{ id_company: 1 }] },
        { match: /FROM process_category pc INNER JOIN company_category_request/i, rows: [{ ok: 1 }] },
        { match: /FROM process_category pc WHERE pc.id =/i, rows: [{ process_category: 'X' }] },
      ]),
    ];
    mock.executeRawResults = [0, 1, 1]; // UPDATE puente 0 -> INSERT, luego legacy

    const server = buildServer();
    const client = await connectClient(server);
    const { data } = await callJson(client, 'kronos_categorize_request', {
      id_request: 51,
      id_process_category: 8,
    });
    const r = data as { action: string };
    expect(r.action).toBe('inserted');
    expect(
      mock.capturedWrite.some((q) => /INSERT INTO process_category_request_general/i.test(q.text))
    ).toBe(true);
  });

  it('solicitud fuera de alcance -> error, NO escribe', async () => {
    mock.rawResolvers = [resolver([{ match: /FROM requests_general rg WHERE/i, rows: [] }])];
    const server = buildServer();
    const client = await connectClient(server);
    const { data, isError } = await callJson(client, 'kronos_categorize_request', {
      id_request: 999,
      id_process_category: 7,
    });
    expect(isError).toBe(true);
    expect(JSON.stringify(data)).toMatch(/inexistente o fuera de alcance/i);
    expect(mock.capturedWrite.length).toBe(0);
  });

  it('proceso inactivo/no habilitado -> error, NO escribe', async () => {
    mock.rawResolvers = [
      resolver([
        { match: /FROM requests_general rg WHERE/i, rows: [{ id_company: 1 }] },
        { match: /FROM process_category pc INNER JOIN company_category_request/i, rows: [] }, // no habilitado
      ]),
    ];
    const server = buildServer();
    const client = await connectClient(server);
    const { data, isError } = await callJson(client, 'kronos_categorize_request', {
      id_request: 50,
      id_process_category: 7,
    });
    expect(isError).toBe(true);
    expect(JSON.stringify(data)).toMatch(/inactivo o no habilitado/i);
    expect(mock.capturedWrite.length).toBe(0);
  });

  it('admin "*" puede categorizar; el SELECT de alcance no filtra empresa (1 = 1)', async () => {
    mock.rawResolvers = [
      resolver([
        { match: /FROM requests_general rg WHERE/i, rows: [{ id_company: 3 }] },
        { match: /FROM process_category pc INNER JOIN company_category_request/i, rows: [{ ok: 1 }] },
        { match: /FROM process_category pc WHERE pc.id =/i, rows: [{ process_category: 'Y' }] },
      ]),
    ];
    mock.executeRawResults = [1, 1];
    const server = buildServer(scopeAdmin);
    const client = await connectClient(server);
    const { isError } = await callJson(client, 'kronos_categorize_request', {
      id_request: 70,
      id_process_category: 9,
    });
    expect(isError ?? false).toBe(false);
    const scopeSel = mock.capturedRaw.find((q) =>
      /FROM requests_general rg WHERE/i.test(q.text.replace(/\s+/g, ' '))
    );
    expect(scopeSel!.text).toContain('1 = 1');
  });
});

// ============================================================================
// El candado de solo lectura NO se debilitó
// ============================================================================
describe('el candado read-only sigue intacto pese a las tools de escritura', () => {
  it('queryReadOnly sigue rechazando UPDATE/INSERT (vía de lectura)', async () => {
    const { queryReadOnly, Prisma } = await import('../src/db.js');
    await expect(
      queryReadOnly(Prisma.sql`UPDATE category_case SET id_category = ${1} WHERE id_case = ${2}`)
    ).rejects.toThrow(/solo lectura/i);
    await expect(
      queryReadOnly(Prisma.sql`INSERT INTO category_case (id_case) VALUES (${1})`)
    ).rejects.toThrow(/solo lectura/i);
  });

  it('la escritura de las tools NO pasó por queryReadOnly (fue por capturedWrite)', async () => {
    mock.rawResolvers = [
      resolver([
        { match: /FROM \[case\] c WHERE/i, rows: [{ ok: 1 }] },
        { match: /FROM activity a INNER JOIN subcategory s/i, rows: [{ ok: 1 }] },
      ]),
    ];
    mock.executeRawResults = [1];
    const server = buildServer();
    const client = await connectClient(server);
    await callJson(client, 'kronos_categorize_case', {
      id_case: 100,
      id_category: 5,
      id_subcategory: 9,
      id_activity: 20,
    });
    // Ningún UPDATE/INSERT apareció en capturedRaw (la vía de lectura).
    for (const q of mock.capturedRaw) {
      expect(/\b(UPDATE|INSERT|DELETE|MERGE)\b/i.test(q.text)).toBe(false);
    }
    // Sí hubo escritura, pero por la vía dedicada.
    expect(mock.capturedWrite.length).toBeGreaterThan(0);
  });

  it('la lista de tools ahora incluye exactamente 2 de escritura y 12 de lectura', async () => {
    const server = buildServer();
    const client = await connectClient(server);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names.length).toBe(16);
    expect(names).toContain('kronos_categorize_case');
    expect(names).toContain('kronos_categorize_request');
    const writeTools = names.filter((n) => n.startsWith('kronos_categorize_'));
    expect(writeTools.length).toBe(2);
  });
});
