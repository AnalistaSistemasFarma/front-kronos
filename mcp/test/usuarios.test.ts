/**
 * kronos_usuarios_consultar / kronos_usuarios_crear (2026-10-22, solicitud #6283).
 * Prisma mockeado (helpers.ts): no requiere base real.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { setPrisma } from '../src/db.js';
import type { AuthScope } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { buildMcpServer } from '../src/server.js';
import {
  registerUsuariosTools,
  subprocesoProhibido,
  generarContrasena,
  escaparLike,
  type VerificadorEntra,
} from '../src/tools/usuarios.js';
import { createMockPrisma, connectClient, callJson, type MockPrisma, type CapturedRawQuery } from './helpers.js';

const CONSULTAR = 'kronos_usuarios_consultar';
const CREAR = 'kronos_usuarios_crear';

const mechita: AuthScope = {
  agent: 'ia-mechita',
  role: 'agent',
  allCompanies: false,
  companyIds: [8],
  allowedTools: [CONSULTAR, CREAR],
  agentCode: 'mechita',
  usuarios: {
    solicitantes: ['nicolas.rojas@gsslatam.com'],
    companyIds: [8, 3],
    departmentIds: [8, 20],
    // 12 (Usuarios) y 45 (Asistente Mechita) están en la lista A PROPÓSITO: el candado
    // por URL / agente debe rechazarlos igual.
    subprocessIds: [13, 16, 12, 45, 72],
    dominios: ['gsslatam.com', 'onelatampharma.com'],
    maxPorHora: 3,
    maxPorDia: 10,
    exigirEntra: true,
  },
};

const horusLegacy: AuthScope = { agent: 'horus', role: 'admin', allCompanies: true, companyIds: [] };
const galileo: AuthScope = {
  agent: 'ia-galileo',
  role: 'agent',
  allCompanies: false,
  companyIds: [3],
  allowedTools: ['kronos_request_ia_access'],
  agentCode: 'galileo',
};

const ARGS = {
  solicitanteEmail: 'Nicolas.Rojas@gsslatam.com',
  nombre: 'Ana María Pérez Gómez',
  email: 'Ana.Perez@onelatampharma.com',
  companyId: 3,
  departmentIds: [8],
  subprocessIds: [13, 16],
};

const SUBPROCESOS: Record<number, { subprocess: string; subprocess_url: string; es_agente: number }> = {
  13: { subprocess: 'Mis Solicitudes', subprocess_url: '/process/request-general/my-requests', es_agente: 0 },
  16: { subprocess: 'Solicitudes Asignadas', subprocess_url: '/process/request-general/assigned', es_agente: 0 },
  12: { subprocess: 'Usuarios', subprocess_url: '/process/administration/users', es_agente: 0 },
  45: { subprocess: 'Asistente Mechita', subprocess_url: '/process/chat/mechita', es_agente: 1 },
  72: { subprocess: 'Auditoría de agentes', subprocess_url: '/process/chat/auditoria', es_agente: 0 },
};

interface Escenario {
  solicitanteActivo?: boolean;
  existe?: boolean;
  conteo?: { hora: number; dia: number };
}

let mock: MockPrisma;
let creados: { data: Record<string, unknown> }[];
const entraOk: VerificadorEntra = async () => ({ displayName: 'Ana María Pérez Gómez', accountEnabled: true, licencias: 1 });

function escenario(e: Escenario = {}) {
  const norm = (q: CapturedRawQuery) => q.text.replace(/\s+/g, ' ');
  mock.rawResolvers = [
    (q) => {
      const t = norm(q);
      if (/u\.isActive = 1/.test(t) && /SELECT TOP 1 u\.id FROM \[user\]/.test(t))
        return e.solicitanteActivo === false ? [] : [{ id: 'u-rojas' }];
      if (/FROM user_audit_log l WITH \(UPDLOCK, HOLDLOCK\)/.test(t)) return [e.conteo ?? { hora: 0, dia: 0 }];
      if (/SELECT TOP 1 u\.id FROM \[user\] u WHERE LOWER/.test(t)) return e.existe ? [{ id: 'u-existe' }] : [];
      if (/FROM company c WHERE c\.id_company/.test(t)) return [{ id_company: q.values[0], company: 'ONELATAMPHARMA' }];
      if (/FROM department d WHERE/.test(t))
        return q.values.map((v) => ({ id_department: v, department: `DEP ${String(v)}` }));
      if (/FROM subprocess s WHERE s\.id_subprocess IN/.test(t))
        return q.values.filter((v) => SUBPROCESOS[v as number]).map((v) => ({ id_subprocess: v, ...SUBPROCESOS[v as number] }));
      if (/INSERT INTO company_user/.test(t)) return [{ id_company_user: 900 }];
      return undefined;
    },
  ];
}

beforeEach(() => {
  mock = createMockPrisma();
  creados = [];
  // El tx del mock no trae modelos: se agrega user.create (id cuid simulado).
  mock.$transaction = async (fn) =>
    fn({
      $queryRaw: mock.$queryRaw,
      $executeRaw: mock.$executeRaw,
      user: {
        create: async (args: { data: Record<string, unknown> }) => {
          creados.push(args);
          return { id: 'cmnuevo0000000000000000' };
        },
      },
    });
  setPrisma(mock as never);
  escenario();
});

async function cliente(scope: AuthScope, entra: VerificadorEntra | null = entraOk, eventos: unknown[] = []) {
  const server = new McpServer({ name: 't', version: '1' });
  registerUsuariosTools(server, { scope, audit: { log: async (e) => void eventos.push(e) }, entra });
  return connectClient(server);
}

const sinEscrituras = () => {
  expect(creados).toHaveLength(0);
  expect(mock.capturedWrite).toHaveLength(0);
  expect(mock.capturedRaw.some((q) => /INSERT/i.test(q.text))).toBe(false);
};

describe('configuración de la llave', () => {
  const base = { key: 'k'.repeat(32), agent: 'ia-mechita', companyIds: [8], role: 'agent', agentCode: 'mechita' };
  const usuarios = { solicitantes: ['nicolas.rojas@gsslatam.com'], companyIds: [8], dominios: ['gsslatam.com'] };

  it('acepta una llave restringida con el bloque usuarios (y aplica valores por defecto)', () => {
    const cfg = loadConfig({ MCP_API_KEYS: JSON.stringify([{ ...base, allowedTools: [CONSULTAR, CREAR], usuarios }]) });
    expect(cfg.apiKeys[0]?.usuarios?.maxPorHora).toBe(3);
    expect(cfg.apiKeys[0]?.usuarios?.exigirEntra).toBe(true);
    expect(cfg.apiKeys[0]?.usuarios?.subprocessIds).toEqual([]);
  });

  it('rechaza el bloque usuarios en una llave sin lista blanca (allowedTools)', () => {
    expect(() => loadConfig({ MCP_API_KEYS: JSON.stringify([{ ...base, usuarios }]) })).toThrow(/allowedTools/);
  });

  it('rechaza listar kronos_usuarios_* sin el bloque usuarios', () => {
    expect(() => loadConfig({ MCP_API_KEYS: JSON.stringify([{ ...base, allowedTools: [CREAR] }]) })).toThrow(/usuarios/);
  });

  it('rechaza campos desconocidos en el bloque usuarios (p. ej. un rol)', () => {
    expect(() =>
      loadConfig({ MCP_API_KEYS: JSON.stringify([{ ...base, allowedTools: [CREAR], usuarios: { ...usuarios, rol: 'admin' } }]) })
    ).toThrow();
  });
});

describe('solo la llave del agente autorizado ve las herramientas', () => {
  const nombres = async (scope: AuthScope) => {
    const c = await connectClient(buildMcpServer(scope, { log: async () => {} }, { maxPageSize: 200, defaultPageSize: 50 }));
    return (await c.listTools()).tools.map((t) => t.name);
  };

  it('la llave con bloque usuarios ve las dos', async () => {
    expect((await nombres(mechita)).sort()).toEqual([CONSULTAR, CREAR]);
  });

  it('la llave histórica sin lista blanca (horus) NO las ve', async () => {
    const n = await nombres(horusLegacy);
    expect(n).not.toContain(CONSULTAR);
    expect(n).not.toContain(CREAR);
  });

  it('otra llave restringida (galileo) NO las ve', async () => {
    const n = await nombres(galileo);
    expect(n).toEqual(['kronos_request_ia_access']);
  });

  it('llamarlas con otra llave falla y no escribe nada', async () => {
    const c = await connectClient(buildMcpServer(horusLegacy, { log: async () => {} }, { maxPageSize: 200, defaultPageSize: 50 }));
    const r = (await c.callTool({ name: CREAR, arguments: ARGS })) as { isError?: boolean };
    expect(r.isError).toBe(true);
    sinEscrituras();
  });
});

describe('kronos_usuarios_crear — candados', () => {
  it('rechaza rol admin', async () => {
    const r = await callJson(await cliente(mechita), CREAR, { ...ARGS, rol: 'admin' });
    expect(r.isError).toBe(true);
    expect(String(r.data)).toMatch(/Solo se pueden crear usuarios con rol "user"/);
    sinEscrituras();
  });

  it('rechaza rol super_user aunque venga en mayúsculas', async () => {
    const r = await callJson(await cliente(mechita), CREAR, { ...ARGS, rol: 'SUPER_USER' });
    expect(r.isError).toBe(true);
    sinEscrituras();
  });

  it('rechaza el subproceso de administración de usuarios (12) aunque esté en la lista blanca', async () => {
    const r = await callJson(await cliente(mechita), CREAR, { ...ARGS, subprocessIds: [13, 12] });
    expect(r.isError).toBe(true);
    expect(String(r.data)).toMatch(/prohibidos/);
    expect(String(r.data)).toMatch(/12 Usuarios/);
    sinEscrituras();
  });

  it('rechaza subprocesos de agentes del chat y de auditoría de agentes', async () => {
    for (const s of [45, 72]) {
      mock.capturedRaw = [];
      const r = await callJson(await cliente(mechita), CREAR, { ...ARGS, subprocessIds: [s] });
      expect(r.isError).toBe(true);
      expect(String(r.data)).toMatch(/prohibidos/);
    }
    sinEscrituras();
  });

  it('rechaza subprocesos, departamentos y empresas fuera de la lista blanca sin tocar la base', async () => {
    for (const extra of [{ subprocessIds: [99] }, { departmentIds: [1] }, { companyId: 2 }]) {
      const r = await callJson(await cliente(mechita), CREAR, { ...ARGS, ...extra });
      expect(r.isError).toBe(true);
      expect(String(r.data)).toMatch(/no (está|están) en la lista|no permitid/);
    }
    expect(mock.capturedRaw).toHaveLength(0);
    sinEscrituras();
  });

  it('rechaza a un solicitante que no es el autorizado', async () => {
    const r = await callJson(await cliente(mechita), CREAR, { ...ARGS, solicitanteEmail: 'otra.persona@gsslatam.com' });
    expect(r.isError).toBe(true);
    expect(String(r.data)).toMatch(/no está autorizada/);
    sinEscrituras();
  });

  it('rechaza al solicitante autorizado si ya no está activo en SynerLink', async () => {
    escenario({ solicitanteActivo: false });
    const r = await callJson(await cliente(mechita), CREAR, ARGS);
    expect(r.isError).toBe(true);
    sinEscrituras();
  });

  it('rechaza correos mal formados, de otro dominio o ya existentes', async () => {
    for (const email of ['no-es-correo', 'ana@gmail.com']) {
      const r = await callJson(await cliente(mechita), CREAR, { ...ARGS, email });
      expect(r.isError).toBe(true);
    }
    escenario({ existe: true });
    const r = await callJson(await cliente(mechita), CREAR, ARGS);
    expect(r.isError).toBe(true);
    expect(String(r.data)).toMatch(/Ya existe/);
    sinEscrituras();
  });

  it('rechaza si el correo no está en Entra, está deshabilitado o no se puede verificar', async () => {
    const casos: (VerificadorEntra | null)[] = [
      async () => null,
      async () => ({ displayName: 'X', accountEnabled: false, licencias: 1 }),
      async () => ({ displayName: 'X', accountEnabled: true, licencias: 0 }),
      async () => {
        throw new Error('403');
      },
      null,
    ];
    for (const entra of casos) {
      const r = await callJson(await cliente(mechita, entra), CREAR, ARGS);
      expect(r.isError).toBe(true);
    }
    sinEscrituras();
  });

  it('respeta el tope por hora y por día', async () => {
    escenario({ conteo: { hora: 3, dia: 3 } });
    let r = await callJson(await cliente(mechita), CREAR, ARGS);
    expect(r.isError).toBe(true);
    expect(String(r.data)).toMatch(/por hora/);
    escenario({ conteo: { hora: 0, dia: 10 } });
    r = await callJson(await cliente(mechita), CREAR, ARGS);
    expect(r.isError).toBe(true);
    expect(String(r.data)).toMatch(/24 horas/);
    sinEscrituras();
  });
});

describe('kronos_usuarios_crear — creación', () => {
  it('crea con rol user, bcrypt 12, empresa/subprocesos/departamentos y bitácora con agente y solicitante', async () => {
    const eventos: unknown[] = [];
    const r = await callJson(await cliente(mechita, entraOk, eventos), CREAR, ARGS);
    expect(r.isError).toBeFalsy();
    const d = r.data as { status: string; contrasena_inicial: string; usuario: { correo: string; rol: string; subprocesos: unknown[] } };
    expect(d.status).toBe('creado');
    expect(d.usuario.correo).toBe('ana.perez@onelatampharma.com');
    expect(d.usuario.rol).toBe('user');
    expect(d.usuario.subprocesos).toHaveLength(2);
    expect(d.contrasena_inicial).toMatch(/^Syn-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}\*$/);

    expect(creados).toHaveLength(1);
    const data = creados[0]!.data;
    expect(data.role).toBe('user');
    expect(data.email).toBe('ana.perez@onelatampharma.com');
    expect(String(data.password)).toMatch(/^\$2[aby]\$12\$/);
    expect(await bcrypt.compare(d.contrasena_inicial, String(data.password))).toBe(true);

    const escrituras = mock.capturedWrite.map((q) => q.text.replace(/\s+/g, ' '));
    expect(escrituras.filter((t) => /INSERT INTO subprocess_user_company/.test(t))).toHaveLength(2);
    expect(escrituras.filter((t) => /INSERT INTO department_user/.test(t))).toHaveLength(1);
    const auditoria = mock.capturedWrite.filter((q) => /INSERT INTO user_audit_log/.test(q.text));
    expect(auditoria.length).toBe(3);
    for (const a of auditoria) {
      expect(a.values).toContain('agente:mechita (kronos-mcp) a pedido de nicolas.rojas@gsslatam.com');
    }
    expect(auditoria[0]!.text).toMatch(/'CREATE'/);

    // La contraseña en claro no viaja a la base ni a la auditoría del MCP.
    const todo = JSON.stringify([mock.capturedRaw, mock.capturedWrite, creados, eventos]);
    expect(todo).not.toContain(d.contrasena_inicial);
  });

  it('cada creación genera una contraseña distinta', () => {
    const set = new Set(Array.from({ length: 200 }, generarContrasena));
    expect(set.size).toBe(200);
  });
});

describe('kronos_usuarios_consultar', () => {
  it('no selecciona ni devuelve campos sensibles y filtra por las empresas de la llave', async () => {
    mock.rawResolvers = [
      (q) => {
        const t = q.text.replace(/\s+/g, ' ');
        if (/FROM \[user\] u WHERE/.test(t))
          return [{ id: 'u1', name: 'Ana Pérez', email: 'ana.perez@onelatampharma.com', isActive: true, role: 'user', createdAt: new Date(0), password: '$2b$12$hash', identification: '123' }];
        if (/FROM company_user cu INNER JOIN company c/.test(t))
          return [{ id_user: 'u1', id_company: 3, company: 'ONELATAMPHARMA' }, { id_user: 'u1', id_company: 2, company: 'RYAN' }];
        if (/FROM department_user du/.test(t)) return [{ id_user: 'u1', id_department: 8, department: 'COMERCIAL' }];
        if (/FROM agent a/.test(t)) return [{ id_user: 'u1', code: 'orion', display_name: 'Orion', company: 'ONELATAMPHARMA' }];
        return undefined;
      },
    ];
    const r = await callJson(await cliente(mechita), CONSULTAR, { texto: 'perez' });
    expect(r.isError).toBeFalsy();
    const salida = JSON.stringify(r.data);
    for (const prohibido of ['password', '$2b$', 'identification', 'phone', 'nit', 'token']) {
      expect(salida).not.toContain(prohibido);
    }
    const sel = mock.capturedRaw[0]!.text;
    expect(sel).not.toMatch(/password|identification|phone|nit\b/i);
    expect(sel).toMatch(/cs\.id_company IN/);
    expect(mock.capturedRaw[0]!.values).toEqual(expect.arrayContaining([8, 3]));
    const u = (r.data as { usuarios: { empresas: unknown[]; otras_empresas_fuera_de_alcance: number; agentes: unknown[] }[] }).usuarios[0]!;
    expect(u.empresas).toEqual([{ id: 3, empresa: 'ONELATAMPHARMA' }]);
    expect(u.otras_empresas_fuera_de_alcance).toBe(1);
    expect(u.agentes).toHaveLength(1);
    expect(mock.capturedWrite).toHaveLength(0);
  });

  it('rechaza una empresa fuera del alcance y la búsqueda sin criterio', async () => {
    let r = await callJson(await cliente(mechita), CONSULTAR, { companyId: 2 });
    expect(r.isError).toBe(true);
    r = await callJson(await cliente(mechita), CONSULTAR, {});
    expect(r.isError).toBe(true);
    expect(mock.capturedRaw).toHaveLength(0);
  });

  it('el texto viaja como parámetro y con los comodines de LIKE escapados', async () => {
    await callJson(await cliente(mechita), CONSULTAR, { texto: "x%' OR 1=1 --" });
    const q = mock.capturedRaw[0]!;
    expect(q.text).not.toContain('OR 1=1');
    expect(q.values).toContain("%x[%]' OR 1=1 --%");
    expect(escaparLike('a_b[c]')).toBe('a[_]b[[]c[]]');
  });
});

describe('subprocesoProhibido', () => {
  it('bloquea administración, chat, agentes, auditoría y permisos de agentes', () => {
    const casos = [
      '/process/administration/users',
      '/process/administration/users/inicios-sesion',
      '/process/chat',
      '/process/chat/personas',
      '/process/chat/auditoria/configurar',
      '/process/proyectos/permisos-agentes',
      '/process/request-general/admin-workflow',
    ];
    for (const url of casos) expect(subprocesoProhibido({ subprocess_url: url, subprocess: 'x', es_agente: 0 })).toBe(true);
    expect(subprocesoProhibido({ subprocess_url: '/process/x', subprocess: 'y', es_agente: 1 })).toBe(true);
    expect(subprocesoProhibido({ subprocess_url: '/process/request-general/my-requests', subprocess: 'Mis Solicitudes', es_agente: 0 })).toBe(false);
  });
});
