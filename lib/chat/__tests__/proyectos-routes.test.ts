import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Rutas del módulo «Proyectos» (app/api/proyectos/**) del lado de la persona:
 *   - un NO miembro recibe 404 en TODAS (no se confirma que el proyecto exista);
 *   - un lector lee, pero no escribe, no vincula ni carga archivos (403);
 *   - un editor no administra (403);
 *   - el dueño solo invita a quien tiene el permiso del módulo en la empresa.
 */
const sessionUser = vi.hoisted(() => vi.fn());
const resolveProject = vi.hoisted(() => vi.fn());
const writeAccess = vi.hoisted(() => vi.fn());
const eligible = vi.hoisted(() => vi.fn());
const detail = vi.hoisted(() => vi.fn());
const updateProject = vi.hoisted(() => vi.fn());
const createMembers = vi.hoisted(() => vi.fn());
const findMembers = vi.hoisted(() => vi.fn());
const findMember = vi.hoisted(() => vi.fn());
const createConversation = vi.hoisted(() => vi.fn());
const findAgent = vi.hoisted(() => vi.fn());
const createAgents = vi.hoisted(() => vi.fn());

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('../../../app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../prisma', () => ({
  prisma: {
    chatProject: { update: updateProject, count: vi.fn(async () => 0) },
    chatProjectMember: { createMany: createMembers, findMany: findMembers, findFirst: findMember, update: vi.fn(), delete: vi.fn() },
    chatProjectAgent: { createMany: createAgents, findMany: vi.fn(async () => []), delete: vi.fn() },
    chatConversation: { count: vi.fn(async () => 0), create: createConversation },
    agent: { findFirst: findAgent },
    $transaction: vi.fn(),
  },
}));
vi.mock('../http', async (importOriginal) => {
  const real = await importOriginal<typeof import('../http')>();
  return { ...real, resolveSessionUser: sessionUser };
});
vi.mock('../projects', () => ({
  resolveProjectForUser: resolveProject,
  writeAccessForAgent: writeAccess,
  eligibleProjectUsers: eligible,
  getProjectDetail: detail,
  designableAgents: vi.fn(async () => new Map()),
}));
vi.mock('../projects-links', async (importOriginal) => {
  const real = await importOriginal<typeof import('../projects-links')>();
  return {
    ...real,
    vinculosDelProyecto: vi.fn(async () => ({ emails: [], requests: [] })),
    vincularCorreo: vi.fn(async () => ({ id: 1 })),
    vincularSolicitud: vi.fn(async () => ({ id: 1 })),
    buscarHilosPropios: vi.fn(async () => ({ mailbox: 'x', threads: [] })),
    buscarSolicitudesVisibles: vi.fn(async () => []),
  };
});
vi.mock('../../correo/runtime', () => ({ correoDeps: () => ({}) }));

import { NextRequest } from 'next/server';
import { DELETE as archivar, GET as detalle, PATCH as editar } from '../../../app/api/proyectos/[id]/route';
import { PATCH as cambiarRol, POST as invitar } from '../../../app/api/proyectos/[id]/miembros/route';
import { POST as nuevaConversacion } from '../../../app/api/proyectos/[id]/conversaciones/route';
import { POST as subirArchivos } from '../../../app/api/proyectos/[id]/archivos/route';
import { POST as designar } from '../../../app/api/proyectos/[id]/agentes/route';
import { POST as vincularCorreoRuta } from '../../../app/api/proyectos/[id]/vinculos/correos/route';
import { POST as vincularSolicitudRuta } from '../../../app/api/proyectos/[id]/vinculos/solicitudes/route';
import { DELETE as quitarCorreo } from '../../../app/api/proyectos/[id]/vinculos/correos/[linkId]/route';

const params = (id = '7') => ({ params: Promise.resolve({ id }) });
const req = (url: string, init?: { method?: string; body?: string }) =>
  new NextRequest(`http://x${url}`, init?.body ? { ...init, headers: { 'Content-Type': 'application/json' } } : init);
const proyecto = (role: 'owner' | 'editor' | 'reader', archived = false) => ({ idProject: 7, name: 'Comex', idCompany: 3, profile: 'olp', role, archived });
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  sessionUser.mockResolvedValue({ id: 'u-ana', email: 'ana@gsslatam.com' });
  detail.mockResolvedValue({ idProject: 7 });
  findMembers.mockResolvedValue([]);
  findAgent.mockResolvedValue({ id_agent: 21, display_name: 'Play' });
});

describe('un NO miembro: 404 en todo', () => {
  beforeEach(() => resolveProject.mockResolvedValue(null));

  it('no ve, no edita, no archiva, no invita, no conversa, no vincula ni carga', async () => {
    const respuestas = await Promise.all([
      detalle(req('/api/proyectos/7'), params()),
      editar(req('/api/proyectos/7', json('PATCH', { name: 'x' })), params()),
      archivar(req('/api/proyectos/7', { method: 'DELETE' }), params()),
      invitar(req('/api/proyectos/7/miembros', json('POST', { idUsers: ['u2'] })), params()),
      nuevaConversacion(req('/api/proyectos/7/conversaciones', json('POST', { agentCode: 'play' })), params()),
      subirArchivos(req('/api/proyectos/7/archivos', { method: 'POST' }), params()),
      designar(req('/api/proyectos/7/agentes', json('POST', { agentCodes: ['play'] })), params()),
      vincularCorreoRuta(req('/api/proyectos/7/vinculos/correos', json('POST', { conversationId: 'AAQkAD12345' })), params()),
      vincularSolicitudRuta(req('/api/proyectos/7/vinculos/solicitudes', json('POST', { idRequest: 5 })), params()),
      quitarCorreo(req('/api/proyectos/7/vinculos/correos/1', { method: 'DELETE' }), { params: Promise.resolve({ id: '7', linkId: '1' }) }),
    ]);
    expect(respuestas.map((r) => r.status)).toEqual(Array(10).fill(404));
    expect(updateProject).not.toHaveBeenCalled();
    expect(createMembers).not.toHaveBeenCalled();
    expect(createConversation).not.toHaveBeenCalled();
  });

  it('sin sesión: 401', async () => {
    sessionUser.mockResolvedValue(null);
    expect((await detalle(req('/api/proyectos/7'), params())).status).toBe(401);
  });

  it('el detalle de un archivado se pide con allowArchived (solo su dueño pasa la puerta)', async () => {
    await detalle(req('/api/proyectos/7'), params());
    expect(resolveProject).toHaveBeenCalledWith({ id: 'u-ana', email: 'ana@gsslatam.com' }, 7, { allowArchived: true });
  });
});

describe('un LECTOR', () => {
  beforeEach(() => {
    resolveProject.mockResolvedValue(proyecto('reader'));
    writeAccess.mockResolvedValue({ ok: false, motivo: 'Usted es lector en este proyecto.' });
  });

  it('ve el proyecto', async () => {
    expect((await detalle(req('/api/proyectos/7'), params())).status).toBe(200);
  });

  it('no abre conversaciones (403 con el motivo)', async () => {
    const r = await nuevaConversacion(req('/api/proyectos/7/conversaciones', json('POST', { agentCode: 'play' })), params());
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/lector/);
    expect(createConversation).not.toHaveBeenCalled();
  });

  it('no carga archivos', async () => {
    expect((await subirArchivos(req('/api/proyectos/7/archivos', { method: 'POST' }), params())).status).toBe(403);
  });
});

describe('un EDITOR', () => {
  beforeEach(() => resolveProject.mockResolvedValue(proyecto('editor')));

  it('no edita, no archiva, no invita, no cambia roles ni designa agentes (403)', async () => {
    const r = await Promise.all([
      editar(req('/api/proyectos/7', json('PATCH', { instructions: 'x' })), params()),
      archivar(req('/api/proyectos/7', { method: 'DELETE' }), params()),
      invitar(req('/api/proyectos/7/miembros', json('POST', { idUsers: ['u2'] })), params()),
      cambiarRol(req('/api/proyectos/7/miembros', json('PATCH', { idUser: 'u2', role: 'reader' })), params()),
      designar(req('/api/proyectos/7/agentes', json('POST', { agentCodes: ['play'] })), params()),
    ]);
    expect(r.map((x) => x.status)).toEqual([403, 403, 403, 403, 403]);
  });

  it('abre una conversación con un agente que puede usar', async () => {
    writeAccess.mockResolvedValue({ ok: true });
    createConversation.mockResolvedValue({ id: 50 });
    const { prisma } = await import('../../prisma');
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({ chatConversation: { create: createConversation }, chatMessage: { create: vi.fn() }, chatProject: { update: vi.fn() } })
    );
    const r = await nuevaConversacion(req('/api/proyectos/7/conversaciones', json('POST', { agentCode: 'play' })), params());
    expect(r.status).toBe(201);
    expect(writeAccess).toHaveBeenCalledWith(expect.objectContaining({ id: 'u-ana' }), expect.objectContaining({ idProject: 7 }), 21);
    expect(createConversation.mock.calls[0][0].data).toMatchObject({ kind: 'project', id_project: 7, id_agent: 21, id_user: 'u-ana' });
  });
});

describe('el DUEÑO', () => {
  beforeEach(() => resolveProject.mockResolvedValue(proyecto('owner')));

  it('solo invita a quien tiene el permiso del módulo en la empresa del proyecto', async () => {
    eligible.mockResolvedValue([{ id: 'u2' }]);
    const r = await invitar(req('/api/proyectos/7/miembros', json('POST', { idUsers: ['u2', 'u-sin-permiso'], role: 'reader' })), params());
    expect(r.status).toBe(409);
    expect(eligible).toHaveBeenCalledWith(3, ['u2', 'u-sin-permiso']);
    expect(createMembers).not.toHaveBeenCalled();
  });

  it('invita con el rol escogido (editor por defecto, nunca dueño)', async () => {
    eligible.mockResolvedValue([{ id: 'u2' }]);
    expect((await invitar(req('/api/proyectos/7/miembros', json('POST', { idUsers: ['u2'], role: 'reader' })), params())).status).toBe(201);
    expect(createMembers.mock.calls[0][0].data).toEqual([{ id_project: 7, id_user: 'u2', role: 'reader', added_by: 'u-ana' }]);
    expect((await invitar(req('/api/proyectos/7/miembros', json('POST', { idUsers: ['u2'], role: 'owner' })), params())).status).toBe(400);
  });

  it('no le cambia el rol al dueño', async () => {
    findMember.mockResolvedValue({ id_project_member: 1, role: 'owner' });
    expect((await cambiarRol(req('/api/proyectos/7/miembros', json('PATCH', { idUser: 'u-ana', role: 'reader' })), params())).status).toBe(403);
  });

  it('un archivado solo se puede restaurar', async () => {
    resolveProject.mockResolvedValue(proyecto('owner', true));
    expect((await editar(req('/api/proyectos/7', json('PATCH', { name: 'Otro' })), params())).status).toBe(403);
    expect((await editar(req('/api/proyectos/7', json('PATCH', { archived: false })), params())).status).toBe(200);
    expect(updateProject).toHaveBeenCalledWith({ where: { id_project: 7 }, data: { archived: false } });
  });
});
