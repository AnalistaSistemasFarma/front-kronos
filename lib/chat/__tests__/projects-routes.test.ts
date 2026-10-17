import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Rutas de PROYECTOS del lado de la persona: un no miembro no ve el proyecto
 * (404), un miembro no administra (403) y el dueño no se puede retirar.
 */
const sessionUser = vi.hoisted(() => vi.fn());
const resolveProject = vi.hoisted(() => vi.fn());
const findMember = vi.hoisted(() => vi.fn());
const deleteMember = vi.hoisted(() => vi.fn());
const createMany = vi.hoisted(() => vi.fn());
const eligible = vi.hoisted(() => vi.fn());
const updateProject = vi.hoisted(() => vi.fn());

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('../../../app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../prisma', () => ({
  prisma: {
    chatProjectMember: { findFirst: findMember, findMany: vi.fn(async () => []), delete: deleteMember, createMany },
    chatProject: { update: updateProject },
  },
}));
vi.mock('../http', async (importOriginal) => {
  const real = await importOriginal<typeof import('../http')>();
  return { ...real, resolveSessionUser: sessionUser };
});
vi.mock('../projects', () => ({
  resolveProjectForUser: resolveProject,
  eligibleProjectUsers: eligible,
  getProjectDetail: vi.fn(async () => ({ idProject: 7 })),
}));

import { NextRequest } from 'next/server';
import { GET as getProject, PATCH, DELETE as archive } from '../../../app/api/chat/projects/[id]/route';
import { DELETE as removeMember, POST as invite } from '../../../app/api/chat/projects/[id]/members/route';

const params = (id = '7') => ({ params: Promise.resolve({ id }) });
const req = (url: string, init?: RequestInit) => new NextRequest(`http://x${url}`, init as never);
const proyecto = (role: 'owner' | 'member') => ({
  idProject: 7, name: 'Comex', idAgent: 21, agentCode: 'play', idCompany: 3, profile: 'olp', role,
});

beforeEach(() => {
  vi.clearAllMocks();
  sessionUser.mockResolvedValue({ id: 'u-ana', email: 'ana@gsslatam.com' });
});

describe('un NO miembro', () => {
  it('no ve el proyecto (404, no 403)', async () => {
    resolveProject.mockResolvedValue(null);
    expect((await getProject(req('/api/chat/projects/7'), params())).status).toBe(404);
  });

  it('no puede invitar ni archivar', async () => {
    resolveProject.mockResolvedValue(null);
    const r1 = await invite(req('/api/chat/projects/7/members', { method: 'POST', body: JSON.stringify({ idUsers: ['u2'] }) }), params());
    const r2 = await archive(req('/api/chat/projects/7', { method: 'DELETE' }), params());
    expect(r1.status).toBe(404);
    expect(r2.status).toBe(404);
    expect(createMany).not.toHaveBeenCalled();
    expect(updateProject).not.toHaveBeenCalled();
  });

  it('sin sesión: 401', async () => {
    sessionUser.mockResolvedValue(null);
    expect((await getProject(req('/api/chat/projects/7'), params())).status).toBe(401);
  });
});

describe('un miembro (no dueño)', () => {
  beforeEach(() => resolveProject.mockResolvedValue(proyecto('member')));

  it('ve el proyecto', async () => {
    expect((await getProject(req('/api/chat/projects/7'), params())).status).toBe(200);
  });

  it('no invita, no edita instrucciones, no archiva (403)', async () => {
    const r1 = await invite(req('/api/chat/projects/7/members', { method: 'POST', body: JSON.stringify({ idUsers: ['u2'] }) }), params());
    const r2 = await PATCH(req('/api/chat/projects/7', { method: 'PATCH', body: JSON.stringify({ instructions: 'x' }) }), params());
    const r3 = await archive(req('/api/chat/projects/7', { method: 'DELETE' }), params());
    expect([r1.status, r2.status, r3.status]).toEqual([403, 403, 403]);
  });

  it('no retira a otro, pero sí puede salirse', async () => {
    findMember.mockResolvedValue({ id_project_member: 50, role: 'member' });
    expect((await removeMember(req('/api/chat/projects/7/members?idUser=u-otro', { method: 'DELETE' }), params())).status).toBe(403);
    expect(deleteMember).not.toHaveBeenCalled();
    expect((await removeMember(req('/api/chat/projects/7/members?idUser=u-ana', { method: 'DELETE' }), params())).status).toBe(200);
  });
});

describe('el dueño', () => {
  beforeEach(() => resolveProject.mockResolvedValue(proyecto('owner')));

  it('solo invita personas con el asistente en la empresa del proyecto', async () => {
    eligible.mockResolvedValue([{ id: 'u2' }]);
    const r = await invite(
      req('/api/chat/projects/7/members', { method: 'POST', body: JSON.stringify({ idUsers: ['u2', 'u-sin-permiso'] }) }),
      params()
    );
    expect(r.status).toBe(409);
    expect(createMany).not.toHaveBeenCalled();
    expect(eligible).toHaveBeenCalledWith(21, 3, ['u2', 'u-sin-permiso']);
  });

  it('invita a quien sí cumple', async () => {
    eligible.mockResolvedValue([{ id: 'u2' }]);
    const r = await invite(req('/api/chat/projects/7/members', { method: 'POST', body: JSON.stringify({ idUsers: ['u2'] }) }), params());
    expect(r.status).toBe(201);
    expect(createMany.mock.calls[0][0].data).toEqual([{ id_project: 7, id_user: 'u2', role: 'member', added_by: 'u-ana' }]);
  });

  it('no se puede retirar a sí mismo', async () => {
    findMember.mockResolvedValue({ id_project_member: 49, role: 'owner' });
    expect((await removeMember(req('/api/chat/projects/7/members?idUser=u-ana', { method: 'DELETE' }), params())).status).toBe(403);
  });
});
