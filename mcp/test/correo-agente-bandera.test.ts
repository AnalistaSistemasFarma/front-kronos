/**
 * Bandera CORREO_AGENTE_HABILITADO (apagada por defecto): sin «true» kronos-mcp no registra las
 * herramientas correo_* y kronos_metadata reporta 44. Con «true», las 49 (resto de la suite).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools, TOOL_CAPABILITIES } from '../src/tools/index.js';
import { CORREO_AGENTE_TOOLS, correoAgenteHabilitado } from '../src/tools/correoAgente.js';
import { setPrisma } from '../src/db.js';
import type { AuthScope } from '../src/auth.js';
import { connectClient, createMockPrisma } from './helpers.js';

const noopAudit = { log: async () => {} };
const ADMIN: AuthScope = { agent: 'horus', role: 'admin', allCompanies: true, companyIds: [] };

async function nombres(): Promise<string[]> {
  // @ts-expect-error mock parcial compatible para pruebas
  setPrisma(createMockPrisma());
  const server = new McpServer({ name: 'kronos-test', version: '0.0.0' });
  registerTools(server, { scope: ADMIN, audit: noopAudit, maxPageSize: 200, defaultPageSize: 50 });
  const client = await connectClient(server);
  const { tools } = await client.listTools();
  return tools.map((t) => t.name);
}

afterEach(() => vi.unstubAllEnvs());

describe('CORREO_AGENTE_HABILITADO', () => {
  it('solo «true» enciende (vacío, false u otro valor = apagado)', () => {
    expect(correoAgenteHabilitado({})).toBe(false);
    expect(correoAgenteHabilitado({ CORREO_AGENTE_HABILITADO: 'false' })).toBe(false);
    expect(correoAgenteHabilitado({ CORREO_AGENTE_HABILITADO: '1' })).toBe(false);
    expect(correoAgenteHabilitado({ CORREO_AGENTE_HABILITADO: ' TRUE ' })).toBe(true);
  });

  it('apagada: 44 herramientas y ninguna correo_*', async () => {
    vi.stubEnv('CORREO_AGENTE_HABILITADO', 'false');
    const n = await nombres();
    expect(n.length).toBe(44);
    expect(n.some((x) => x.startsWith('correo_'))).toBe(false);
    expect(TOOL_CAPABILITIES.totalTools).toBe(44);
  });

  it('encendida: 49, con las 5 correo_*', async () => {
    vi.stubEnv('CORREO_AGENTE_HABILITADO', 'true');
    const n = await nombres();
    expect(n.length).toBe(49);
    for (const t of CORREO_AGENTE_TOOLS) expect(n).toContain(t);
    expect(TOOL_CAPABILITIES.totalTools).toBe(49);
  });
});
