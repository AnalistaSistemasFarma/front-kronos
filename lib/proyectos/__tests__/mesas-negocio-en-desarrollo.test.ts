import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Nicolás Rivera (2026-11-11, 15:22 COT): «la mesa de discusión no debe depender de proyectos de
 * desarrollo». En un proyecto con acceso a código, una mesa con participantes MIXTOS (de desarrollo
 * y de negocio) se crea bien: el de negocio participa sin acceso al código (el puente le entrega
 * «ninguno»). La respuesta trae un aviso informativo, no un 400.
 */
const h = vi.hoisted(() => {
  const db = {
    chatProjectAgentPolicy: { findUnique: vi.fn() },
    chatProjectAgentPolicyRepo: { findMany: vi.fn() },
    chatProjectAgent: { findMany: vi.fn(), createMany: vi.fn() },
    chatConversation: { count: vi.fn(), create: vi.fn() },
    chatMessage: { create: vi.fn() },
    chatProjectMesa: { create: vi.fn(), findUnique: vi.fn() },
    chatProjectMesaEvento: { create: vi.fn() },
    chatProject: { update: vi.fn() },
    agent: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { db, sessionUser: vi.fn(), resolveProject: vi.fn(), designables: vi.fn() };
});

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('../../../app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../prisma', () => ({ prisma: h.db }));
vi.mock('../../access-control', () => ({ checkAdminPrivileges: vi.fn(async () => false) }));
vi.mock('../../chat/http', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../chat/http')>();
  return { ...real, resolveSessionUser: h.sessionUser };
});
vi.mock('../../chat/projects', () => ({
  resolveProjectForUser: h.resolveProject,
  designableAgents: h.designables,
  assertAgentProjectConversation: vi.fn(),
  eligibleProjectUsers: vi.fn(),
  writeAccessForAgent: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { GET as verMesas, POST as crearMesaRuta } from '../../../app/api/proyectos/[id]/mesas/route';

const { db } = h;
const params = { params: Promise.resolve({ id: '7' }) };
const req = (url: string, method = 'GET', body?: unknown) =>
  new NextRequest(`http://x${url}`, body !== undefined ? { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : { method });

const ORUS = { idAgent: 7, code: 'horus', displayName: 'Orus', avatarUrl: null, avatarVersion: null, profiles: ['gss'], esDesarrollo: true };
const PLAY = { idAgent: 16, code: 'play', displayName: 'Play', avatarUrl: null, avatarVersion: null, profiles: ['gss'], esDesarrollo: false };
const MESA = {
  tema: '¿Cómo reducimos las demoras de Tesorería en OLP?',
  participantes: [
    { idAgent: 7, rol: 'propone' },
    { idAgent: 16, rol: 'revisa los datos' },
  ],
  idAgentModerador: 7,
};

const proyectoConCodigo = () => {
  db.chatProjectAgentPolicy.findUnique.mockResolvedValue({ code_level: 'desarrollo_pases', deploy_approvers: 'nicolas.rivera@gsslatam.com', reason: 'x', updated_by: 'u', updated_at: new Date() });
  db.chatProjectAgentPolicyRepo.findMany.mockResolvedValue([{ repo: { slug: 'front-kronos', active: true } }]);
};

beforeEach(() => {
  vi.clearAllMocks();
  h.sessionUser.mockResolvedValue({ id: 'u-nico', email: 'nicolas.rivera@gsslatam.com' });
  h.resolveProject.mockResolvedValue({ idProject: 7, name: 'SynerLink', idCompany: 8, profile: 'gss', role: 'owner', archived: false });
  h.designables.mockResolvedValue(new Map([[8, [ORUS, PLAY]]]));
  db.chatProjectAgentPolicy.findUnique.mockResolvedValue(null);
  db.chatProjectAgentPolicyRepo.findMany.mockResolvedValue([]);
  db.chatProjectAgent.findMany.mockResolvedValue([{ id_agent: 7 }]);
  db.chatConversation.count.mockResolvedValue(0);
  db.chatConversation.create.mockResolvedValue({ id: 500 });
  db.chatProjectMesa.create.mockResolvedValue({ id_mesa: 31 });
  db.chatProjectMesa.findUnique.mockResolvedValue(null); // sin primera ronda en la prueba
  db.agent.findMany.mockResolvedValue([
    { id_agent: 7, display_name: 'Orus' },
    { id_agent: 16, display_name: 'Play' },
  ]);
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
});

describe('mesa con participantes mixtos en un proyecto de desarrollo', () => {
  it('se crea (201), suma a Play al proyecto y avisa que participa sin acceso al código', async () => {
    proyectoConCodigo();
    const r = await crearMesaRuta(req('/api/proyectos/7/mesas', 'POST', MESA), params);
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ idMesa: 31, idConversation: 500, avisos: ['Play no es agente de desarrollo: participa sin acceso al código.'] });
    expect(db.chatProjectAgent.createMany).toHaveBeenCalledWith({ data: [{ id_project: 7, id_agent: 16, added_by: 'u-nico' }] });
    expect(db.chatProjectMesa.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          agentes: {
            create: [
              { id_agent: 7, rol: 'propone', orden: 0 },
              { id_agent: 16, rol: 'revisa los datos', orden: 1 },
            ],
          },
        }),
      })
    );
  });

  it('si Play ya está en el proyecto, también se crea; el aviso sale igual', async () => {
    proyectoConCodigo();
    db.chatProjectAgent.findMany.mockResolvedValue([{ id_agent: 7 }, { id_agent: 16 }]);
    const r = await crearMesaRuta(req('/api/proyectos/7/mesas', 'POST', MESA), params);
    expect(r.status).toBe(201);
    expect((await r.json()).avisos).toHaveLength(1);
    expect(db.chatProjectAgent.createMany).not.toHaveBeenCalled();
  });

  it('en un proyecto sin código: se crea sin avisos', async () => {
    const r = await crearMesaRuta(req('/api/proyectos/7/mesas', 'POST', MESA), params);
    expect(r.status).toBe(201);
    expect((await r.json()).avisos).toEqual([]);
  });

  it('GET ?candidatos=1 dice si el proyecto tiene código y quién es de desarrollo', async () => {
    proyectoConCodigo();
    const body = await (await verMesas(req('/api/proyectos/7/mesas?candidatos=1'), params)).json();
    expect(body.conCodigo).toBe(true);
    expect(body.candidatos.map((c: { nombre: string; esDesarrollo: boolean }) => [c.nombre, c.esDesarrollo])).toEqual([
      ['Orus', true],
      ['Play', false],
    ]);
  });
});
