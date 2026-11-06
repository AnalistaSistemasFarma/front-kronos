import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Permisos de los agentes (2026-10-20) — las rejas del servidor:
 *   - ser DUEÑO del proyecto no alcanza para cambiarlos: administración o el subproceso en la empresa;
 *   - cada cambio exige motivo y queda en el registro con el antes y el después;
 *   - el catálogo lo administra solo la administración;
 *   - el API del puente exige la llave de scope "projects", omite repos desactivados y falla cerrado;
 *   - al crear un proyecto, pedir acceso a código sin permiso responde 403 y no crea nada.
 */
const h = vi.hoisted(() => {
  const db = {
    subprocessUserCompany: { findMany: vi.fn() },
    chatProjectRepoCatalog: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    chatProjectAgentPolicy: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    chatProjectAgentPolicyRepo: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    chatProjectAgentPolicyLog: { create: vi.fn(), findMany: vi.fn() },
    chatProject: { findMany: vi.fn(), create: vi.fn(), count: vi.fn() },
    chatProjectAgent: { findMany: vi.fn(), createMany: vi.fn() },
    agent: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return {
    db,
    sessionUser: vi.fn(),
    resolveProject: vi.fn(),
    admin: vi.fn(),
    agent: vi.fn(),
    assertConv: vi.fn(),
    moduleCompanies: vi.fn(),
    designables: vi.fn(),
  };
});

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('../../../app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../prisma', () => ({ prisma: h.db }));
vi.mock('../../access-control', () => ({ checkAdminPrivileges: h.admin }));
vi.mock('../../chat/http', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../chat/http')>();
  return { ...real, resolveSessionUser: h.sessionUser };
});
vi.mock('../../chat/projects', () => ({
  resolveProjectForUser: h.resolveProject,
  assertAgentProjectConversation: h.assertConv,
  whereProyectoDelAgente: (id: number) => ({ archived: false, agents: { some: { id_agent: id } } }),
  projectModuleCompanies: h.moduleCompanies,
  designableAgents: h.designables,
  listProjectsForUser: vi.fn(),
}));
vi.mock('../../chat/agent-auth', () => ({ authenticateAgent: h.agent }));
vi.mock('../equipo', () => ({ pedirSugerencia: vi.fn() }));
vi.mock('../estado-agente-servidor', () => ({ estadosTrabajandoVisibles: vi.fn(async () => []) }));

import { NextRequest } from 'next/server';
import { GET as verPermisos, PATCH as cambiarPermisos } from '../../../app/api/proyectos/[id]/permisos/route';
import { GET as opciones } from '../../../app/api/proyectos/permisos-agentes/route';
import { GET as verCatalogo, POST as agregarRepo } from '../../../app/api/proyectos/repositorios/route';
import { PATCH as cambiarRepo } from '../../../app/api/proyectos/repositorios/[idRepo]/route';
import { GET as politicaPuente } from '../../../app/api/chat/agent/projects/policy/route';
import { POST as crearProyecto } from '../../../app/api/proyectos/route';
import { POST as agregarAgentes } from '../../../app/api/proyectos/[id]/agentes/route';

const { db } = h;
const params = (id = '7') => ({ params: Promise.resolve({ id }) });
const req = (url: string, method = 'GET', body?: unknown) =>
  new NextRequest(`http://x${url}`, body !== undefined ? { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : { method });
const proyecto = (role: 'owner' | 'editor' | 'reader', archived = false) => ({ idProject: 7, name: 'SAPSEND', idCompany: 8, profile: 'gss', role, archived });
const repo = (slug: string, active = true, id = slug === 'sapsend' ? 2 : 1) => ({
  id_repo: id,
  slug,
  name: slug.toUpperCase(),
  github: slug === 'sapsend' ? 'gsslatam/sapsend' : 'AnalistaSistemasFarma/front-kronos',
  branch_testing: 'testing',
  branch_production: slug === 'sapsend' ? 'production' : 'main',
  description: null,
  active,
  updated_at: new Date('2026-10-20T18:00:00Z'),
});
const MOTIVO = 'Nicolás aprobó el acceso de Orus a SAPSEND.';
/** Orus (7) y Pedro (11) son de desarrollo; Play (16) es de negocio. */
const AGENTES = [
  { id_agent: 7, code: 'horus', display_name: 'Orus', es_desarrollo: true },
  { id_agent: 11, code: 'pedro', display_name: 'Pedro', es_desarrollo: true },
  { id_agent: 16, code: 'play', display_name: 'Play', es_desarrollo: false },
];

/** El subproceso-permiso en la empresa 8 (o ninguno). */
const conPermisoEn = (...empresas: number[]) =>
  db.subprocessUserCompany.findMany.mockResolvedValue(empresas.map((id_company) => ({ companyUser: { id_company } })));

beforeEach(() => {
  vi.clearAllMocks();
  h.sessionUser.mockResolvedValue({ id: 'u-ana', email: 'ana@gsslatam.com' });
  h.resolveProject.mockResolvedValue(proyecto('owner'));
  h.admin.mockResolvedValue(false);
  conPermisoEn();
  db.chatProjectRepoCatalog.findMany.mockResolvedValue([repo('front-kronos'), repo('sapsend')]);
  db.chatProjectAgentPolicy.findUnique.mockResolvedValue(null);
  db.chatProjectAgentPolicyRepo.findMany.mockResolvedValue([]);
  db.chatProjectAgentPolicyLog.findMany.mockResolvedValue([]);
  db.user.findMany.mockResolvedValue([]);
  // Por defecto el proyecto 7 tiene a Orus, agente de DESARROLLO (regla del 2026-10-27).
  db.chatProjectAgent.findMany.mockResolvedValue([{ id_agent: 7 }]);
  db.agent.findMany.mockImplementation(async (q: { where: { id_agent: { in: number[] } } }) =>
    AGENTES.filter((a) => q.where.id_agent.in.includes(a.id_agent))
  );
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
});

describe('GET /api/proyectos/[id]/permisos', () => {
  it('el dueño sin permiso VE los permisos pero no los puede cambiar (sin catálogo)', async () => {
    const r = await verPermisos(req('/api/proyectos/7/permisos'), params());
    const body = await r.json();
    expect(r.status).toBe(200);
    expect(body.canEdit).toBe(false);
    expect(body.catalog).toEqual([]);
    expect(body.policy).toMatchObject({ codeLevel: 'ninguno', configurada: false, repos: [] });
    expect(body.operators.map((o: { email: string }) => o.email)).toEqual(['nicolas.rivera@gsslatam.com', 'cristian.baldion@gsslatam.com']);
  });

  it('con el subproceso en la empresa del proyecto, sí (y recibe el catálogo activo)', async () => {
    conPermisoEn(8);
    const body = await (await verPermisos(req('/api/proyectos/7/permisos'), params())).json();
    expect(body.canEdit).toBe(true);
    expect(body.catalog.map((r: { slug: string }) => r.slug)).toEqual(['front-kronos', 'sapsend']);
  });

  it('el subproceso en OTRA empresa no sirve; la administración sí, en todas', async () => {
    conPermisoEn(3);
    expect((await (await verPermisos(req('/api/proyectos/7/permisos'), params())).json()).canEdit).toBe(false);
    h.admin.mockResolvedValue(true);
    expect((await (await verPermisos(req('/api/proyectos/7/permisos'), params())).json()).canEdit).toBe(true);
  });

  it('quien no es miembro recibe 404 (aunque sea administración)', async () => {
    h.admin.mockResolvedValue(true);
    h.resolveProject.mockResolvedValue(null);
    expect((await verPermisos(req('/api/proyectos/7/permisos'), params())).status).toBe(404);
  });

  it('código antes que el DDL: «ninguno» sin error', async () => {
    db.chatProjectAgentPolicy.findUnique.mockRejectedValue(Object.assign(new Error('x'), { code: 'P2021' }));
    db.chatProjectAgentPolicyLog.findMany.mockRejectedValue(Object.assign(new Error('x'), { code: 'P2021' }));
    const r = await verPermisos(req('/api/proyectos/7/permisos'), params());
    expect(r.status).toBe(200);
    expect((await r.json()).policy.codeLevel).toBe('ninguno');
  });
});

describe('PATCH /api/proyectos/[id]/permisos', () => {
  const cuerpo = { codeLevel: 'desarrollo_pases', repos: ['sapsend'], reason: MOTIVO };

  it('ser dueño NO alcanza: 403 y nada se escribe', async () => {
    const r = await cambiarPermisos(req('/api/proyectos/7/permisos', 'PATCH', cuerpo), params());
    expect(r.status).toBe(403);
    expect(db.chatProjectAgentPolicy.create).not.toHaveBeenCalled();
    expect(db.chatProjectAgentPolicyLog.create).not.toHaveBeenCalled();
  });

  it('sin motivo, o con un repo fuera del catálogo: 400', async () => {
    conPermisoEn(8);
    expect((await cambiarPermisos(req('/api/proyectos/7/permisos', 'PATCH', { ...cuerpo, reason: '' }), params())).status).toBe(400);
    expect((await cambiarPermisos(req('/api/proyectos/7/permisos', 'PATCH', { ...cuerpo, repos: ['mcp-sapbo'] }), params())).status).toBe(400);
    expect((await cambiarPermisos(req('/api/proyectos/7/permisos', 'PATCH', { ...cuerpo, deployApprovers: ['otro@gsslatam.com'] }), params())).status).toBe(400);
  });

  it('con permiso: guarda la fila, los repos y el registro (antes = null al crear)', async () => {
    conPermisoEn(8);
    db.chatProjectRepoCatalog.findMany.mockImplementation(async (q: { where?: { slug?: unknown } }) =>
      q?.where?.slug ? [{ id_repo: 2, slug: 'sapsend' }] : [repo('front-kronos'), repo('sapsend')]
    );
    const r = await cambiarPermisos(req('/api/proyectos/7/permisos', 'PATCH', cuerpo), params());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ updated: true });
    expect(db.chatProjectAgentPolicy.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id_project: 7,
        code_level: 'desarrollo_pases',
        deploy_approvers: 'nicolas.rivera@gsslatam.com,cristian.baldion@gsslatam.com',
        reason: MOTIVO,
        updated_by: 'u-ana',
      }),
    });
    expect(db.chatProjectAgentPolicyRepo.createMany).toHaveBeenCalledWith({ data: [{ id_project: 7, id_repo: 2, added_by: 'u-ana' }] });
    const log = db.chatProjectAgentPolicyLog.create.mock.calls[0][0].data;
    expect(log).toMatchObject({ scope: 'proyecto', id_project: 7, action: 'crear', before_value: null, reason: MOTIVO, changed_by: 'u-ana', changed_by_email: 'ana@gsslatam.com' });
    expect(JSON.parse(log.after_value)).toEqual({ codeLevel: 'desarrollo_pases', repos: ['sapsend'], deployApprovers: ['nicolas.rivera@gsslatam.com', 'cristian.baldion@gsslatam.com'] });
  });

  it('un cambio registra el ANTES y el DESPUÉS; si no cambia nada, no escribe', async () => {
    conPermisoEn(8);
    db.chatProjectAgentPolicy.findUnique.mockResolvedValue({ code_level: 'lectura', deploy_approvers: null, reason: 'x', updated_by: 'u-x', updated_at: new Date() });
    db.chatProjectAgentPolicyRepo.findMany.mockResolvedValue([{ repo: repo('sapsend') }]);
    // Igual que lo guardado: no escribe.
    const igual = await cambiarPermisos(req('/api/proyectos/7/permisos', 'PATCH', { codeLevel: 'lectura', repos: ['sapsend'], reason: MOTIVO }), params());
    expect(await igual.json()).toEqual({ updated: false });
    expect(db.chatProjectAgentPolicyLog.create).not.toHaveBeenCalled();
    // A «ninguno» (revocar): actualiza, borra los repos y registra el antes.
    const r = await cambiarPermisos(req('/api/proyectos/7/permisos', 'PATCH', { codeLevel: 'ninguno', reason: 'Se terminó el ajuste de tesorería.' }), params());
    expect(await r.json()).toEqual({ updated: true });
    expect(db.chatProjectAgentPolicy.update).toHaveBeenCalledWith({ where: { id_project: 7 }, data: expect.objectContaining({ code_level: 'ninguno', deploy_approvers: null }) });
    expect(db.chatProjectAgentPolicyRepo.deleteMany).toHaveBeenCalledWith({ where: { id_project: 7 } });
    expect(db.chatProjectAgentPolicyRepo.createMany).not.toHaveBeenCalled();
    const log = db.chatProjectAgentPolicyLog.create.mock.calls[0][0].data;
    expect(log.action).toBe('cambiar');
    expect(JSON.parse(log.before_value)).toEqual({ codeLevel: 'lectura', repos: ['sapsend'], deployApprovers: [] });
  });

  it('un proyecto archivado no se cambia', async () => {
    conPermisoEn(8);
    h.resolveProject.mockResolvedValue(proyecto('owner', true));
    expect((await cambiarPermisos(req('/api/proyectos/7/permisos', 'PATCH', cuerpo), params())).status).toBe(403);
  });
});

describe('catálogo de repositorios', () => {
  it('solo la administración lo ve y lo cambia', async () => {
    expect((await verCatalogo()).status).toBe(403);
    expect((await agregarRepo(req('/api/proyectos/repositorios', 'POST', {}))).status).toBe(403);
    expect((await cambiarRepo(req('/api/proyectos/repositorios/2', 'PATCH', { active: false, reason: MOTIVO }), { params: Promise.resolve({ idRepo: '2' }) })).status).toBe(403);
  });

  it('agregar: valida, crea y registra con motivo', async () => {
    h.admin.mockResolvedValue(true);
    db.chatProjectRepoCatalog.findUnique.mockResolvedValue(null);
    db.chatProjectRepoCatalog.create.mockResolvedValue(repo('mcp-sapbo', true, 3));
    const malo = await agregarRepo(req('/api/proyectos/repositorios', 'POST', { slug: 'mcp-sapbo', name: 'MCP', github: 'sin-barra', branchTesting: 'testing', branchProduction: 'main', reason: MOTIVO }));
    expect(malo.status).toBe(400);
    const r = await agregarRepo(
      req('/api/proyectos/repositorios', 'POST', { slug: 'mcp-sapbo', name: 'MCP SAP', github: 'gsslatam/mcp-sapbo', branchTesting: 'testing', branchProduction: 'main', reason: MOTIVO })
    );
    expect(r.status).toBe(201);
    expect(db.chatProjectAgentPolicyLog.create.mock.calls[0][0].data).toMatchObject({ scope: 'catalogo', id_repo: 3, action: 'crear', reason: MOTIVO });
  });

  it('desactivar: no borra, registra el antes y el después', async () => {
    h.admin.mockResolvedValue(true);
    db.chatProjectRepoCatalog.findUnique.mockResolvedValue(repo('sapsend'));
    db.chatProjectRepoCatalog.update.mockResolvedValue(repo('sapsend', false));
    const r = await cambiarRepo(req('/api/proyectos/repositorios/2', 'PATCH', { active: false, reason: MOTIVO }), { params: Promise.resolve({ idRepo: '2' }) });
    expect(r.status).toBe(200);
    expect(db.chatProjectRepoCatalog.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id_repo: 2 }, data: expect.objectContaining({ active: false }) }));
    const log = db.chatProjectAgentPolicyLog.create.mock.calls[0][0].data;
    expect(log.action).toBe('desactivar');
    expect(JSON.parse(log.before_value).active).toBe(true);
    expect(JSON.parse(log.after_value).active).toBe(false);
  });
});

describe('GET /api/proyectos/permisos-agentes (opciones para «Nuevo proyecto»)', () => {
  it('solo las empresas del módulo donde puede escoger', async () => {
    h.moduleCompanies.mockResolvedValue([{ idCompany: 3, companyName: 'FARMALOGICA' }, { idCompany: 8, companyName: 'GSS' }]);
    conPermisoEn(8, 5);
    const body = await (await opciones()).json();
    expect(body).toMatchObject({ editableCompanies: [8], catalogAdmin: false });
    expect(body.catalog).toHaveLength(2);
  });
  it('sin el módulo: 404', async () => {
    h.moduleCompanies.mockResolvedValue([]);
    expect((await opciones()).status).toBe(404);
  });
});

describe('GET /api/chat/agent/projects/policy (el puente)', () => {
  const puente = { idAgent: 7, code: 'horus', scope: 'projects' };

  it('sin llave: 401; con la llave del bot vivo: 404', async () => {
    h.agent.mockResolvedValue(null);
    expect((await politicaPuente(req('/api/chat/agent/projects/policy?idConversation=28'))).status).toBe(401);
    h.agent.mockResolvedValue({ ...puente, scope: 'channel' });
    expect((await politicaPuente(req('/api/chat/agent/projects/policy?idConversation=28'))).status).toBe(404);
  });

  it('conversación ajena: 404', async () => {
    h.agent.mockResolvedValue(puente);
    h.assertConv.mockResolvedValue(null);
    expect((await politicaPuente(req('/api/chat/agent/projects/policy?idConversation=28'))).status).toBe(404);
    expect(h.assertConv).toHaveBeenCalledWith(7, 28);
  });

  it('sin fila: «sin-politica» (el puente usa su archivo o «ninguno»)', async () => {
    h.agent.mockResolvedValue(puente);
    h.assertConv.mockResolvedValue({ id: 28, idProject: 1, projectName: 'P' });
    const body = await (await politicaPuente(req('/api/chat/agent/projects/policy?idConversation=28'))).json();
    expect(body.policy).toMatchObject({ idProject: 1, source: 'sin-politica', codeLevel: 'ninguno', level: 0, repos: [], connectors: [] });
  });

  it('con fila: la de la base; los repos desactivados no salen y sin repos baja a «ninguno»', async () => {
    h.agent.mockResolvedValue(puente);
    h.assertConv.mockResolvedValue({ id: 28, idProject: 1, projectName: 'P' });
    db.chatProjectAgentPolicy.findUnique.mockResolvedValue({ code_level: 'desarrollo_pases', deploy_approvers: 'nicolas.rivera@gsslatam.com', reason: 'x', updated_by: 'u', updated_at: new Date('2026-10-20T18:00:00Z') });
    db.chatProjectAgentPolicyRepo.findMany.mockResolvedValue([{ repo: repo('sapsend') }, { repo: repo('front-kronos', false) }]);
    const body = await (await politicaPuente(req('/api/chat/agent/projects/policy?idConversation=28'))).json();
    expect(body.policy).toEqual({
      idProject: 1,
      source: 'bd',
      codeLevel: 'desarrollo_pases',
      level: 3,
      deploys: true,
      repos: [{ slug: 'sapsend', name: 'SAPSEND', github: 'gsslatam/sapsend', branchTesting: 'testing', branchProduction: 'production' }],
      deployApprovers: ['nicolas.rivera@gsslatam.com'],
      connectors: [],
      updatedAt: '2026-10-20T18:00:00.000Z',
    });
    db.chatProjectAgentPolicyRepo.findMany.mockResolvedValue([{ repo: repo('sapsend', false) }]);
    const bajo = await (await politicaPuente(req('/api/chat/agent/projects/policy?idConversation=28'))).json();
    expect(bajo.policy).toMatchObject({ source: 'bd', codeLevel: 'ninguno', level: 0, deploys: false, repos: [], deployApprovers: [] });
  });

  it('sin idConversation: la de cada proyecto activo del agente', async () => {
    h.agent.mockResolvedValue(puente);
    db.chatProject.findMany.mockResolvedValue([{ id_project: 1 }, { id_project: 4 }]);
    const body = await (await politicaPuente(req('/api/chat/agent/projects/policy'))).json();
    expect(body.policies.map((p: { idProject: number }) => p.idProject)).toEqual([1, 4]);
    expect(db.chatProject.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { archived: false, agents: { some: { id_agent: 7 } } } }));
  });
});

describe('POST /api/proyectos con permisos', () => {
  const base = { name: 'Ajustes SAPSEND', idCompany: 8, agentCodes: ['horus'], profile: 'gss' };
  beforeEach(() => {
    h.moduleCompanies.mockResolvedValue([{ idCompany: 8, companyName: 'GSS' }]);
    h.designables.mockResolvedValue(
      new Map([
        [
          8,
          [
            { idAgent: 7, code: 'horus', displayName: 'Orus', profiles: ['gss'], esDesarrollo: true },
            { idAgent: 16, code: 'play', displayName: 'Play', profiles: ['gss'], esDesarrollo: false },
          ],
        ],
      ])
    );
    db.chatProject.count.mockResolvedValue(0);
    db.chatProject.create.mockResolvedValue({ id_project: 40 });
  });

  it('pedir acceso a código sin permiso: 403 y no se crea el proyecto', async () => {
    const r = await crearProyecto(req('/api/proyectos', 'POST', { ...base, agentPolicy: { codeLevel: 'lectura', repos: ['sapsend'] } }));
    expect(r.status).toBe(403);
    expect(db.chatProject.create).not.toHaveBeenCalled();
  });

  it('sin permiso y «ninguno» (o sin agentPolicy): se crea sin fila de política', async () => {
    const r = await crearProyecto(req('/api/proyectos', 'POST', { ...base, agentPolicy: { codeLevel: 'ninguno' } }));
    expect(r.status).toBe(201);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.chatProjectAgentPolicy.create).not.toHaveBeenCalled();
  });

  it('con permiso: proyecto, política y registro en UNA transacción', async () => {
    conPermisoEn(8);
    db.chatProjectRepoCatalog.findMany.mockImplementation(async (q: { where?: { slug?: unknown } }) =>
      q?.where?.slug ? [{ id_repo: 2, slug: 'sapsend' }] : [repo('front-kronos'), repo('sapsend')]
    );
    const r = await crearProyecto(req('/api/proyectos', 'POST', { ...base, agentPolicy: { codeLevel: 'desarrollo', repos: ['sapsend'], reason: MOTIVO } }));
    expect(r.status).toBe(201);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.chatProjectAgentPolicy.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id_project: 40, code_level: 'desarrollo', reason: MOTIVO }) });
    expect(db.chatProjectAgentPolicyLog.create.mock.calls[0][0].data).toMatchObject({ id_project: 40, action: 'crear' });
  });
});

/*
 * Regla de Nicolás Rivera (2026-10-27, 16:08 COT): «el tema de los proyectos de desarrollo sí, solo
 * debería ser de los agentes que desarrollan». Código y repos SOLO con agentes de desarrollo
 * (agent.es_desarrollo); el servidor lo rechaza con 400 aunque llegue por la API.
 */
describe('código y repos solo para agentes de desarrollo (2026-10-27)', () => {
  const conPlay = () => db.chatProjectAgent.findMany.mockResolvedValue([{ id_agent: 16 }]);
  const repoSapsend = () =>
    db.chatProjectRepoCatalog.findMany.mockImplementation(async (q: { where?: { slug?: unknown } }) =>
      q?.where?.slug ? [{ id_repo: 2, slug: 'sapsend' }] : [repo('front-kronos'), repo('sapsend')]
    );

  it('PATCH con Play (negocio): «lectura» o solo repos → 400 con mensaje claro y nada se escribe', async () => {
    conPermisoEn(8);
    conPlay();
    for (const cuerpo of [
      { codeLevel: 'lectura', repos: ['front-kronos', 'sapsend'], reason: MOTIVO },
      { codeLevel: 'ninguno', repos: ['sapsend'], reason: MOTIVO },
      { codeLevel: 'desarrollo_pases', repos: ['sapsend'], reason: MOTIVO },
    ]) {
      const r = await cambiarPermisos(req('/api/proyectos/7/permisos', 'PATCH', cuerpo), params());
      expect(r.status).toBe(400);
      expect((await r.json()).error).toBe(
        'El acceso a código y los repositorios solo se asignan a agentes de desarrollo. Play no es agente de desarrollo: el proyecto queda en «Ninguno» y sin repositorios.'
      );
    }
    expect(db.chatProjectAgentPolicy.create).not.toHaveBeenCalled();
    expect(db.chatProjectAgentPolicy.update).not.toHaveBeenCalled();
    expect(db.chatProjectAgentPolicyLog.create).not.toHaveBeenCalled();
  });

  it('PATCH con Play a «ninguno» sí pasa (así se corrige un proyecto viejo como el 9)', async () => {
    conPermisoEn(8);
    conPlay();
    db.chatProjectAgentPolicy.findUnique.mockResolvedValue({ code_level: 'lectura', deploy_approvers: null, reason: 'x', updated_by: 'u-x', updated_at: new Date() });
    db.chatProjectAgentPolicyRepo.findMany.mockResolvedValue([{ repo: repo('front-kronos') }, { repo: repo('sapsend') }]);
    const r = await cambiarPermisos(req('/api/proyectos/7/permisos', 'PATCH', { codeLevel: 'ninguno', reason: 'Play es agente de negocio.' }), params());
    expect(r.status).toBe(200);
    expect(db.chatProjectAgentPolicy.update).toHaveBeenCalledWith({ where: { id_project: 7 }, data: expect.objectContaining({ code_level: 'ninguno' }) });
    expect(db.chatProjectAgentPolicyRepo.deleteMany).toHaveBeenCalledWith({ where: { id_project: 7 } });
  });

  it('PATCH con Orus y Play juntos: basta uno de negocio para rechazar', async () => {
    conPermisoEn(8);
    db.chatProjectAgent.findMany.mockResolvedValue([{ id_agent: 7 }, { id_agent: 16 }]);
    const r = await cambiarPermisos(req('/api/proyectos/7/permisos', 'PATCH', { codeLevel: 'lectura', repos: ['sapsend'], reason: MOTIVO }), params());
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain('Play no es agente de desarrollo');
  });

  it('PATCH con Pedro (desarrollo): guarda', async () => {
    conPermisoEn(8);
    repoSapsend();
    db.chatProjectAgent.findMany.mockResolvedValue([{ id_agent: 11 }]);
    const r = await cambiarPermisos(req('/api/proyectos/7/permisos', 'PATCH', { codeLevel: 'lectura', repos: ['sapsend'], reason: MOTIVO }), params());
    expect(r.status).toBe(200);
    expect(db.chatProjectAgentPolicy.create).toHaveBeenCalled();
  });

  it('código antes que el DDL (sin la columna es_desarrollo): nadie es de desarrollo → 400 (falla cerrado)', async () => {
    conPermisoEn(8);
    db.agent.findMany.mockImplementation(async (q: { select: Record<string, boolean> }) => {
      if (q.select.es_desarrollo) throw Object.assign(new Error("Invalid column name 'es_desarrollo'."), { code: 'P2022' });
      return [{ id_agent: 7, code: 'horus', display_name: 'Orus' }];
    });
    const r = await cambiarPermisos(req('/api/proyectos/7/permisos', 'PATCH', { codeLevel: 'lectura', repos: ['sapsend'], reason: MOTIVO }), params());
    expect(r.status).toBe(400);
  });

  it('GET: dice si se permite código y quiénes no son de desarrollo; sin código, no manda catálogo', async () => {
    conPermisoEn(8);
    conPlay();
    const body = await (await verPermisos(req('/api/proyectos/7/permisos'), params())).json();
    expect(body).toMatchObject({ canEdit: true, codeAllowed: false, nonDevAgents: ['Play'], catalog: [] });
    db.chatProjectAgent.findMany.mockResolvedValue([{ id_agent: 7 }]);
    const orus = await (await verPermisos(req('/api/proyectos/7/permisos'), params())).json();
    expect(orus).toMatchObject({ codeAllowed: true, nonDevAgents: [] });
    expect(orus.catalog).toHaveLength(2);
  });

  describe('POST /api/proyectos', () => {
    const base = { name: 'Comercio Exterior LATAM', idCompany: 8, profile: 'gss' };
    beforeEach(() => {
      h.moduleCompanies.mockResolvedValue([{ idCompany: 8, companyName: 'GSS' }]);
      h.designables.mockResolvedValue(
        new Map([
          [
            8,
            [
              { idAgent: 7, code: 'horus', displayName: 'Orus', profiles: ['gss'], esDesarrollo: true },
              { idAgent: 16, code: 'play', displayName: 'Play', profiles: ['gss'], esDesarrollo: false },
            ],
          ],
        ])
      );
      db.chatProject.count.mockResolvedValue(0);
      db.chatProject.create.mockResolvedValue({ id_project: 41 });
    });

    it('Play con «lectura» y repos (el caso del proyecto 9): 400 y no se crea el proyecto', async () => {
      conPermisoEn(8);
      const r = await crearProyecto(
        req('/api/proyectos', 'POST', { ...base, agentCodes: ['play'], agentPolicy: { codeLevel: 'lectura', repos: ['front-kronos', 'sapsend'], reason: MOTIVO } })
      );
      expect(r.status).toBe(400);
      expect((await r.json()).error).toContain('Play no es agente de desarrollo');
      expect(db.chatProject.create).not.toHaveBeenCalled();
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('Orus + Play con código: 400', async () => {
      conPermisoEn(8);
      const r = await crearProyecto(req('/api/proyectos', 'POST', { ...base, agentCodes: ['horus', 'play'], agentPolicy: { codeLevel: 'desarrollo', repos: ['sapsend'], reason: MOTIVO } }));
      expect(r.status).toBe(400);
      expect(db.chatProject.create).not.toHaveBeenCalled();
    });

    it('Play con «ninguno» (o sin agentPolicy): se crea normal', async () => {
      conPermisoEn(8);
      const r = await crearProyecto(req('/api/proyectos', 'POST', { ...base, agentCodes: ['play'], agentPolicy: { codeLevel: 'ninguno', repos: [] } }));
      expect(r.status).toBe(201);
      const sin = await crearProyecto(req('/api/proyectos', 'POST', { ...base, agentCodes: ['play'] }));
      expect(sin.status).toBe(201);
    });
  });

  describe('POST /api/proyectos/[id]/agentes', () => {
    beforeEach(() => {
      h.designables.mockResolvedValue(
        new Map([
          [
            8,
            [
              { idAgent: 11, code: 'pedro', displayName: 'Pedro', profiles: ['gss'], esDesarrollo: true },
              { idAgent: 16, code: 'play', displayName: 'Play', profiles: ['gss'], esDesarrollo: false },
            ],
          ],
        ])
      );
    });

    it('a un proyecto CON código no se le agrega un agente de negocio (400); uno de desarrollo sí', async () => {
      db.chatProjectAgentPolicy.findUnique.mockResolvedValue({ code_level: 'desarrollo', deploy_approvers: null, reason: 'x', updated_by: 'u', updated_at: new Date() });
      db.chatProjectAgentPolicyRepo.findMany.mockResolvedValue([{ repo: repo('sapsend') }]);
      const r = await agregarAgentes(req('/api/proyectos/7/agentes', 'POST', { agentCodes: ['play'] }), params());
      expect(r.status).toBe(400);
      expect((await r.json()).error).toContain('Play no es agente de desarrollo');
      expect(db.chatProjectAgent.createMany).not.toHaveBeenCalled();
      const ok = await agregarAgentes(req('/api/proyectos/7/agentes', 'POST', { agentCodes: ['pedro'] }), params());
      expect(ok.status).toBe(201);
    });

    it('a un proyecto en «ninguno», cualquiera', async () => {
      const r = await agregarAgentes(req('/api/proyectos/7/agentes', 'POST', { agentCodes: ['play'] }), params());
      expect(r.status).toBe(201);
      expect(db.chatProjectAgent.createMany).toHaveBeenCalled();
    });
  });

  it('el PUENTE de un agente de negocio recibe «ninguno» de la base aunque la fila diga otra cosa', async () => {
    h.agent.mockResolvedValue({ idAgent: 16, code: 'play', scope: 'projects' });
    h.assertConv.mockResolvedValue({ id: 144, idProject: 9, projectName: 'Comercio Exterior LATAM' });
    db.chatProjectAgentPolicy.findUnique.mockResolvedValue({ code_level: 'lectura', deploy_approvers: null, reason: 'x', updated_by: 'u', updated_at: new Date() });
    db.chatProjectAgentPolicyRepo.findMany.mockResolvedValue([{ repo: repo('front-kronos') }, { repo: repo('sapsend') }]);
    const body = await (await politicaPuente(req('/api/chat/agent/projects/policy?idConversation=144'))).json();
    expect(body.policy).toEqual({ idProject: 9, source: 'bd', codeLevel: 'ninguno', level: 0, deploys: false, repos: [], deployApprovers: [], connectors: [], updatedAt: null });
    // Orus, con la misma fila, sí la recibe.
    h.agent.mockResolvedValue({ idAgent: 7, code: 'horus', scope: 'projects' });
    const orus = await (await politicaPuente(req('/api/chat/agent/projects/policy?idConversation=144'))).json();
    expect(orus.policy).toMatchObject({ source: 'bd', codeLevel: 'lectura', level: 1 });
  });
});
