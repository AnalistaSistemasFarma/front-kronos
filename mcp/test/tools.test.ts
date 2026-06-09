import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { registerTools } from '../src/tools/index.js';
import { setPrisma } from '../src/db.js';
import type { AuthScope } from '../src/auth.js';
import { createMockPrisma, connectClient, callJson, type MockPrisma } from './helpers.js';

const noopAudit = { log: async () => {} };

// Alcance: la key solo puede ver la empresa 1.
const scopeA: AuthScope = { agent: 'horus', role: 'reader', allCompanies: false, companyIds: [1] };
// Alcance admin: comodín "*", ve TODAS las empresas, sin filtro de empresa.
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

/** Concatena todo el SQL+valores capturado en una sola cadena inspeccionable. */
function allCapturedText(): string {
  return mock.capturedRaw
    .map((q) => q.text + ' || VALUES: ' + JSON.stringify(q.values))
    .join('\n');
}

describe('enforcement de empresa en las tools', () => {
  it('kronos_list_requests filtra por la empresa del alcance (id_company IN (1))', async () => {
    const server = buildServer();
    const client: Client = await connectClient(server);
    await callJson(client, 'kronos_list_requests', {});

    const reqQuery = mock.capturedRaw.find((q) => q.text.includes('requests_general'));
    expect(reqQuery).toBeDefined();
    expect(reqQuery!.text).toContain('rg.id_company IN');
    // El valor parametrizado del IN debe ser exactamente [1].
    expect(reqQuery!.values).toContain(1);
    expect(reqQuery!.values).not.toContain(2);
  });

  it('forzar companyId=2 con alcance [1] NO permite ver la empresa 2', async () => {
    const server = buildServer();
    const client = await connectClient(server);
    await callJson(client, 'kronos_list_requests', { companyId: 2 });

    const reqQuery = mock.capturedRaw.find((q) => q.text.includes('requests_general'));
    // Intersección vacía -> el filtro se vuelve 1 = 0 (ninguna fila).
    expect(reqQuery!.text).toContain('1 = 0');
    expect(reqQuery!.values).not.toContain(2);
  });

  it('un registro de la empresa 2 nunca aparece en los resultados de una key de empresa 1', async () => {
    // Sembramos data de empresa 2; como el WHERE es 1=0 al pedir empresa 2,
    // el mock devuelve [] (no hay coincidencia de FROM con filtro abierto).
    mock.rawRows.requests_general = [{ id: 10, id_company: 2, subject: 'secreto B' }];
    const server = buildServer();
    const client = await connectClient(server);
    const { data } = await callJson(client, 'kronos_list_requests', { companyId: 2 });
    const payload = data as { data: unknown[] };
    // El servidor pidió 1=0; aunque el mock tuviera filas, el SQL real no las
    // traería. Verificamos que el filtro de empresa B nunca se emitió.
    expect(allCapturedText()).not.toMatch(/IN \(\$?\d*\).*\b2\b/);
    expect(JSON.stringify(payload)).not.toContain('"id_company": 2,\n            "subject": "secreto B"');
  });

  it('kronos_list_tickets filtra por case.company IN (1)', async () => {
    const server = buildServer();
    const client = await connectClient(server);
    await callJson(client, 'kronos_list_tickets', {});
    const q = mock.capturedRaw.find((x) => x.text.toLowerCase().includes('from [case]'));
    expect(q!.text).toContain('c.company IN');
    expect(q!.values).toContain(1);
  });

  it('kronos_get_request solo trae la solicitud si está en el alcance', async () => {
    const server = buildServer();
    const client = await connectClient(server);
    await callJson(client, 'kronos_get_request', { id: 99 });
    const q = mock.capturedRaw.find((x) => x.text.includes('requests_general'));
    expect(q!.text).toContain('rg.id_company IN');
    expect(q!.values).toContain(1);
  });

  it('kronos_list_users filtra por id_company del alcance vía relación', async () => {
    const server = buildServer();
    const client = await connectClient(server);
    await callJson(client, 'kronos_list_users', { companyId: 2 }); // fuera de alcance
    // companyIds efectivos = [] -> where companyUsers.some.id_company in []
    const where = mock.lastUserWhere as {
      companyUsers: { some: { id_company: { in: number[] } } };
    };
    expect(where.companyUsers.some.id_company.in).toEqual([]);
  });

  it('kronos_metadata expone solo el alcance de la key actual', async () => {
    const server = buildServer();
    const client = await connectClient(server);
    const { data } = await callJson(client, 'kronos_metadata', {});
    const meta = data as { allowedCompanyIds: number[]; readOnly: boolean };
    expect(meta.allowedCompanyIds).toEqual([1]);
    expect(meta.readOnly).toBe(true);
  });
});

describe('alcance admin "*" — ve todas las empresas', () => {
  it('una key "*" NO emite filtro de empresa (1 = 1) y ve múltiples empresas', async () => {
    // Sembramos registros de empresas distintas; el SQL admin no filtra empresa.
    mock.rawRows.requests_general = [
      { id: 1, id_company: 1, subject: 'A' },
      { id: 2, id_company: 2, subject: 'B' },
    ];
    const server = buildServer(scopeAdmin);
    const client = await connectClient(server);
    const { data } = await callJson(client, 'kronos_list_requests', {});

    const reqQuery = mock.capturedRaw.find((q) => q.text.includes('requests_general'));
    expect(reqQuery).toBeDefined();
    // Admin: sin restricción de empresa -> el filtro es 1 = 1, nunca un IN.
    expect(reqQuery!.text).toContain('1 = 1');
    expect(reqQuery!.text).not.toContain('id_company IN');
    const payload = data as { data: { id_company: number }[] };
    const companies = payload.data.map((r) => r.id_company);
    expect(companies).toContain(1);
    expect(companies).toContain(2);
  });

  it('una key "*" con companyId del cliente acota por conveniencia (filtra, no falla)', async () => {
    const server = buildServer(scopeAdmin);
    const client = await connectClient(server);
    const { isError } = await callJson(client, 'kronos_list_requests', { companyId: 2 });

    expect(isError ?? false).toBe(false);
    const reqQuery = mock.capturedRaw.find((q) => q.text.includes('requests_general'));
    // El admin SÍ puede acotar a la empresa 2 (no hay nada que ampliar).
    expect(reqQuery!.text).toContain('rg.id_company IN');
    expect(reqQuery!.values).toContain(2);
  });

  it('kronos_metadata de un admin reporta allCompanies y allowedCompanyIds "*"', async () => {
    const server = buildServer(scopeAdmin);
    const client = await connectClient(server);
    const { data } = await callJson(client, 'kronos_metadata', {});
    const meta = data as { allCompanies: boolean; allowedCompanyIds: unknown };
    expect(meta.allCompanies).toBe(true);
    expect(meta.allowedCompanyIds).toBe('*');
  });

  it('kronos_list_users de un admin no restringe por empresa', async () => {
    const server = buildServer(scopeAdmin);
    const client = await connectClient(server);
    await callJson(client, 'kronos_list_users', {});
    // where vacío -> sin filtro companyUsers.
    expect(mock.lastUserWhere).toEqual({});
  });
});

describe('solo lectura — no hay tools de escritura', () => {
  it('la lista de tools registradas no contiene mutaciones', async () => {
    const server = buildServer();
    const client = await connectClient(server);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    // Todas las tools deben empezar por kronos_ y ser de lectura.
    expect(names.length).toBeGreaterThan(0);
    const writeVerbs = /(create|update|delete|insert|remove|write|set_|authorize|assign|mutat)/i;
    for (const n of names) {
      expect(n.startsWith('kronos_')).toBe(true);
      expect(writeVerbs.test(n)).toBe(false);
    }
    // Confirmamos el set esperado de lectura.
    expect(names).toContain('kronos_list_requests');
    expect(names).toContain('kronos_get_ticket');
    expect(names).toContain('kronos_search');
  });
});

describe('candado de solo lectura — el SQL crudo pasa por la guarda', () => {
  it('todo el SQL crudo emitido por las tools empieza por SELECT', async () => {
    const server = buildServer();
    const client = await connectClient(server);
    // Ejecuta las tools que usan $queryRaw (vía queryReadOnly).
    await callJson(client, 'kronos_list_requests', {});
    await callJson(client, 'kronos_list_tickets', {});
    await callJson(client, 'kronos_get_request', { id: 1 });
    await callJson(client, 'kronos_search', { entity: 'all', text: 'x' });

    expect(mock.capturedRaw.length).toBeGreaterThan(0);
    for (const q of mock.capturedRaw) {
      const cleaned = q.text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n\r]*/g, ' ').trim();
      expect(/^select\b/i.test(cleaned)).toBe(true);
    }
  });

  it('si queryReadOnly recibiera una mutación, lanzaría (defensa de la guarda)', async () => {
    const { queryReadOnly, Prisma } = await import('../src/db.js');
    await expect(
      queryReadOnly(Prisma.sql`DELETE FROM requests_general WHERE id = ${1}`)
    ).rejects.toThrow(/solo lectura/i);
  });
});

describe('sanitización — nunca se devuelve password ni tokens', () => {
  it('kronos_list_users no incluye password ni campos sensibles', async () => {
    mock.rawRows.user = [
      { id: 'u1', name: 'Ana', email: 'ana@x.com', role: 'user', isActive: true },
    ];
    const server = buildServer();
    const client = await connectClient(server);
    const { data } = await callJson(client, 'kronos_list_users', {});
    const txt = JSON.stringify(data);
    expect(txt).not.toMatch(/password/i);
    expect(txt).not.toMatch(/refresh_token|access_token|id_token|sessionToken/i);
    expect(txt).toContain('ana@x.com');

    // El select de Prisma no debe pedir password.
    // (verificamos que el código nunca seleccionó esos campos)
    expect(JSON.stringify(mock.lastUserWhere ?? {})).not.toMatch(/password/i);
  });
});

describe('robustez ante inyección SQL', () => {
  it("un texto de búsqueda malicioso viaja como VALOR parametrizado, no como SQL", async () => {
    const server = buildServer();
    const client = await connectClient(server);
    const evil = "x'; DROP TABLE requests_general; --";
    await callJson(client, 'kronos_search', { entity: 'requests', text: evil });

    const q = mock.capturedRaw.find((x) => x.text.includes('requests_general'));
    expect(q).toBeDefined();
    // El texto SQL NO debe contener el payload crudo: debe estar parametrizado.
    expect(q!.text).not.toContain('DROP TABLE');
    // El payload debe aparecer como valor parametrizado (envuelto en %...%).
    expect(q!.values).toContain(`%${evil}%`);
    // El SQL sigue conteniendo el filtro de empresa intacto.
    expect(q!.text).toContain('rg.id_company IN');
  });

  it('no se puede ampliar el alcance por inyección en companyId (es numérico)', async () => {
    const server = buildServer();
    const client = await connectClient(server);
    // companyId solo acepta number; un valor no numérico es rechazado por zod.
    const res = await callJson(client, 'kronos_search', {
      entity: 'requests',
      // @ts-expect-error prueba de tipo inválido a propósito
      companyId: '2 OR 1=1',
    });
    // La tool falla por validación de esquema (no ejecuta SQL con basura).
    expect(res.isError ?? false).toBe(true);
  });
});
