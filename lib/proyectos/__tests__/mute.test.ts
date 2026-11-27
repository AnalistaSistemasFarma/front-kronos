import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * «Silenciar notificaciones» of a project (2026-11-23, msg 38059):
 *   - per person: a row in chat_project_mute; muting twice keeps one row, unmuting is idempotent;
 *   - push recipients skip whoever muted (and inactive users), never the others;
 *   - reads fail open: if the table cannot be read, everybody keeps getting notifications;
 *   - the route: any member (the project gate), boolean body only.
 */
const m = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  deleteMany: vi.fn(),
  guard: vi.fn(),
}));

vi.mock('../../prisma', () => ({
  prisma: { chatProjectMute: { findMany: m.findMany, findUnique: m.findUnique, create: m.create, deleteMany: m.deleteMany } },
}));
vi.mock('../../chat/projects-guard', () => ({ guardProject: m.guard }));

import { NextRequest, NextResponse } from 'next/server';
import { isProjectMuted, mutedProjectIds, projectMutedUserIds, projectPushRecipients, setProjectMuted } from '../mute';
import { GET, PATCH } from '../../../app/api/proyectos/[id]/notificaciones/route';

const ANA = { id: 'u-ana', email: 'ana@gsslatam.com' };
const ctx = (id = '7') => ({ params: Promise.resolve({ id }) });
const patch = (body: unknown) =>
  new NextRequest('http://x/api/proyectos/7/notificaciones', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => {
  vi.clearAllMocks();
  m.findMany.mockResolvedValue([]);
  m.findUnique.mockResolvedValue(null);
  m.create.mockResolvedValue({});
  m.deleteMany.mockResolvedValue({ count: 0 });
  m.guard.mockResolvedValue({ user: ANA, project: { idProject: 7, role: 'reader', archived: false } });
});

describe('push recipients', () => {
  const member = (id: string, email: string, isActive = true) => ({ id_user: id, user: { email, isActive } });

  it('skips whoever muted the project and inactive users, keeps everyone else', () => {
    const members = [member('u-ana', 'ana@x'), member('u-bob', 'bob@x'), member('u-cy', 'cy@x', false), member('u-di', ' ')];
    expect(projectPushRecipients(members, new Set(['u-ana']))).toEqual(['bob@x']);
    expect(projectPushRecipients(members, new Set())).toEqual(['ana@x', 'bob@x']);
  });
});

describe('reads (fail open)', () => {
  it('muted projects of a person', async () => {
    m.findMany.mockResolvedValue([{ id_project: 3 }, { id_project: 7 }]);
    expect(await mutedProjectIds('u-ana')).toEqual(new Set([3, 7]));
    expect(m.findMany).toHaveBeenCalledWith({ where: { id_user: 'u-ana' }, select: { id_project: true } });
  });

  it('muted members of a project', async () => {
    m.findMany.mockResolvedValue([{ id_user: 'u-ana' }]);
    expect(await projectMutedUserIds(7)).toEqual(new Set(['u-ana']));
    expect(m.findMany).toHaveBeenCalledWith({ where: { id_project: 7 }, select: { id_user: true } });
  });

  it('an error (e.g. the table does not exist yet) means nobody is muted', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    m.findMany.mockRejectedValue(new Error('Invalid object name'));
    m.findUnique.mockRejectedValue(new Error('Invalid object name'));
    expect(await mutedProjectIds('u-ana')).toEqual(new Set());
    expect(await projectMutedUserIds(7)).toEqual(new Set());
    expect(await isProjectMuted(7, 'u-ana')).toBe(false);
    err.mockRestore();
  });
});

describe('writes', () => {
  it('mute creates the row; a duplicate (two tabs) is fine', async () => {
    await setProjectMuted(7, 'u-ana', true);
    expect(m.create).toHaveBeenCalledWith({ data: { id_project: 7, id_user: 'u-ana' } });
    m.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    await expect(setProjectMuted(7, 'u-ana', true)).resolves.toBeUndefined();
  });

  it('any other error propagates', async () => {
    m.create.mockRejectedValue(new Error('db down'));
    await expect(setProjectMuted(7, 'u-ana', true)).rejects.toThrow('db down');
  });

  it('unmute deletes only that person\'s row', async () => {
    await setProjectMuted(7, 'u-ana', false);
    expect(m.deleteMany).toHaveBeenCalledWith({ where: { id_project: 7, id_user: 'u-ana' } });
    expect(m.create).not.toHaveBeenCalled();
  });
});

describe('route /api/proyectos/[id]/notificaciones', () => {
  it('without passing the project gate: its response and nothing is written', async () => {
    m.guard.mockResolvedValue({ response: NextResponse.json({ error: 'No encontrado' }, { status: 404 }) });
    expect((await PATCH(patch({ muted: true }), ctx())).status).toBe(404);
    expect((await GET(new NextRequest('http://x'), ctx())).status).toBe(404);
    expect(m.create).not.toHaveBeenCalled();
  });

  it('a reader can mute and unmute (it only affects them)', async () => {
    let res = await PATCH(patch({ muted: true }), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ muted: true });
    expect(m.create).toHaveBeenCalledWith({ data: { id_project: 7, id_user: 'u-ana' } });
    expect(m.guard).toHaveBeenCalledWith('7');

    res = await PATCH(patch({ muted: false }), ctx());
    expect(await res.json()).toEqual({ muted: false });
    expect(m.deleteMany).toHaveBeenCalledWith({ where: { id_project: 7, id_user: 'u-ana' } });
  });

  it('the body must carry a boolean', async () => {
    expect((await PATCH(patch({ muted: 'si' }), ctx())).status).toBe(400);
    expect((await PATCH(patch([]), ctx())).status).toBe(400);
    expect(m.create).not.toHaveBeenCalled();
    expect(m.deleteMany).not.toHaveBeenCalled();
  });

  it('GET says whether this person muted it', async () => {
    m.findUnique.mockResolvedValue({ id_project_mute: 1 });
    const res = await GET(new NextRequest('http://x'), ctx());
    expect(await res.json()).toEqual({ muted: true });
    expect(m.findUnique).toHaveBeenCalledWith({
      where: { id_project_id_user: { id_project: 7, id_user: 'u-ana' } },
      select: { id_project_mute: true },
    });
  });
});
