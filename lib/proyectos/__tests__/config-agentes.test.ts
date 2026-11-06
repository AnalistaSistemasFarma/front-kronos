import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Configuración de «Proyectos» por empresa (2026-10-20) — base y rutas.
 *   - Lectura: tabla ausente → .env (el código puede salir antes que el DDL);
 *     cualquier otro error → nadie habilitado (falla cerrado).
 *   - Permiso: solo el subproceso /process/proyectos/configuracion EN ESA
 *     empresa, o la administración de SynerLink. Sin él: 403.
 *   - Escritura: motivo obligatorio; sin puente → 409; la primera vez de una
 *     empresa copia el .env y lo registra; cada cambio deja su registro.
 *   - Puertas del módulo: con la empresa configurada, manda la tabla.
 */
const sessionUser = vi.hoisted(() => vi.fn());
const isAdmin = vi.hoisted(() => vi.fn());
const db = vi.hoisted(() => ({
  configFindMany: vi.fn(),
  configCreate: vi.fn(),
  configUpsert: vi.fn(),
  logCreate: vi.fn(),
  logFindMany: vi.fn(),
  agentCompanyFindUnique: vi.fn(),
  agentCompanyFindMany: vi.fn(),
  companyFindMany: vi.fn(),
  sucFindMany: vi.fn(),
  userFindMany: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('../../../app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../access-control', () => ({ checkAdminPrivileges: isAdmin }));
vi.mock('../../prisma', () => {
  const tx = {
    chatProjectAgentConfig: { findMany: db.configFindMany, create: db.configCreate, upsert: db.configUpsert },
    chatProjectAgentConfigLog: { create: db.logCreate },
    agentCompany: { findMany: db.agentCompanyFindMany },
  };
  return {
    prisma: {
      ...tx,
      chatProjectAgentConfigLog: { create: db.logCreate, findMany: db.logFindMany },
      agentCompany: { findUnique: db.agentCompanyFindUnique, findMany: db.agentCompanyFindMany },
      company: { findMany: db.companyFindMany },
      subprocessUserCompany: { findMany: db.sucFindMany },
      user: { findMany: db.userFindMany },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
  };
});
vi.mock('../../chat/http', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../chat/http')>();
  return { ...real, resolveSessionUser: sessionUser };
});

import { NextRequest } from 'next/server';
import { GET, POST } from '../../../app/api/proyectos/configuracion/route';
import { cargarConfigProyectos, invalidarConfigProyectos, tablaNoExiste } from '../config-agentes';
import { __resetProjectAgentsCache } from '../../chat/projects-rules';

const ANA = { id: 'u-ana', email: 'ana@gsslatam.com' };
const OLP = 3;
const PLAY = 21;
const HORUS = 1;
const LLAVE = 'x'.repeat(40);

const get = (q = '') => new NextRequest(`http://x/api/proyectos/configuracion${q}`);
const post = (body: unknown) =>
  new NextRequest('http://x/api/proyectos/configuracion', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const cambio = (over: Record<string, unknown> = {}) => ({ company: OLP, idAgent: PLAY, enabled: false, profiles: ['olp'], reason: 'Comex ya no lo usa', ...over });
const conPermisoEn = (...ids: number[]) =>
  db.sucFindMany.mockResolvedValue(ids.map((id) => ({ companyUser: { company: { id_company: id, company: `Empresa ${id} ` } } })));

beforeEach(() => {
  vi.clearAllMocks();
  invalidarConfigProyectos();
  __resetProjectAgentsCache();
  process.env.CHAT_PROJECTS_AGENTS = '{"play":["olp","comex-latam"],"horus":["gss"]}';
  process.env.CHAT_AGENT_API_KEYS = JSON.stringify([
    { key: `${LLAVE}a`, agent: 'play', scope: 'projects' },
    { key: `${LLAVE}b`, agent: 'horus', scope: 'channel' },
  ]);
  delete process.env.CHAT_AGENT_API_KEYS_FILE;
  sessionUser.mockResolvedValue(ANA);
  isAdmin.mockResolvedValue(false);
  conPermisoEn(OLP);
  db.configFindMany.mockResolvedValue([]);
  db.logFindMany.mockResolvedValue([]);
  db.userFindMany.mockResolvedValue([]);
  db.agentCompanyFindUnique.mockResolvedValue({ agent: { code: 'play', is_active: true } });
  db.agentCompanyFindMany.mockResolvedValue([
    { agent: { id_agent: PLAY, code: 'play', display_name: 'Play', handle: null, avatar_url: null, avatar_updated_at: null, sort_order: 1 } },
    { agent: { id_agent: HORUS, code: 'horus', display_name: 'Orus', handle: null, avatar_url: null, avatar_updated_at: null, sort_order: 0 } },
  ]);
});

describe('lectura de la configuración', () => {
  it('tabla ausente (código antes que el DDL): manda el .env, como hoy', async () => {
    db.configFindMany.mockRejectedValue(Object.assign(new Error('The table `dbo.chat_project_agent_config` does not exist'), { code: 'P2021' }));
    const c = await cargarConfigProyectos();
    expect(c.perfiles('play', OLP)).toEqual(['olp', 'comex-latam']);
  });

  it('otro error de la base: nadie habilitado (falla cerrado)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.configFindMany.mockRejectedValue(new Error('timeout'));
    const c = await cargarConfigProyectos();
    expect(c.habilitadoEnAlguna('play')).toBe(false);
    err.mockRestore();
  });

  it('reconoce la tabla ausente por Prisma (P2021) y por SQL Server (208)', () => {
    expect(tablaNoExiste({ code: 'P2021' })).toBe(true);
    expect(tablaNoExiste(new Error("Invalid object name 'dbo.chat_project_agent_config'."))).toBe(true);
    expect(tablaNoExiste(new Error('Login failed'))).toBe(false);
  });

  it('con filas, manda la tabla en esa empresa', async () => {
    db.configFindMany.mockResolvedValue([{ id_company: OLP, id_agent: PLAY, enabled: false, profiles: 'olp', agent: { code: 'play' } }]);
    const c = await cargarConfigProyectos();
    expect(c.habilitado('play', OLP)).toBe(false);
    expect(c.habilitado('horus', OLP)).toBe(false);
    expect(c.habilitado('play', 8)).toBe(true);
  });
});

describe('GET /api/proyectos/configuracion', () => {
  it('sin sesión: 401', async () => {
    sessionUser.mockResolvedValue(null);
    expect((await GET(get())).status).toBe(401);
  });

  it('lista solo las empresas donde tiene el permiso de configurar', async () => {
    const res = await GET(get());
    expect(await res.json()).toEqual({ admin: false, companies: [{ idCompany: OLP, companyName: 'Empresa 3' }] });
    expect(db.sucFindMany.mock.calls[0][0].where.subprocess).toEqual({ subprocess_url: '/process/proyectos/configuracion' });
  });

  it('la administración ve todas las empresas sin asignarse el permiso', async () => {
    isAdmin.mockResolvedValue(true);
    db.companyFindMany.mockResolvedValue([{ id_company: 1, company: 'GSS' }, { id_company: OLP, company: 'OLP' }]);
    const body = await (await GET(get())).json();
    expect(body.admin).toBe(true);
    expect(body.companies).toHaveLength(2);
    expect(db.sucFindMany).not.toHaveBeenCalled();
  });

  it('otra empresa: 403 y no se lee nada de ella', async () => {
    const res = await GET(get('?company=8'));
    expect(res.status).toBe(403);
    expect(db.agentCompanyFindMany).not.toHaveBeenCalled();
  });

  it('su empresa: agentes con estado efectivo, perfiles del .env y puente', async () => {
    const res = await GET(get(`?company=${OLP}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.origen).toBe('env');
    expect(body.tablaLista).toBe(true);
    expect(body.agentes.map((a: { code: string }) => a.code)).toEqual(['horus', 'play']);
    const play = body.agentes.find((a: { code: string }) => a.code === 'play');
    expect(play).toMatchObject({ habilitado: true, perfiles: ['olp', 'comex-latam'], puente: true, configurado: false });
    // Orus solo tiene llave del bot vivo ('channel'): sin puente de proyectos → solo lectura en la pantalla.
    expect(body.agentes.find((a: { code: string }) => a.code === 'horus').puente).toBe(false);
  });
});

describe('POST /api/proyectos/configuracion', () => {
  it('sin motivo: 400 y no escribe', async () => {
    const res = await POST(post(cambio({ reason: '' })));
    expect(res.status).toBe(400);
    expect(db.configUpsert).not.toHaveBeenCalled();
  });

  it('empresa sin permiso: 403 y no escribe', async () => {
    const res = await POST(post(cambio({ company: 8 })));
    expect(res.status).toBe(403);
    expect(db.configUpsert).not.toHaveBeenCalled();
  });

  it('agente sin puente de proyectos: 409 (solo lectura)', async () => {
    db.agentCompanyFindUnique.mockResolvedValue({ agent: { code: 'horus', is_active: true } });
    const res = await POST(post(cambio({ idAgent: HORUS })));
    expect(res.status).toBe(409);
    expect(db.configUpsert).not.toHaveBeenCalled();
  });

  it('agente que no es de la empresa: 404', async () => {
    db.agentCompanyFindUnique.mockResolvedValue(null);
    expect((await POST(post(cambio()))).status).toBe(404);
  });

  it('primera vez de la empresa: copia el .env de los demás, registra todo y luego el cambio', async () => {
    db.agentCompanyFindMany.mockResolvedValue([
      { agent: { id_agent: PLAY, code: 'play' } },
      { agent: { id_agent: HORUS, code: 'horus' } },
    ]);
    const res = await POST(post(cambio()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, copiados: 1 });

    // Orus (habilitado por el .env) queda copiado tal cual: nada se apaga sin que alguien lo decida.
    expect(db.configCreate).toHaveBeenCalledTimes(1);
    expect(db.configCreate.mock.calls[0][0].data).toMatchObject({ id_company: OLP, id_agent: HORUS, enabled: true, profiles: 'gss', updated_by: ANA.id });
    expect(db.logCreate.mock.calls[0][0].data).toMatchObject({ id_agent: HORUS, action: 'copia_env', enabled_after: true });

    // El cambio pedido, con el ANTES que decía el .env.
    expect(db.configUpsert.mock.calls[0][0].update).toMatchObject({ enabled: false, profiles: 'olp', reason: 'Comex ya no lo usa', updated_by: ANA.id });
    expect(db.logCreate.mock.calls[1][0].data).toMatchObject({
      id_company: OLP,
      id_agent: PLAY,
      action: 'cambio',
      enabled_before: true,
      enabled_after: false,
      profiles_before: 'olp,comex-latam',
      profiles_after: 'olp',
      reason: 'Comex ya no lo usa',
      changed_by: ANA.id,
    });
  });

  it('empresa ya configurada: no copia; sin cambios reales responde 400', async () => {
    db.configFindMany.mockResolvedValue([{ id_agent: PLAY, enabled: true, profiles: 'olp' }]);
    const res = await POST(post(cambio()));
    expect(res.status).toBe(200);
    expect(db.configCreate).not.toHaveBeenCalled();
    expect(db.logCreate).toHaveBeenCalledTimes(1);
    expect(db.logCreate.mock.calls[0][0].data).toMatchObject({ enabled_before: true, enabled_after: false });

    db.configFindMany.mockResolvedValue([{ id_agent: PLAY, enabled: false, profiles: 'olp' }]);
    const igual = await POST(post(cambio()));
    expect(igual.status).toBe(400);
  });

  it('tras guardar, la configuración nueva se ve de inmediato (caché invalidada)', async () => {
    expect((await cargarConfigProyectos()).habilitado('play', OLP)).toBe(true);
    db.configFindMany.mockResolvedValueOnce([]);
    await POST(post(cambio()));
    db.configFindMany.mockResolvedValue([{ id_company: OLP, id_agent: PLAY, enabled: false, profiles: 'olp', agent: { code: 'play' } }]);
    expect((await cargarConfigProyectos()).habilitado('play', OLP)).toBe(false);
  });
});
