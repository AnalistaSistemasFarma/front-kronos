import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * El ASISTENTE es OPCIONAL al crear un proyecto (2026-11-10, Nicolás Rivera:
 * «que existan los 2 caminos y que se puedan añadir después más agentes»):
 *   - POST /api/proyectos sin agentCodes crea un proyecto de personas
 *     (id_agent NULL, perfil «sin-conectores», sin sugerencia de equipo);
 *   - al primer asistente de un proyecto sin asistentes ni conversaciones se
 *     escoge el perfil (que deben admitir todos los escogidos);
 *   - se puede retirar el último asistente;
 *   - agregar o retirar: dueño, o administración de SynerLink (miembro).
 */
const h = vi.hoisted(() => {
  const db = {
    chatProject: { count: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    chatProjectAgent: { findMany: vi.fn(), createMany: vi.fn(), delete: vi.fn() },
    chatConversation: { count: vi.fn() },
    subprocessUserCompany: { findMany: vi.fn(async () => []) },
    chatProjectAgentPolicy: { findUnique: vi.fn() },
    chatProjectAgentPolicyRepo: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return {
    db,
    sessionUser: vi.fn(),
    resolveProject: vi.fn(),
    admin: vi.fn(),
    moduleCompanies: vi.fn(),
    designables: vi.fn(),
    sugerencia: vi.fn(),
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
  projectModuleCompanies: h.moduleCompanies,
  designableAgents: h.designables,
  listProjectsForUser: vi.fn(),
}));
vi.mock('../equipo', () => ({ pedirSugerencia: h.sugerencia }));
vi.mock('../estado-agente-servidor', () => ({ estadosTrabajandoVisibles: vi.fn(async () => []) }));

import { NextRequest } from 'next/server';
import { POST as crearProyecto } from '../../../app/api/proyectos/route';
import { DELETE as retirarAgente, GET as candidatosAgentes, POST as agregarAgentes } from '../../../app/api/proyectos/[id]/agentes/route';
import { normalizeAgentCodes } from '../../chat/projects-rules';

const { db } = h;
const params = (id = '7') => ({ params: Promise.resolve({ id }) });
const req = (url: string, method = 'GET', body?: unknown) =>
  new NextRequest(`http://x${url}`, body !== undefined ? { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : { method });
const proyecto = (role: 'owner' | 'editor' | 'reader', profile = 'sin-conectores') => ({ idProject: 7, name: 'Regulatorio', idCompany: 3, profile, role, archived: false });

/** Kepler admite «sin-conectores» y «olp»; Cosmo solo «sin-conectores». */
const KEPLER = { idAgent: 27, code: 'kepler', displayName: 'Kepler', profiles: ['sin-conectores', 'olp'], esDesarrollo: true };
const COSMO = { idAgent: 22, code: 'cosmo', displayName: 'Cosmo', profiles: ['sin-conectores'], esDesarrollo: false };

beforeEach(() => {
  vi.clearAllMocks();
  h.sessionUser.mockResolvedValue({ id: 'u-juan', email: 'juan.mora@gsslatam.com' });
  h.resolveProject.mockResolvedValue(proyecto('owner'));
  h.admin.mockResolvedValue(false);
  h.moduleCompanies.mockResolvedValue([{ idCompany: 3, companyName: 'ONELATAMPHARMA' }]);
  h.designables.mockResolvedValue(new Map([[3, [KEPLER, COSMO]]]));
  db.chatProject.count.mockResolvedValue(0);
  db.chatProject.create.mockResolvedValue({ id_project: 50 });
  db.chatProject.updateMany.mockResolvedValue({ count: 1 });
  db.chatProjectAgent.findMany.mockResolvedValue([]);
  db.chatConversation.count.mockResolvedValue(0);
  db.chatProjectAgentPolicy.findUnique.mockResolvedValue(null);
  db.chatProjectAgentPolicyRepo.findMany.mockResolvedValue([]);
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
});

describe('normalizeAgentCodes', () => {
  it('por defecto exige al menos uno; con permitirVacio, vacío u omitido vale []', () => {
    expect(normalizeAgentCodes([]).ok).toBe(false);
    expect(normalizeAgentCodes([], { permitirVacio: true })).toEqual({ ok: true, value: [] });
    expect(normalizeAgentCodes(undefined, { permitirVacio: true })).toEqual({ ok: true, value: [] });
    expect(normalizeAgentCodes('kepler', { permitirVacio: true }).ok).toBe(false);
  });
});

describe('POST /api/proyectos SIN asistentes (el caso de Juan Mora)', () => {
  it('crea el proyecto de personas: id_agent NULL, perfil «sin-conectores», sin filas de agente', async () => {
    h.designables.mockResolvedValue(new Map()); // Juan no tiene asistentes en OLP
    const r = await crearProyecto(req('/api/proyectos', 'POST', { name: 'Regulatorio OLP', idCompany: 3, agentCodes: [], suggestTeam: true }));
    expect(r.status).toBe(201);
    const data = db.chatProject.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ id_agent: null, profile: 'sin-conectores', id_company: 3 });
    expect(data.agents).toBeUndefined();
    expect(data.members.create[0]).toMatchObject({ id_user: 'u-juan', role: 'owner' });
    expect(h.sugerencia).not.toHaveBeenCalled();
  });

  it('sin agentCodes en el cuerpo, igual', async () => {
    const r = await crearProyecto(req('/api/proyectos', 'POST', { name: 'Regulatorio OLP', idCompany: 3 }));
    expect(r.status).toBe(201);
  });

  it('pedir acceso a código sin asistentes: 400 y no se crea', async () => {
    const r = await crearProyecto(req('/api/proyectos', 'POST', { name: 'X', idCompany: 3, agentCodes: [], agentPolicy: { codeLevel: 'lectura', repos: ['sapsend'] } }));
    expect([400, 403]).toContain(r.status);
    expect(db.chatProject.create).not.toHaveBeenCalled();
  });

  it('CON asistentes sigue igual: perfil obligatorio y agente con el que se creó', async () => {
    expect((await crearProyecto(req('/api/proyectos', 'POST', { name: 'X', idCompany: 3, agentCodes: ['kepler'] }))).status).toBe(400);
    const r = await crearProyecto(req('/api/proyectos', 'POST', { name: 'X', idCompany: 3, agentCodes: ['kepler'], profile: 'olp' }));
    expect(r.status).toBe(201);
    expect(db.chatProject.create.mock.calls[0][0].data).toMatchObject({ id_agent: 27, profile: 'olp', agents: { create: [{ id_agent: 27, added_by: 'u-juan' }] } });
  });
});

describe('agregar asistentes DESPUÉS', () => {
  it('proyecto sin asistentes ni conversaciones: ofrece todos y pide escoger el perfil', async () => {
    const r = await candidatosAgentes(req('/api/proyectos/7/agentes'), params());
    const body = await r.json();
    expect(body.eligePerfil).toBe(true);
    expect(body.agents.map((a: { code: string }) => a.code)).toEqual(['kepler', 'cosmo']);
    expect(h.designables).toHaveBeenCalledWith('juan.mora@gsslatam.com', undefined);
  });

  it('el primero sin perfil: 400; con un perfil que no admite: 400', async () => {
    expect((await agregarAgentes(req('/api/proyectos/7/agentes', 'POST', { agentCodes: ['kepler'] }), params())).status).toBe(400);
    const r = await agregarAgentes(req('/api/proyectos/7/agentes', 'POST', { agentCodes: ['kepler', 'cosmo'], profile: 'olp' }), params());
    expect(r.status).toBe(400);
    expect(db.chatProjectAgent.createMany).not.toHaveBeenCalled();
  });

  it('el primero con perfil: fija perfil y agente de creación y designa, en una transacción', async () => {
    const r = await agregarAgentes(req('/api/proyectos/7/agentes', 'POST', { agentCodes: ['kepler'], profile: 'olp' }), params());
    expect(r.status).toBe(201);
    expect(db.$transaction).toHaveBeenCalled();
    expect(db.chatProject.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id_project: 7, agents: { none: {} }, conversations: { none: {} } },
      data: { profile: 'olp' },
    });
    expect(db.chatProject.updateMany.mock.calls[1][0]).toMatchObject({ where: { id_project: 7, id_agent: null }, data: { id_agent: 27 } });
    expect(db.chatProjectAgent.createMany).toHaveBeenCalledWith({ data: [{ id_project: 7, id_agent: 27, added_by: 'u-juan' }] });
  });

  it('si otro agregó primero (carrera): 409 y no designa', async () => {
    db.chatProject.updateMany.mockResolvedValueOnce({ count: 0 });
    const r = await agregarAgentes(req('/api/proyectos/7/agentes', 'POST', { agentCodes: ['kepler'], profile: 'olp' }), params());
    expect(r.status).toBe(409);
    expect(db.chatProjectAgent.createMany).not.toHaveBeenCalled();
  });

  it('proyecto que YA tiene asistentes: el perfil no cambia y se filtra por el del proyecto', async () => {
    h.resolveProject.mockResolvedValue(proyecto('owner', 'olp'));
    db.chatProjectAgent.findMany.mockResolvedValue([{ id_agent: 22 }]);
    const r = await agregarAgentes(req('/api/proyectos/7/agentes', 'POST', { agentCodes: ['kepler'], profile: 'farmalogica' }), params());
    expect(r.status).toBe(201);
    expect(h.designables).toHaveBeenCalledWith('juan.mora@gsslatam.com', 'olp');
    expect(db.chatProject.updateMany).not.toHaveBeenCalled();
  });

  it('sin asistentes pero CON conversaciones antiguas: el perfil queda fijo', async () => {
    h.resolveProject.mockResolvedValue(proyecto('owner', 'olp'));
    db.chatConversation.count.mockResolvedValue(3);
    const body = await (await candidatosAgentes(req('/api/proyectos/7/agentes'), params())).json();
    expect(body.eligePerfil).toBe(false);
    expect(h.designables).toHaveBeenCalledWith('juan.mora@gsslatam.com', 'olp');
  });

  it('solo agentes que la persona puede usar: 403', async () => {
    h.designables.mockResolvedValue(new Map([[3, [COSMO]]]));
    const r = await agregarAgentes(req('/api/proyectos/7/agentes', 'POST', { agentCodes: ['kepler'], profile: 'sin-conectores' }), params());
    expect(r.status).toBe(403);
  });
});

describe('quién gestiona asistentes', () => {
  it('un editor no; un editor que es administrador de SynerLink sí', async () => {
    h.resolveProject.mockResolvedValue(proyecto('editor'));
    expect((await agregarAgentes(req('/api/proyectos/7/agentes', 'POST', { agentCodes: ['cosmo'], profile: 'sin-conectores' }), params())).status).toBe(403);
    h.admin.mockResolvedValue(true);
    expect((await agregarAgentes(req('/api/proyectos/7/agentes', 'POST', { agentCodes: ['cosmo'], profile: 'sin-conectores' }), params())).status).toBe(201);
  });

  it('se puede retirar el ÚLTIMO asistente', async () => {
    db.chatProjectAgent.findMany.mockResolvedValue([{ id_project_agent: 9, agent: { code: 'kepler' } }]);
    const r = await retirarAgente(req('/api/proyectos/7/agentes?code=kepler', 'DELETE'), params());
    expect(r.status).toBe(200);
    expect(db.chatProjectAgent.delete).toHaveBeenCalledWith({ where: { id_project_agent: 9 } });
  });
});

describe('SQL manual', () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- rutas fijas del repositorio.
  const leer = (rel: string) => readFileSync(join(__dirname, '../../../prisma', rel), 'utf8');
  const bloque = (sql: string) => sql.slice(sql.indexOf('SET XACT_ABORT ON;'), sql.indexOf('/* BLOQUE-DDL-FIN */')).trim();

  it('PRUEBAS y PROD repiten el bloque DDL de la migración tal cual', () => {
    const mig = bloque(leer('migrations/20261110120000_chat_project_agente_opcional/migration.sql'));
    expect(mig).toContain('ALTER COLUMN [id_agent] INT NULL');
    expect(bloque(leer('manual/2026-11-10-chat-project-agente-opcional-PRUEBAS.sql'))).toBe(mig);
    expect(bloque(leer('manual/2026-11-10-chat-project-agente-opcional-PROD.sql'))).toBe(mig);
  });

  it('cada script se niega fuera de su base y lleva LOCK_TIMEOUT', () => {
    expect(leer('manual/2026-11-10-chat-project-agente-opcional-PROD.sql')).toMatch(/DB_NAME\(\) <> N'KRONOSDB'/);
    expect(leer('manual/2026-11-10-chat-project-agente-opcional-PRUEBAS.sql')).toMatch(/N'KRONOSDB_PRUEBAS'/);
    for (const f of ['PRUEBAS', 'PROD', 'reversa']) expect(leer(`manual/2026-11-10-chat-project-agente-opcional-${f}.sql`)).toContain('SET LOCK_TIMEOUT 5000;');
  });
});
