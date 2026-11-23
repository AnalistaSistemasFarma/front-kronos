import { describe, expect, it } from 'vitest';
import {
  classifyConnector,
  countSkills,
  inventoryAlerts,
  safeConnectorTarget,
  splitWriteTools,
  summarizeToolRules,
  type AuthorizedClient,
  type InventoryConnector,
  type InventoryScan,
} from './inventory-rules';
import { parseAgentCodeParam } from './rules';

const NOW = new Date('2026-11-09T15:00:00Z');

const connector = (name: string, over: Partial<InventoryConnector> = {}): InventoryConnector => ({
  name,
  transport: 'stdio',
  host: null,
  company: null,
  access: 'lectura',
  auth: 'local',
  writeTools: [],
  classification: classifyConnector({ name }),
  ...over,
});

const scan = (over: Partial<InventoryScan> = {}): InventoryScan => ({
  scannedAt: '2026-11-08T03:00:00Z',
  kind: 'claude-code',
  host: 'Mac de Horus',
  model: 'claude',
  serviceStatus: 'activo',
  execMode: 'con-aprobacion',
  execRequiresApproval: true,
  allowCount: 3,
  denyCount: 1,
  deny: ['rm'],
  skillsCount: 2,
  scanError: null,
  connectors: [],
  ...over,
});

const client = (over: Partial<AuthorizedClient> = {}): AuthorizedClient => ({
  saved: true,
  allCompanies: false,
  companyIds: [1],
  permissionCodes: ['kronos_list_requests'],
  ...over,
});

const NAMES = new Map([
  [1, 'GSS'],
  [2, 'Farmalógica'],
]);
const codes = (alerts: { code: string }[]) => alerts.map((a) => a.code).sort();

describe('classifyConnector', () => {
  it.each([
    ['kronos-synerlink', 'synerlink'],
    ['synerlink-solicitud-zoe', 'synerlink'],
    ['Synerlink-Solicitud-galileo', 'synerlink'],
    ['sapbo-farmalogica', 'gss'],
    ['sap-ryan', 'gss'],
    ['sapsend-gss', 'gss'],
    ['sharepoint-gss', 'gss'],
    ['powerautomate', 'local'],
    ['outlook', 'local'],
    ['lectorexcel-ventas', 'local'],
    ['kronos-synerlink-copia', 'local'],
    ['playwright', 'local'],
  ])('%s → %s', (name, expected) => {
    expect(classifyConnector({ name })).toBe(expected);
  });
});

describe('safeConnectorTarget', () => {
  it('deja solo esquema + host (+ puerto) de un HTTP', () => {
    expect(safeConnectorTarget('https://user:clave@mcp.gss.local:3020/mcp?token=abc', 'http')).toBe('https://mcp.gss.local:3020');
    expect(safeConnectorTarget('mcp.gss.local/mcp', 'sse')).toBe('https://mcp.gss.local');
  });

  it('nada para stdio, vacíos o lo que no es una URL limpia', () => {
    expect(safeConnectorTarget('/Users/horus/bin/servidor --key=xyz', 'stdio')).toBeNull();
    expect(safeConnectorTarget(null, 'http')).toBeNull();
    expect(safeConnectorTarget('ftp://servidor', 'http')).toBeNull();
    expect(safeConnectorTarget('ho st con espacios', 'http')).toBeNull();
  });
});

describe('JSON del inventario', () => {
  it('resume allow/deny y cuenta skills; tolera basura', () => {
    expect(summarizeToolRules('{"allow":["a","b"],"deny":["c"]}')).toEqual({ allowCount: 2, denyCount: 1, deny: ['c'] });
    expect(summarizeToolRules('no-json')).toEqual({ allowCount: 0, denyCount: 0, deny: [] });
    expect(summarizeToolRules(null)).toEqual({ allowCount: 0, denyCount: 0, deny: [] });
    expect(countSkills('["x","y",3]')).toBe(2);
    expect(countSkills('{}')).toBe(0);
    expect(splitWriteTools('a, b,,c ')).toEqual(['a', 'b', 'c']);
    expect(splitWriteTools(null)).toEqual([]);
  });
});

describe('inventoryAlerts', () => {
  it('sin escaneo lo dice explícito', () => {
    const companies = [{ id: 1, name: 'GSS', isPrimary: true }];
    expect(codes(inventoryAlerts({ scan: null, companies }, client(), NAMES, NOW))).toEqual(['sin-escaneo']);
  });

  it('escaneo de más de 7 días y con error', () => {
    const a = inventoryAlerts({ scan: scan({ scannedAt: '2026-10-30T00:00:00Z', scanError: 'x' }), companies: [{ id: 1, name: 'GSS', isPrimary: true }] }, client({ permissionCodes: [] }), NAMES, NOW);
    expect(codes(a)).toEqual(['error-escaneo', 'escaneo-viejo']);
  });

  it('conector de SynerLink sin cliente guardado / sin permisos', () => {
    const view = { scan: scan({ connectors: [connector('kronos-synerlink', { transport: 'http' })] }), companies: [] };
    expect(codes(inventoryAlerts(view, null, NAMES, NOW))).toContain('synerlink-sin-cliente');
    expect(codes(inventoryAlerts(view, client({ saved: false }), NAMES, NOW))).toContain('synerlink-sin-cliente');
    expect(codes(inventoryAlerts(view, client({ permissionCodes: [] }), NAMES, NOW))).toContain('synerlink-sin-permisos');
    expect(codes(inventoryAlerts(view, client(), NAMES, NOW))).not.toContain('synerlink-sin-permisos');
  });

  it('permisos marcados sin el conector de SynerLink (caso Zoe)', () => {
    const zoe = scan({
      execMode: 'sin-aprobacion',
      execRequiresApproval: false,
      connectors: ['powerautomate', 'powerautomate-gss', 'teams-desarrollo', 'zoe-flujos'].map((n) => connector(n)),
    });
    const a = inventoryAlerts({ scan: zoe, companies: [{ id: 1, name: 'GSS', isPrimary: true }] }, client(), NAMES, NOW);
    expect(codes(a)).toEqual(['permisos-sin-conector', 'sin-aprobacion']);
    expect(a[0]?.code).toBe('sin-aprobacion'); // las de severidad alta primero
  });

  it('conectores con escritura', () => {
    const a = inventoryAlerts(
      { scan: scan({ connectors: [connector('n8n-mcp', { access: 'escritura', writeTools: ['crear_flujo'] })] }), companies: [] },
      client({ permissionCodes: [] }),
      NAMES,
      NOW
    );
    expect(a.find((x) => x.code === 'conector-escritura')?.message).toContain('crear_flujo');
  });

  it('empresas del agente fuera del cliente y viceversa; «todas» no alerta', () => {
    const view = {
      scan: scan({ connectors: [connector('sapbo-farmalogica', { company: 'Farmalogica', transport: 'http' })] }),
      companies: [{ id: 2, name: 'Farmalógica', isPrimary: true }],
    };
    const a = inventoryAlerts(view, client({ companyIds: [1], permissionCodes: [] }), NAMES, NOW);
    expect(a.filter((x) => x.code === 'empresa-no-autorizada')).toHaveLength(2);
    expect(a.find((x) => x.code === 'empresa-sin-agente')?.message).toContain('GSS');
    expect(codes(inventoryAlerts(view, client({ companyIds: [1, 2], permissionCodes: [] }), NAMES, NOW))).not.toContain('empresa-no-autorizada');
    expect(codes(inventoryAlerts(view, client({ allCompanies: true, companyIds: [], permissionCodes: [] }), NAMES, NOW))).toEqual([]);
  });
});

describe('parseAgentCodeParam', () => {
  it('acepta códigos válidos y rechaza el resto', () => {
    expect(parseAgentCodeParam('Zoe')).toBe('zoe');
    expect(parseAgentCodeParam('galileo_2')).toBe('galileo_2');
    expect(parseAgentCodeParam('../x')).toBeNull();
    expect(parseAgentCodeParam('')).toBeNull();
    expect(parseAgentCodeParam(undefined)).toBeNull();
    expect(parseAgentCodeParam('a'.repeat(61))).toBeNull();
  });
});
