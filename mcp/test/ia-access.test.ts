/**
 * kronos_request_ia_access + lista blanca de herramientas por key +
 * creación de tareas igual que la app (src/workflow.ts).
 * Prisma mockeado (helpers.ts): no requiere base real.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from '../src/tools/index.js';
import { buildDescription, DESCRIPTION_MAX, parseSistemaLine } from '../src/tools/iaAccess.js';
import { selectInitialTasks, type TaskTemplateRow } from '../src/workflow.js';
import { setPrisma } from '../src/db.js';
import type { AuthScope } from '../src/auth.js';
import { createApp, buildMcpServer } from '../src/server.js';
import { loadConfig, type McpConfig } from '../src/config.js';
import { createMockPrisma, connectClient, callJson, type MockPrisma, type CapturedRawQuery } from './helpers.js';

const noopAudit = { log: async () => {} };
const TOOL = 'kronos_request_ia_access';

const galileo: AuthScope = {
  agent: 'galileo',
  role: 'agent',
  allCompanies: false,
  companyIds: [3, 5],
  allowedTools: [TOOL],
  agentCode: 'galileo',
};

const ARGS = {
  requesterEmail: 'Persona@OneLatamPharma.com',
  sistema: 'SAP Business One',
  para_que: 'Consultar inventario por lote',
  datos: 'Artículos, lotes y bodegas',
  solo_lectura: true,
};

interface Scenario {
  agent?: unknown[];
  users?: unknown[];
  grants?: { id_company: number; company: string }[];
  procs?: { id: number; id_company: number }[];
  previous?: unknown[];
  templates?: TaskTemplateRow[];
  conditions?: unknown[];
  owners?: unknown[];
}

const DEFAULT_TEMPLATES: TaskTemplateRow[] = [
  { id_task: 316, task: 'Autorizacion del conector', is_sequential: true, display_order: 0, is_authorization: true, id_user: 'u-andrea', email: 'andrea.duque@onelatampharma.com', name: 'Andrea Duque' },
  { id_task: 317, task: 'Instalación de conector ', is_sequential: true, display_order: 1, is_authorization: false, id_user: 'u-nico', email: 'nicolas.rivera@gsslatam.com', name: 'Nicolás' },
  { id_task: 318, task: 'Auditoria de seguridad', is_sequential: true, display_order: 2, is_authorization: false, id_user: 'u-ivan', email: 'ivan.gutierrez@gsslatam.com', name: 'Iván' },
];

let mock: MockPrisma;

function scenario(s: Scenario) {
  const norm = (q: CapturedRawQuery) => q.text.replace(/\s+/g, ' ');
  mock.rawResolvers = [
    (q) => {
      const t = norm(q);
      if (/FROM agent a WHERE LOWER\(a\.code\)/.test(t))
        return s.agent ?? [{ id_agent: 39, code: 'galileo', display_name: 'Galileo', id_subprocess: 95 }];
      if (/FROM \[user\] u WHERE LOWER\(LTRIM\(RTRIM\(u\.email/.test(t))
        return s.users ?? [{ id: 'u-persona', name: 'Persona OLP', email: 'persona@onelatampharma.com', isActive: true }];
      if (/FROM subprocess_user_company suc/.test(t)) return s.grants ?? [{ id_company: 3, company: 'ONELATAMPHARMA' }];
      if (/FROM process_category pc INNER JOIN company_category_request ccr/.test(t))
        return s.procs ?? [{ id: 126, id_company: 3 }, { id: 127, id_company: 5 }];
      if (/FROM requests_general rg INNER JOIN process_category_request_general pcrg/.test(t)) return s.previous ?? [];
      if (/INSERT INTO requests_general/.test(t)) return [{ id: 5001 }];
      if (/FROM task_process_category tpc LEFT JOIN user_task_request_general/.test(t)) return s.templates ?? DEFAULT_TEMPLATES;
      if (/FROM task_condition_option tco/.test(t)) return s.conditions ?? [];
      if (/FROM user_process_category_request_general upcrg/.test(t)) return s.owners ?? [{ email: 'nicolas.rivera@gsslatam.com' }];
      if (/SELECT TOP 1 u\.email FROM \[user\] u WHERE u\.id/.test(t)) return [{ email: 'horus@gsslatam.com' }];
      return undefined;
    },
  ];
}

function buildServer(scope: AuthScope = galileo): McpServer {
  const server = new McpServer({ name: 'test', version: '1.0.0' });
  registerTools(server, { scope, audit: noopAudit, maxPageSize: 200, defaultPageSize: 50 });
  return server;
}

async function call(args: Record<string, unknown>, scope: AuthScope = galileo) {
  const client = await connectClient(buildServer(scope));
  return callJson(client, TOOL, args);
}

const inserts = (re: RegExp) =>
  [...mock.capturedRaw, ...mock.capturedWrite].filter((q) => re.test(q.text.replace(/\s+/g, ' ')));

beforeEach(() => {
  mock = createMockPrisma();
  // @ts-expect-error mock parcial compatible para pruebas
  setPrisma(mock);
  scenario({});
});

describe('kronos_request_ia_access — deducción de empresa', () => {
  it('0 empresas con el agente asignado → rechazo y nada se inserta', async () => {
    scenario({ grants: [] });
    const r = await call(ARGS);
    expect(r.isError).toBe(true);
    expect(String(r.data)).toMatch(/no tiene asignado el agente Galileo/);
    expect(inserts(/INSERT INTO requests_general/)).toHaveLength(0);
  });

  it('1 empresa → crea en esa empresa, a nombre de la persona, con el proceso de la empresa', async () => {
    const r = await call(ARGS);
    expect(r.isError).toBeFalsy();
    const d = r.data as { status: string; id_request: number; empresa: { id_company: number }; id_process_category: number; siguiente_paso: string };
    expect(d.status).toBe('creada');
    expect(d.id_request).toBe(5001);
    expect(d.empresa.id_company).toBe(3);
    expect(d.id_process_category).toBe(126);
    expect(d.siguiente_paso).toMatch(/Autorizacion del conector.*Andrea Duque/);
    const ins = inserts(/INSERT INTO requests_general/)[0]!;
    expect(ins.values).toContain(3);
    expect(ins.values).toContain('u-persona');
    const desc = ins.values.find((v) => typeof v === 'string' && v.startsWith('Solicitud de conector')) as string;
    expect(desc).toMatch(/^Sistema: SAP Business One$/m);
    expect(desc).toMatch(/Radicada por el agente Galileo a pedido de persona@onelatampharma\.com\. \[agente:galileo\]/);
    const link = inserts(/INSERT INTO process_category_request_general/)[0]!;
    expect(link.values).toEqual([5001, 126]);
  });

  it('varias empresas sin companyId → devuelve la lista y no crea nada', async () => {
    scenario({ grants: [{ id_company: 3, company: 'ONELATAMPHARMA' }, { id_company: 5, company: 'UNIDOSSIS' }] });
    const r = await call(ARGS);
    expect(r.isError).toBeFalsy();
    const d = r.data as { status: string; empresas: { companyId: number }[] };
    expect(d.status).toBe('elegir_empresa');
    expect(d.empresas.map((e) => e.companyId).sort()).toEqual([3, 5]);
    expect(inserts(/INSERT INTO/)).toHaveLength(0);
  });

  it('varias empresas con companyId de la lista → crea en la escogida (proceso de esa empresa)', async () => {
    scenario({ grants: [{ id_company: 3, company: 'ONELATAMPHARMA' }, { id_company: 5, company: 'UNIDOSSIS' }] });
    const r = await call({ ...ARGS, companyId: 5 });
    const d = r.data as { status: string; empresa: { id_company: number }; id_process_category: number };
    expect(d.status).toBe('creada');
    expect(d.empresa.id_company).toBe(5);
    expect(d.id_process_category).toBe(127);
  });

  it('companyId fuera de la lista → rechazo', async () => {
    scenario({ grants: [{ id_company: 3, company: 'ONELATAMPHARMA' }, { id_company: 5, company: 'UNIDOSSIS' }] });
    const r = await call({ ...ARGS, companyId: 1 });
    expect(r.isError).toBe(true);
    expect(String(r.data)).toMatch(/no está entre las permitidas/);
    expect(inserts(/INSERT INTO/)).toHaveLength(0);
  });

  it('nunca GSS: con GSS + OLP crea en OLP sin preguntar; solo GSS → rechazo', async () => {
    scenario({ grants: [{ id_company: 8, company: 'GSS' }, { id_company: 3, company: 'ONELATAMPHARMA' }] });
    let r = await call(ARGS);
    expect((r.data as { empresa: { id_company: number } }).empresa.id_company).toBe(3);

    mock = createMockPrisma();
    // @ts-expect-error mock parcial
    setPrisma(mock);
    scenario({ grants: [{ id_company: 8, company: 'GSS ' }], procs: [{ id: 999, id_company: 8 }] });
    r = await call(ARGS);
    expect(r.isError).toBe(true);
    expect(inserts(/INSERT INTO/)).toHaveLength(0);
  });

  it('companyId de GSS explícito → rechazo aunque la persona tenga el permiso', async () => {
    scenario({ grants: [{ id_company: 8, company: 'GSS' }, { id_company: 3, company: 'ONELATAMPHARMA' }], procs: [{ id: 126, id_company: 3 }, { id: 999, id_company: 8 }] });
    const r = await call({ ...ARGS, companyId: 8 });
    expect(r.isError).toBe(true);
  });

  it('se interseca con el alcance de la key', async () => {
    scenario({ grants: [{ id_company: 3, company: 'ONELATAMPHARMA' }, { id_company: 5, company: 'UNIDOSSIS' }] });
    const r = await call(ARGS, { ...galileo, companyIds: [3] });
    expect((r.data as { status: string; empresa: { id_company: number } }).empresa.id_company).toBe(3);
  });

  it('empresa sin el proceso configurado → rechazo claro', async () => {
    scenario({ procs: [] });
    const r = await call(ARGS);
    expect(r.isError).toBe(true);
    expect(String(r.data)).toMatch(/no tiene configurado el proceso/);
  });

  it('persona inexistente → rechazo', async () => {
    scenario({ users: [] });
    const r = await call(ARGS);
    expect(r.isError).toBe(true);
    expect(String(r.data)).toMatch(/no existe un usuario/);
  });

  it('key sin agentCode → rechazo', async () => {
    const r = await call(ARGS, { ...galileo, agentCode: undefined });
    expect(r.isError).toBe(true);
    expect(String(r.data)).toMatch(/no identifica a un agente/);
  });
});

describe('kronos_request_ia_access — tope y duplicado', () => {
  it('duplicado abierto del mismo sistema (normalizado) → devuelve el número existente, no crea', async () => {
    scenario({
      previous: [{ id: 77, status_req: 1, is_today: 0, description: 'Solicitud de conector para agente IA\nSistema: sap   BUSINESS one\nPara qué: x' }],
    });
    const r = await call(ARGS);
    expect(r.isError).toBeFalsy();
    expect(r.data).toMatchObject({ status: 'duplicada', id_request: 77 });
    expect(inserts(/INSERT INTO requests_general/)).toHaveLength(0);
  });

  it('una cerrada o cancelada del mismo sistema NO es duplicado', async () => {
    scenario({
      previous: [
        { id: 78, status_req: 2, is_today: 0, description: 'Sistema: SAP Business One' },
        { id: 79, status_req: 3, is_today: 0, description: 'Sistema: SAP Business One' },
      ],
    });
    const r = await call(ARGS);
    expect((r.data as { status: string }).status).toBe('creada');
  });

  it('tope: 3 hoy con el mismo agente → rechazo', async () => {
    const prev = [1, 2, 3].map((i) => ({ id: i, status_req: 2, is_today: 1, description: `Sistema: otro ${i}\nRadicada por el agente Galileo a pedido de x. [agente:galileo]` }));
    scenario({ previous: prev });
    const r = await call(ARGS);
    expect(r.isError).toBe(true);
    expect(String(r.data)).toMatch(/tope 3/);
    expect(inserts(/INSERT INTO requests_general/)).toHaveLength(0);
  });

  it('tope por agente: 3 hoy con OTRO agente no bloquean', async () => {
    const prev = [1, 2, 3].map((i) => ({ id: i, status_req: 2, is_today: 1, description: `Sistema: otro ${i}\n[agente:lisa]` }));
    scenario({ previous: prev });
    const r = await call(ARGS);
    expect((r.data as { status: string }).status).toBe('creada');
  });

  it('toma un candado de aplicación por persona antes de contar', async () => {
    await call(ARGS);
    const lock = inserts(/sp_getapplock/);
    expect(lock).toHaveLength(1);
    expect(lock[0]!.values).toContain('kronos-ia-access:u-persona');
  });
});

describe('creación de tareas igual que la app', () => {
  it('flujo secuencial: solo se instancia la PRIMERA tarea (autorización a andrea.duque)', async () => {
    await call(ARGS);
    const tasks = inserts(/INSERT INTO task_request_general/);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.values).toEqual([5001, 316, 'u-andrea']);
  });

  it('notificaciones de campana: creador, encargado y responsable de la tarea creada', async () => {
    await call(ARGS);
    const notifs = inserts(/INSERT INTO notifications/).map((q) => q.values[0]);
    expect(notifs).toEqual(['persona@onelatampharma.com', 'nicolas.rivera@gsslatam.com', 'andrea.duque@onelatampharma.com']);
  });

  it('selectInitialTasks replica createGeneralRequest (paralelas, primera secuencial, condiciones, autorización sin responsable)', () => {
    const rows: TaskTemplateRow[] = [
      { id_task: 10, is_sequential: true, display_order: 2, is_authorization: false, id_user: 'a', email: null },
      { id_task: 11, is_sequential: true, display_order: 1, is_authorization: true, id_user: null, email: null },
      { id_task: 12, is_sequential: false, display_order: 5, is_authorization: false, id_user: 'b', email: null },
      { id_task: 13, is_sequential: false, display_order: 6, is_authorization: false, id_user: null, email: null },
      { id_task: 14, is_sequential: false, display_order: 7, is_authorization: false, id_user: 'c', email: null },
      { id_task: 15, is_sequential: false, display_order: 8, is_authorization: false, id_user: 'd', email: null },
    ];
    const conds = [{ id_task: 14, id_option: 900 }, { id_task: 15, id_option: 901 }];
    const ids = selectInitialTasks(rows, conds, [901]).map((r) => r.id_task);
    // 11: primera secuencial (autorización sin responsable → igual se crea)
    // 10: secuencial no primera → diferida; 13: normal sin responsable → omitida
    // 14: condicionada a opción no elegida → omitida; 15: condicionada y elegida
    expect(ids).toEqual([11, 12, 15]);
  });

  it('kronos_create_request ya NO crea todas las tareas del flujo de una vez', async () => {
    mock.rawResolvers = [
      (q) => {
        const t = q.text.replace(/\s+/g, ' ');
        if (/SELECT TOP 1 1 AS ok/.test(t)) return [{ ok: 1 }];
        if (/INSERT INTO requests_general/.test(t)) return [{ id: 6001 }];
        if (/FROM task_process_category tpc LEFT JOIN user_task_request_general/.test(t)) return DEFAULT_TEMPLATES;
        return undefined;
      },
    ];
    const admin: AuthScope = { agent: 'horus', role: 'admin', allCompanies: true, companyIds: [] };
    const client = await connectClient(buildServer(admin));
    const r = await callJson(client, 'kronos_create_request', {
      companyId: 3, subject: 'x', description: 'y', requesterUserId: 'u1', id_process_category: 126,
    });
    expect(r.isError).toBeFalsy();
    expect((r.data as { tasksCreated: number }).tasksCreated).toBe(1);
    expect(inserts(/INSERT INTO task_request_general/)).toHaveLength(1);
  });
});

describe('descripción estructurada', () => {
  it('cabe en NVARCHAR(1000) y conserva sistema y marca del agente', () => {
    const d = buildDescription({
      sistema: 'SharePoint',
      para_que: 'p'.repeat(900),
      datos: 'd'.repeat(900),
      solo_lectura: false,
      agentName: 'Galileo',
      agentCode: 'galileo',
      requesterEmail: 'a@b.co',
    });
    expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(parseSistemaLine(d)).toBe('sharepoint');
    expect(d).toMatch(/\[agente:galileo\]$/);
    expect(d).toMatch(/Acceso: Lectura y escritura/);
  });
});

describe('lista blanca de herramientas (MCP en memoria)', () => {
  it('una key restringida solo ve kronos_request_ia_access', async () => {
    const client = await connectClient(buildServer());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([TOOL]);
  });

  it('una key restringida no puede llamar otras herramientas', async () => {
    const client = await connectClient(buildServer());
    const r = await callJson(client, 'kronos_create_request', {
      companyId: 3, subject: 'x', description: 'y', requesterUserId: 'u1', id_process_category: 126,
    });
    expect(r.isError).toBe(true);
    expect(inserts(/INSERT INTO/)).toHaveLength(0);
  });

  it('una key sin allowedTools (horus, nancy, test-local) sigue viendo las 30', async () => {
    const legacy: AuthScope = { agent: 'horus', role: 'admin', allCompanies: true, companyIds: [] };
    const client = await connectClient(buildMcpServer(legacy, noopAudit, { maxPageSize: 200, defaultPageSize: 50 }));
    const { tools } = await client.listTools();
    expect(tools.length).toBe(27);
    expect(tools.map((t) => t.name)).toContain('kronos_create_request');
    expect(tools.map((t) => t.name)).toContain(TOOL);
  });
});

describe('configuración de keys', () => {
  const env = (keys: unknown) => ({ MCP_API_KEYS: JSON.stringify(keys) }) as NodeJS.ProcessEnv;

  it('acepta allowedTools + agentCode y las keys viejas sin esos campos', () => {
    const cfg = loadConfig(
      env([
        { key: 'a'.repeat(20), agent: 'horus', companyIds: '*', role: 'admin' },
        { key: 'b'.repeat(20), agent: 'galileo', companyIds: [3], role: 'agent', allowedTools: [TOOL], agentCode: 'galileo' },
      ])
    );
    expect(cfg.apiKeys[0]!.allowedTools).toBeUndefined();
    expect(cfg.apiKeys[1]!.allowedTools).toEqual([TOOL]);
    expect(cfg.apiKeys[1]!.agentCode).toBe('galileo');
  });

  it('rechaza una key con kronos_request_ia_access sin agentCode', () => {
    expect(() =>
      loadConfig(env([{ key: 'b'.repeat(20), agent: 'galileo', companyIds: [3], allowedTools: [TOOL] }]))
    ).toThrow(/agentCode/);
  });

  it('createApp no arranca con una herramienta desconocida en allowedTools', () => {
    const cfg: McpConfig = {
      port: 0, maxPageSize: 200, defaultPageSize: 50, auditLogFile: '/tmp/x.log',
      apiKeys: [{ key: 'c'.repeat(40), agent: 'x', companyIds: [3], role: 'agent', allowedTools: ['kronos_inventada'], agentCode: 'x' }],
    };
    expect(() => createApp(cfg, noopAudit)).toThrow(/desconocida/);
  });
});

describe('lista blanca por HTTP directo', () => {
  const AGENT_KEY = 'g'.repeat(40);
  const LEGACY_KEY = 'h'.repeat(40);
  const denied: unknown[] = [];
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const cfg: McpConfig = {
      port: 0, maxPageSize: 200, defaultPageSize: 50, auditLogFile: '/tmp/kronos-mcp-test-audit.log',
      apiKeys: [
        { key: AGENT_KEY, agent: 'galileo', companyIds: [3], role: 'agent', allowedTools: [TOOL], agentCode: 'galileo' },
        { key: LEGACY_KEY, agent: 'test-local', companyIds: '*', role: 'admin' },
      ],
    };
    const app = createApp(cfg, { log: async (e) => { if (e.outcome === 'denied') denied.push(e); } });
    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const post = (key: string, body: unknown) =>
    fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });

  async function listNames(key: string): Promise<string[]> {
    const res = await post(key, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const text = await res.text();
    const json = text.trim().startsWith('{') ? text : (text.split('\n').find((l) => l.startsWith('data:')) ?? '').slice(5);
    return (JSON.parse(json) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
  }

  it('tools/call de otra herramienta con la key restringida → 403 y auditoría denied', async () => {
    const res = await post(AGENT_KEY, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'kronos_create_request', arguments: { companyId: 3, subject: 'x', description: 'y', requesterUserId: 'u', id_process_category: 1 } },
    });
    expect(res.status).toBe(403);
    expect(denied.length).toBeGreaterThan(0);
  });

  it('también en lote JSON-RPC', async () => {
    const res = await post(AGENT_KEY, [
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: TOOL, arguments: {} } },
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'kronos_list_users', arguments: {} } },
    ]);
    expect(res.status).toBe(403);
  });

  it('tools/list por HTTP: la restringida ve 1, la vieja ve 30', async () => {
    expect(await listNames(AGENT_KEY)).toEqual([TOOL]);
    expect((await listNames(LEGACY_KEY)).length).toBe(27);
  });
});
