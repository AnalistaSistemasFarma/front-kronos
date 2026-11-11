/**
 * Permisos API (2026-11-09): llaves de la BASE + respaldo de las del ARCHIVO.
 * Sin base real: la carga y el último uso son dobles de prueba.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DB_KEY_ROLE, resolveScopeCombined, scopeFromDbEntry, toolRequiresAgentCode } from '../src/auth.js';
import { USUARIOS_TOOL_NAMES, type ApiKeyEntry, type McpConfig } from '../src/config.js';
import { createDbKeyStore, isDbKeyExpired, type DbApiKeyEntry } from '../src/dbKeys.js';
import { createApp, KNOWN_TOOLS } from '../src/server.js';
import { CORREO_AGENTE_TOOLS } from '../src/tools/correoAgente.js';
import { IA_ACCESS_TOOL } from '../src/tools/iaAccess.js';
import { PROYECTOS_TOOLS } from '../src/tools/proyectos.js';
import { TOOL_CAPABILITIES } from '../src/tools/index.js';

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

const DB_KEY = `sk_syn_${'d'.repeat(43)}`;
const FILE_KEY = 'f'.repeat(40);
const SHARED_KEY = `sk_syn_${'s'.repeat(43)}`;

const dbEntry = (over: Partial<DbApiKeyEntry> = {}): DbApiKeyEntry => ({
  keyId: 7,
  keyHash: sha(DB_KEY),
  clientId: 3,
  name: 'Portal de terceros',
  agentCode: null,
  allCompanies: false,
  companyIds: [2, 5],
  allowedTools: ['kronos_list_requests'],
  ...over,
});

const fileKeys: ApiKeyEntry[] = [
  { key: FILE_KEY, agent: 'horus', companyIds: [1], role: 'reader' },
  { key: SHARED_KEY, agent: 'archivo-admin', companyIds: '*', role: 'admin' },
];

describe('resolveScopeCombined', () => {
  it('resuelve una llave de la base con su alcance (lista blanca, empresas, rol sin admin)', () => {
    const r = resolveScopeCombined(DB_KEY, fileKeys, [dbEntry({ agentCode: 'galileo' })]);
    expect(r?.dbKeyId).toBe(7);
    expect(r?.scope).toEqual({
      agent: 'Portal de terceros',
      role: DB_KEY_ROLE,
      allCompanies: false,
      companyIds: [2, 5],
      allowedTools: ['kronos_list_requests'],
      agentCode: 'galileo',
    });
  });

  it('all_companies = comodín: allCompanies y lista vacía', () => {
    const r = resolveScopeCombined(DB_KEY, fileKeys, [dbEntry({ allCompanies: true, companyIds: [9] })]);
    expect(r?.scope.allCompanies).toBe(true);
    expect(r?.scope.companyIds).toEqual([]);
  });

  it('sin permisos marcados la llave queda restringida a NADA (nunca «sin restricción»)', () => {
    const r = resolveScopeCombined(DB_KEY, fileKeys, [dbEntry({ allowedTools: [] })]);
    expect(r?.scope.allowedTools).toEqual([]);
  });

  it('las llaves del archivo siguen funcionando', () => {
    const r = resolveScopeCombined(FILE_KEY, fileKeys, [dbEntry()]);
    expect(r?.dbKeyId).toBeUndefined();
    expect(r?.scope.agent).toBe('horus');
  });

  it('si la misma llave está en ambos, gana la de la base', () => {
    const r = resolveScopeCombined(SHARED_KEY, fileKeys, [dbEntry({ keyHash: sha(SHARED_KEY), keyId: 11 })]);
    expect(r?.dbKeyId).toBe(11);
    expect(r?.scope.role).toBe(DB_KEY_ROLE);
    expect(r?.scope.allCompanies).toBe(false);
  });

  it('llave desconocida o nula: sin alcance', () => {
    expect(resolveScopeCombined('nada', fileKeys, [dbEntry()])).toBeNull();
    expect(resolveScopeCombined(null, fileKeys, [dbEntry()])).toBeNull();
  });

  it('acepta el hash guardado en mayúsculas', () => {
    expect(resolveScopeCombined(DB_KEY, fileKeys, [dbEntry({ keyHash: sha(DB_KEY).toUpperCase() })])?.dbKeyId).toBe(7);
  });
});

describe('catálogo api_permission (semilla) frente a las herramientas del MCP', () => {
  const sqlDe = (name: string) => readFileSync(new URL(`../../prisma/manual/${name}`, import.meta.url), 'utf8');
  const filas = (text: string) =>
    [...text.matchAll(/^\s*\(N'([a-z_]+)',.*, ([01]), (\d+)\),?\s*$/gm)].map((m) => ({ code: m[1] as string, active: m[2] === '1' }));

  it('la semilla (PRUEBAS y PROD) trae exactamente las herramientas registradas', () => {
    const conocidas = [...KNOWN_TOOLS].sort();
    expect(conocidas).toHaveLength(53);
    expect(filas(sqlDe('2026-11-09-permisos-api-PRUEBAS.sql')).map((f) => f.code).sort()).toEqual(conocidas);
    expect(filas(sqlDe('2026-11-09-permisos-api-PROD.sql')).map((f) => f.code).sort()).toEqual(conocidas);
  });

  it('las de usuarios entran inactivas (exigen el bloque «usuarios» del archivo)', () => {
    const inactivas = filas(sqlDe('2026-11-09-permisos-api-PRUEBAS.sql')).filter((f) => !f.active).map((f) => f.code);
    expect(inactivas.sort()).toEqual([...USUARIOS_TOOL_NAMES].sort());
  });

  it('toolRequiresAgentCode = ia_access + correo_* + proyectos', () => {
    const esperadas = [IA_ACCESS_TOOL, ...CORREO_AGENTE_TOOLS, ...PROYECTOS_TOOLS].sort();
    expect([...KNOWN_TOOLS].filter(toolRequiresAgentCode).sort()).toEqual(esperadas);
  });

  it('una llave de la base SIN código de agente pierde las herramientas que actúan como agente', () => {
    const marcadas = ['kronos_list_requests', 'proyectos_listar', 'correo_hilo_compartido', 'kronos_request_ia_access', 'teams_list_meetings'];
    expect(scopeFromDbEntry(dbEntry({ allowedTools: marcadas })).allowedTools).toEqual(['kronos_list_requests', 'teams_list_meetings']);
    expect(scopeFromDbEntry(dbEntry({ allowedTools: marcadas, agentCode: 'zoe' })).allowedTools).toEqual(marcadas);
  });

  it('una llave de la base nunca trae el bloque «usuarios»', () => {
    const scope = scopeFromDbEntry(dbEntry({ agentCode: 'zoe', allowedTools: [...USUARIOS_TOOL_NAMES] }));
    expect(scope.usuarios).toBeUndefined();
  });
});

describe('nivel de acceso: solo lectura / lectura y escritura (2026-11-11)', () => {
  const sqlDe = (name: string) => readFileSync(new URL(`../../prisma/manual/${name}`, import.meta.url), 'utf8');
  const escritura = (text: string) => {
    const lista = /WHERE \[code\] IN \(([^)]*)\)/.exec(text)?.[1] ?? '';
    return [...lista.matchAll(/N''([a-z_]+)''/g)].map((m) => m[1] as string).sort();
  };

  it('el script marca como escritura exactamente las herramientas que escriben (+ crear usuarios)', () => {
    const esperadas = [...TOOL_CAPABILITIES.write, 'kronos_usuarios_crear'].sort();
    expect(escritura(sqlDe('2026-11-11-permisos-api-nivel-acceso-PRUEBAS.sql'))).toEqual(esperadas);
    expect(escritura(sqlDe('2026-11-11-permisos-api-nivel-acceso-PROD.sql'))).toEqual(esperadas);
  });

  it('la carga de llaves no trae permisos de escritura a un cliente en solo lectura', () => {
    const fuente = readFileSync(new URL('../src/dbKeys.ts', import.meta.url), 'utf8');
    expect(fuente).toMatch(/AND \(p\.access_kind = N'consulta' OR c\.access_mode = N'escritura'\)/);
  });

  it('los clientes que ya escriben quedan en escritura; los demás, en solo lectura', () => {
    const texto = sqlDe('2026-11-11-permisos-api-nivel-acceso-PRUEBAS.sql');
    expect(texto).toMatch(/SET c\.\[access_mode\] = N''escritura''[\s\S]*WHERE c\.\[access_mode\] IS NULL[\s\S]*p\.\[access_kind\] = N''escritura''/);
    expect(texto).not.toMatch(/UPDATE[^;]*access_mode[^;]*lectura/);
  });
});

describe('createDbKeyStore', () => {
  it('guarda la lista 60 s y recarga después', async () => {
    let t = 0;
    const load = vi.fn(async () => [dbEntry()]);
    const store = createDbKeyStore({ load, now: () => t, ttlMs: 60_000 });
    await store.getEntries();
    t = 59_999;
    await store.getEntries();
    expect(load).toHaveBeenCalledTimes(1);
    t = 60_000;
    await store.getEntries();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('una llave que vence entre dos recargas deja de servir en ese momento (no espera los 60 s)', async () => {
    let t = Date.parse('2026-11-10T12:00:00Z');
    const load = vi.fn(async () => [dbEntry({ expiresAt: new Date('2026-11-10T12:00:30Z') })]);
    const store = createDbKeyStore({ load, now: () => t, ttlMs: 60_000 });
    expect(await store.getEntries()).toHaveLength(1);
    t += 30_000;
    expect(await store.getEntries()).toEqual([]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('si falta la columna expires_at, falla cerrado y lo dice en el registro', async () => {
    const logError = vi.fn();
    const store = createDbKeyStore({
      load: async () => {
        throw new Error("Invalid column name 'expires_at'.");
      },
      logError,
    });
    expect(await store.getEntries()).toEqual([]);
    expect(logError.mock.calls[0][0]).toMatch(/expires_at/);
  });

  it('una sola carga en vuelo para peticiones simultáneas', async () => {
    const load = vi.fn(async () => [dbEntry()]);
    const store = createDbKeyStore({ load });
    await Promise.all([store.getEntries(), store.getEntries(), store.getEntries()]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('falla cerrado: si la base falla, no quedan llaves de la base (ni las anteriores)', async () => {
    let t = 0;
    let fail = false;
    const load = vi.fn(async () => {
      if (fail) throw new Error('Invalid object name dbo.api_client_key');
      return [dbEntry()];
    });
    const logError = vi.fn();
    const store = createDbKeyStore({ load, now: () => t, logError });
    expect(await store.getEntries()).toHaveLength(1);
    fail = true;
    t = 61_000;
    expect(await store.getEntries()).toEqual([]);
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('marca el último uso como máximo una vez por minuto por llave', () => {
    let t = 0;
    const touch = vi.fn(async () => {});
    const store = createDbKeyStore({ load: async () => [], touch, now: () => t });
    store.touch(7);
    t = 30_000;
    store.touch(7);
    store.touch(8);
    t = 60_000;
    store.touch(7);
    expect(touch.mock.calls).toEqual([[7], [8], [7]]);
  });
});

describe('servidor HTTP con llaves de la base', () => {
  const config: McpConfig = {
    port: 0,
    maxPageSize: 200,
    defaultPageSize: 50,
    auditLogFile: '/tmp/kronos-mcp-test-audit.log',
    apiKeys: fileKeys,
  };
  const touch = vi.fn();
  const store = { getEntries: async () => [dbEntry()], touch };
  // Tipo tomado de lo que devuelve `listen` (express): importar `Server` de 'node:http'
  // chocaba en el editor con la otra copia de @types/node de la raíz del proyecto.
  let server: ReturnType<ReturnType<typeof createApp>['listen']>;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createApp(config, { log: async () => {} }, store);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const post = (token: string, body: unknown) =>
    fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

  const init = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
  };

  it('la llave de la base entra y marca el último uso', async () => {
    const res = await post(DB_KEY, init);
    expect(res.status).not.toBe(401);
    expect(touch).toHaveBeenCalledWith(7);
  });

  it('la llave del archivo sigue entrando', async () => {
    const res = await post(FILE_KEY, init);
    expect(res.status).not.toBe(401);
  });

  it('una herramienta no marcada en la base se rechaza con 403', async () => {
    const res = await post(DB_KEY, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'kronos_create_request', arguments: {} },
    });
    expect(res.status).toBe(403);
  });

  it('una llave revocada (fuera de la lista) devuelve 401', async () => {
    const res = await post(`sk_syn_${'r'.repeat(43)}`, init);
    expect(res.status).toBe(401);
  });
});

describe('vencimiento de llaves de la base (2026-11-10)', () => {
  it('sin fecha no vence; con fecha pasada o igual, vencida', () => {
    const now = Date.parse('2026-11-10T12:00:00Z');
    expect(isDbKeyExpired(null, now)).toBe(false);
    expect(isDbKeyExpired(undefined, now)).toBe(false);
    expect(isDbKeyExpired(new Date('2028-11-10T12:00:00Z'), now)).toBe(false);
    expect(isDbKeyExpired('2026-11-10T12:00:00Z', now)).toBe(true);
    expect(isDbKeyExpired(new Date('2025-01-01T00:00:00Z'), now)).toBe(true);
  });
});
