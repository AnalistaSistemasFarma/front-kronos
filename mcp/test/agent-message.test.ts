/**
 * chat_enviar_mensaje_usuario: agent-initiated message to a person (2026-11-24).
 * Prisma is mocked (helpers.ts): no real database.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from '../src/tools/index.js';
import {
  AGENT_MESSAGE_TOOL,
  agentMessageEnabled,
  loadAgentMessageLimits,
  loadNotifyConfig,
  parseRecipient,
  requestPush,
} from '../src/tools/agentMessage.js';
import { setPrisma } from '../src/db.js';
import type { AuthScope } from '../src/auth.js';
import { scopeFromDbEntry } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { KNOWN_TOOLS } from '../src/server.js';
import { createMockPrisma, connectClient, callJson, type MockPrisma, type CapturedRawQuery } from './helpers.js';

const noopAudit = { log: async () => {} };
const TOOL = AGENT_MESSAGE_TOOL;

const vega: AuthScope = {
  agent: 'proy-vega',
  role: 'reader',
  allCompanies: false,
  companyIds: [3],
  allowedTools: ['kronos_list_requests', TOOL],
  agentCode: 'vega',
};

const ARGS = {
  destinatario: 'Mauricio.Duque@OneLatamPharma.com',
  texto: '¡Hola, Mauricio! Ya tiene **acceso a SAP**.',
  motivo: 'Avisar que ya tiene acceso a SAP, pedido por Nicolás Rivera',
};

interface Scenario {
  agent?: unknown[];
  users?: unknown[];
  grants?: { id_company: number }[];
  module?: number;
  counts?: { por_agente: number; por_destinatario: number };
  existing?: { id: number }[];
}

let mock: MockPrisma;

function scenario(s: Scenario) {
  const norm = (q: CapturedRawQuery) => q.text.replace(/\s+/g, ' ');
  mock.rawResolvers = [
    (q) => {
      const t = norm(q);
      if (/FROM agent a WHERE LOWER\(a\.code\)/.test(t))
        return s.agent ?? [{ id_agent: 23, code: 'vega', display_name: 'Paco', id_subprocess: 66 }];
      if (/FROM \[user\] u WHERE/.test(t))
        return s.users ?? [{ id: 'u-mauricio', name: 'Mauricio Duque', email: 'mauricio.duque@onelatampharma.com', isActive: true }];
      if (/SELECT DISTINCT cu\.id_company FROM subprocess_user_company suc/.test(t)) return s.grants ?? [{ id_company: 3 }];
      if (/INNER JOIN subprocess s ON s\.id_subprocess = suc\.id_subprocess/.test(t)) return [{ n: s.module ?? 1 }];
      if (/FROM chat_agent_initiated_message m/.test(t)) return [s.counts ?? { por_agente: 0, por_destinatario: 0 }];
      if (/FROM chat_conversation c WHERE c\.kind/.test(t)) return s.existing ?? [{ id: 900 }];
      if (/INSERT INTO chat_conversation/.test(t)) return [{ id: 901 }];
      if (/INSERT INTO chat_message/.test(t)) return [{ id: 7001 }];
      return undefined;
    },
  ];
}

function buildServer(scope: AuthScope = vega): McpServer {
  const server = new McpServer({ name: 'test', version: '1.0.0' });
  registerTools(server, { scope, audit: noopAudit, maxPageSize: 200, defaultPageSize: 50 });
  return server;
}

async function call(args: Record<string, unknown>, scope: AuthScope = vega) {
  const client = await connectClient(buildServer(scope));
  return callJson(client, TOOL, args);
}

const queries = (re: RegExp) =>
  [...mock.capturedRaw, ...mock.capturedWrite].filter((q) => re.test(q.text.replace(/\s+/g, ' ')));

const ENV_KEYS = ['CHAT_MCP_APP_URL', 'CHAT_MCP_NOTIFY_SECRET', 'MCP_AGENT_MESSAGE_DAILY_LIMIT', 'MCP_AGENT_MESSAGE_RECIPIENT_DAILY_LIMIT'];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  mock = createMockPrisma();
  // @ts-expect-error partial mock for tests
  setPrisma(mock);
  scenario({});
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('chat_enviar_mensaje_usuario — enabled per key only', () => {
  it('is not listed for a key without allowedTools (historical unrestricted keys)', async () => {
    const client = await connectClient(buildServer({ agent: 'horus', role: 'admin', allCompanies: true, companyIds: [] }));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).not.toContain(TOOL);
  });

  it('is not listed when the key does not list it, nor without agentCode', async () => {
    expect(agentMessageEnabled({ ...vega, allowedTools: ['kronos_list_requests'] })).toBe(false);
    expect(agentMessageEnabled({ ...vega, agentCode: undefined })).toBe(false);
    const client = await connectClient(buildServer({ ...vega, allowedTools: ['kronos_list_requests'] }));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).not.toContain(TOOL);
  });

  it('is listed for a key that lists it and has agentCode, with a Spanish description', async () => {
    const client = await connectClient(buildServer());
    const { tools } = await client.listTools();
    const t = tools.find((x) => x.name === TOOL);
    expect(t).toBeDefined();
    expect(t!.description).toMatch(/Mensaje iniciado por el asistente/);
  });

  it('is a known tool and the config rejects a key that lists it without agentCode', () => {
    expect(KNOWN_TOOLS.has(TOOL)).toBe(true);
    const keys = [{ key: 'k'.repeat(32), agent: 'x', companyIds: [3], allowedTools: [TOOL] }];
    expect(() => loadConfig({ MCP_API_KEYS: JSON.stringify(keys) } as NodeJS.ProcessEnv)).toThrow(/agentCode/);
  });

  it('a database key never gets the tool (file keys only for now), with or without agentCode', () => {
    for (const agentCode of [null, 'vega']) {
      const scope = scopeFromDbEntry({
        keyId: 1, keyHash: 'a'.repeat(64), clientId: 1, name: 'db', agentCode,
        allCompanies: false, companyIds: [3], allowedTools: [TOOL, 'kronos_list_requests'],
      });
      expect(scope.allowedTools).toEqual(['kronos_list_requests']);
    }
  });
});

describe('chat_enviar_mensaje_usuario — delivery', () => {
  it('posts an agent message in the existing direct conversation and writes the audit row', async () => {
    const r = await call(ARGS);
    expect(r.isError).toBeFalsy();
    const d = r.data as { status: string; id_mensaje: number; id_conversacion: number; conversacion_creada: boolean; notificacion_push: string };
    expect(d.status).toBe('enviado');
    expect(d.id_mensaje).toBe(7001);
    expect(d.id_conversacion).toBe(900);
    expect(d.conversacion_creada).toBe(false);
    expect(d.notificacion_push).toBe('sin_configurar');

    expect(queries(/INSERT INTO chat_conversation/)).toHaveLength(0);
    const msg = queries(/INSERT INTO chat_message/)[0]!;
    expect(msg.values).toContain(900);
    expect(msg.values).toContain('agent');
    expect(msg.values).toContain(23);
    expect(msg.values).toContain(ARGS.texto);

    const audit = queries(/INSERT INTO chat_agent_initiated_message/)[0]!;
    expect(audit.values.slice(0, 4)).toEqual([7001, 900, 23, 'u-mauricio']);
    expect(audit.values).toContain(ARGS.motivo);
    expect(audit.values).toContain('key:proy-vega');

    // The lookup of the conversation is anchored to direct + not archived + this agent.
    const conv = queries(/FROM chat_conversation c WHERE c\.kind/)[0]!;
    expect(conv.text).toMatch(/c\.archived = 0/);
    expect(conv.values).toEqual(['direct', 'u-mauricio', 23]);
    // Serialized per agent.
    expect(queries(/sp_getapplock/)[0]!.values).toContain('kronos-agent-message:23');
  });

  it('creates the direct conversation like the app when none exists', async () => {
    scenario({ existing: [] });
    const r = await call(ARGS);
    const d = r.data as { id_conversacion: number; conversacion_creada: boolean };
    expect(d.id_conversacion).toBe(901);
    expect(d.conversacion_creada).toBe(true);
    const ins = queries(/INSERT INTO chat_conversation/)[0]!;
    expect(ins.values.slice(0, 4)).toEqual(['u-mauricio', 23, 'Paco', 'direct']);
    expect(queries(/INSERT INTO chat_message/)[0]!.values).toContain(901);
  });

  it('accepts a user id as recipient', async () => {
    const r = await call({ ...ARGS, destinatario: 'cmkzz8pq50000kkzc29j72d3f' });
    expect(r.isError).toBeFalsy();
    expect(queries(/FROM \[user\] u WHERE u\.id =/)[0]!.values).toEqual(['cmkzz8pq50000kkzc29j72d3f']);
  });
});

describe('chat_enviar_mensaje_usuario — rejections write nothing', () => {
  const nothingWritten = () => {
    expect(queries(/INSERT INTO/)).toHaveLength(0);
  };

  it('recipient without the agent assigned → rejected', async () => {
    scenario({ grants: [] });
    const r = await call(ARGS);
    expect(r.isError).toBe(true);
    expect(String(r.data)).toMatch(/no tiene asignado el agente Paco/);
    nothingWritten();
  });

  it('recipient with the agent only in a company outside the key scope → rejected', async () => {
    scenario({ grants: [{ id_company: 5 }] });
    const r = await call(ARGS);
    expect(r.isError).toBe(true);
    nothingWritten();
  });

  it('recipient without the chat module → rejected', async () => {
    scenario({ module: 0 });
    const r = await call(ARGS);
    expect(r.isError).toBe(true);
    nothingWritten();
  });

  it('inactive or unknown recipient → rejected', async () => {
    scenario({ users: [{ id: 'u', name: 'X', email: 'x@y.co', isActive: false }] });
    let r = await call(ARGS);
    expect(String(r.data)).toMatch(/inactivo/);
    scenario({ users: [] });
    r = await call(ARGS);
    expect(String(r.data)).toMatch(/no existe un usuario/);
    nothingWritten();
  });

  it('inactive agent of the key → rejected', async () => {
    scenario({ agent: [] });
    const r = await call(ARGS);
    expect(r.isError).toBe(true);
    expect(String(r.data)).toMatch(/no existe, está inactivo/);
    nothingWritten();
  });

  it('daily limit per agent and per recipient (env-configurable)', async () => {
    scenario({ counts: { por_agente: 20, por_destinatario: 0 } });
    let r = await call(ARGS);
    expect(String(r.data)).toMatch(/tope 20/);

    process.env.MCP_AGENT_MESSAGE_RECIPIENT_DAILY_LIMIT = '2';
    scenario({ counts: { por_agente: 3, por_destinatario: 2 } });
    r = await call(ARGS);
    expect(r.isError).toBe(true);
    expect(String(r.data)).toMatch(/este destinatario.*tope 2/);
    nothingWritten();
  });

  it('blank text or short reason → rejected', async () => {
    let r = await call({ ...ARGS, texto: '   \n ' });
    expect(r.isError).toBe(true);
    r = await call({ ...ARGS, motivo: '  a   b ' });
    expect(r.isError).toBe(true);
    nothingWritten();
  });
});

describe('helpers', () => {
  it('parseRecipient', () => {
    expect(parseRecipient(' A@B.co ')).toEqual({ kind: 'email', value: 'a@b.co' });
    expect(parseRecipient('cmkzz8pq50000kkzc29j72d3f')).toEqual({ kind: 'id', value: 'cmkzz8pq50000kkzc29j72d3f' });
    expect(() => parseRecipient("x'; DROP TABLE user--")).toThrow();
    expect(() => parseRecipient('a@b')).toThrow();
  });

  it('limits default to 20 per agent and 5 per recipient', () => {
    expect(loadAgentMessageLimits({} as NodeJS.ProcessEnv)).toEqual({ perAgent: 20, perRecipient: 5 });
    expect(loadAgentMessageLimits({ MCP_AGENT_MESSAGE_DAILY_LIMIT: '7', MCP_AGENT_MESSAGE_RECIPIENT_DAILY_LIMIT: 'x' } as NodeJS.ProcessEnv)).toEqual({ perAgent: 7, perRecipient: 5 });
  });

  it('push config requires a URL and a strong secret; the secret travels in a header only', async () => {
    expect(loadNotifyConfig({ CHAT_MCP_APP_URL: 'http://127.0.0.1:3030', CHAT_MCP_NOTIFY_SECRET: 'short' } as NodeJS.ProcessEnv)).toBeNull();
    const cfg = loadNotifyConfig({ CHAT_MCP_APP_URL: 'http://127.0.0.1:3030/', CHAT_MCP_NOTIFY_SECRET: 's'.repeat(40) } as NodeJS.ProcessEnv)!;
    expect(cfg.url).toBe('http://127.0.0.1:3030/api/chat/agent/initiated-notify');
    let seen: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    expect(await requestPush(7001, cfg, fake)).toBe('enviado');
    expect(seen!.init.body).toBe(JSON.stringify({ idMessage: 7001 }));
    expect((seen!.init.headers as Record<string, string>)['x-chat-mcp-secret']).toBe('s'.repeat(40));
    const failing = (async () => new Response('no', { status: 403 })) as unknown as typeof fetch;
    expect(await requestPush(7001, cfg, failing)).toBe('fallo');
    const throwing = (async () => { throw new Error('down'); }) as unknown as typeof fetch;
    expect(await requestPush(7001, cfg, throwing)).toBe('fallo');
  });
});
