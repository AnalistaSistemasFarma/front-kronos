import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.js';
import type { McpConfig } from '../src/config.js';
import { extractBearer, resolveScope } from '../src/auth.js';

const VALID_KEY = 'k'.repeat(40);

const testConfig: McpConfig = {
  port: 0,
  maxPageSize: 200,
  defaultPageSize: 50,
  auditLogFile: '/tmp/kronos-mcp-test-audit.log',
  apiKeys: [{ key: VALID_KEY, agent: 'horus', companyIds: [1], role: 'reader' }],
};

const noopAudit = { log: async () => {} };

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = createApp(testConfig, noopAudit);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function mcpInit() {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0.0' },
    },
  };
}

const headers = (auth?: string) => ({
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
  ...(auth ? { Authorization: auth } : {}),
});

describe('autenticación por API key (Bearer)', () => {
  it('sin header Authorization devuelve 401', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(mcpInit()),
    });
    expect(res.status).toBe(401);
  });

  it('API key desconocida/ inválida devuelve 401', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: headers('Bearer clave-que-no-existe'),
      body: JSON.stringify(mcpInit()),
    });
    expect(res.status).toBe(401);
  });

  it('header malformado (sin Bearer) devuelve 401', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: headers(VALID_KEY),
      body: JSON.stringify(mcpInit()),
    });
    expect(res.status).toBe(401);
  });

  it('API key válida NO devuelve 401', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: headers(`Bearer ${VALID_KEY}`),
      body: JSON.stringify(mcpInit()),
    });
    expect(res.status).not.toBe(401);
  });

  it('healthcheck no requiere auth', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { readOnly: boolean };
    expect(body.readOnly).toBe(true);
  });
});

describe('resolveScope (unidad)', () => {
  it('token nulo no resuelve alcance', () => {
    expect(resolveScope(null, testConfig.apiKeys)).toBeNull();
  });

  it('token correcto resuelve el alcance de la key', () => {
    const scope = resolveScope(VALID_KEY, testConfig.apiKeys);
    expect(scope?.agent).toBe('horus');
    expect(scope?.allCompanies).toBe(false);
    expect(scope?.companyIds).toEqual([1]);
  });

  it('una key "*" resuelve a un alcance admin (allCompanies=true, lista vacía)', () => {
    const adminKey = 'A'.repeat(40);
    const scope = resolveScope(adminKey, [
      { key: adminKey, agent: 'admin', companyIds: '*', role: 'admin' },
    ]);
    expect(scope?.allCompanies).toBe(true);
    expect(scope?.companyIds).toEqual([]);
    expect(scope?.role).toBe('admin');
  });

  it('extractBearer parsea correctamente', () => {
    expect(extractBearer('Bearer abc123')).toBe('abc123');
    expect(extractBearer('bearer abc123')).toBe('abc123');
    expect(extractBearer('abc123')).toBeNull();
    expect(extractBearer(undefined)).toBeNull();
  });
});
