import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Puertas de los PROYECTOS (lib/chat/projects.ts): quién entra a un proyecto
 * y a sus conversaciones. Un no miembro NO ve el proyecto; un permiso del
 * agente revocado lo cierra; un archivado o un agente sin el interruptor,
 * tampoco. Del lado del agente, solo proyectos de SU agente.
 */
const findProject = vi.hoisted(() => vi.fn());
const findConversation = vi.hoisted(() => vi.fn());
const agentAccess = vi.hoisted(() => vi.fn());

vi.mock('../../prisma', () => ({
  prisma: {
    chatProject: { findUnique: findProject },
    chatConversation: { findFirst: findConversation },
  },
}));
vi.mock('../access', () => ({
  CHAT_MODULE_URL: '/process/chat',
  getChatAccess: vi.fn(),
  getChatAgentAccess: agentAccess,
}));

import { assertAgentProjectConversation, assertProjectConversationAccess, resolveProjectForUser } from '../projects';
import { __resetProjectAgentsCache } from '../projects-rules';

const ANA = { id: 'u-ana', email: 'ana@gsslatam.com' };
const EMPRESA = 3;
const PLAY = 21;

function proyecto(over: Record<string, unknown> = {}) {
  return {
    id_project: 7,
    name: 'Comex Latam',
    id_agent: PLAY,
    id_company: EMPRESA,
    profile: 'comex-latam',
    archived: false,
    agent: { code: 'play', is_active: true },
    members: [{ role: 'member' }],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetProjectAgentsCache();
  process.env.CHAT_PROJECTS_AGENTS = '{"play":["comex-latam","olp"]}';
  agentAccess.mockResolvedValue({ idAgent: PLAY, companies: [{ idCompany: EMPRESA, companyName: 'OLP', isPrimary: true }] });
});

describe('resolveProjectForUser', () => {
  it('un miembro con el permiso del agente entra', async () => {
    findProject.mockResolvedValue(proyecto());
    const r = await resolveProjectForUser(ANA, 7);
    expect(r).toMatchObject({ idProject: 7, idAgent: PLAY, role: 'member', profile: 'comex-latam' });
    // La pertenencia se consulta SOLO para la persona de la sesión.
    expect(findProject.mock.calls[0][0].select.members.where).toEqual({ id_user: ANA.id });
  });

  it('un NO miembro no ve el proyecto', async () => {
    findProject.mockResolvedValue(proyecto({ members: [] }));
    expect(await resolveProjectForUser(ANA, 7)).toBeNull();
  });

  it('el dueño queda como owner', async () => {
    findProject.mockResolvedValue(proyecto({ members: [{ role: 'owner' }] }));
    expect((await resolveProjectForUser(ANA, 7))?.role).toBe('owner');
  });

  it('un permiso del agente revocado cierra el proyecto', async () => {
    findProject.mockResolvedValue(proyecto());
    agentAccess.mockResolvedValue(null);
    expect(await resolveProjectForUser(ANA, 7)).toBeNull();
  });

  it('con el permiso en OTRA empresa, tampoco entra', async () => {
    findProject.mockResolvedValue(proyecto());
    agentAccess.mockResolvedValue({ idAgent: PLAY, companies: [{ idCompany: 99, companyName: 'X', isPrimary: false }] });
    expect(await resolveProjectForUser(ANA, 7)).toBeNull();
  });

  it('archivado o agente sin interruptor: no entra nadie', async () => {
    findProject.mockResolvedValue(proyecto({ archived: true }));
    expect(await resolveProjectForUser(ANA, 7)).toBeNull();
    findProject.mockResolvedValue(proyecto());
    process.env.CHAT_PROJECTS_AGENTS = '';
    __resetProjectAgentsCache();
    expect(await resolveProjectForUser(ANA, 7)).toBeNull();
  });

  it('ids basura no llegan a la base', async () => {
    expect(await resolveProjectForUser(ANA, -1)).toBeNull();
    expect(await resolveProjectForUser(ANA, '7' as unknown as number)).toBeNull();
    expect(findProject).not.toHaveBeenCalled();
  });
});

describe('assertProjectConversationAccess', () => {
  it('solo conversaciones kind = project', async () => {
    findConversation.mockResolvedValue(null);
    expect(await assertProjectConversationAccess(ANA, 40)).toBeNull();
    expect(findConversation.mock.calls[0][0].where).toMatchObject({ id: 40, kind: 'project' });
  });

  it('miembro: entra a la conversación', async () => {
    findConversation.mockResolvedValue({ id: 40, id_project: 7, id_agent: PLAY, archived: false });
    findProject.mockResolvedValue(proyecto());
    expect(await assertProjectConversationAccess(ANA, 40)).toMatchObject({ conversationId: 40, idProject: 7 });
  });

  it('no miembro: no entra a la conversación', async () => {
    findConversation.mockResolvedValue({ id: 40, id_project: 7, id_agent: PLAY, archived: false });
    findProject.mockResolvedValue(proyecto({ members: [] }));
    expect(await assertProjectConversationAccess(ANA, 40)).toBeNull();
  });

  it('una conversación cuyo agente no es el del proyecto se rechaza', async () => {
    findConversation.mockResolvedValue({ id: 40, id_project: 7, id_agent: 99, archived: false });
    findProject.mockResolvedValue(proyecto());
    expect(await assertProjectConversationAccess(ANA, 40)).toBeNull();
  });
});

describe('assertAgentProjectConversation (llave del puente)', () => {
  it('anclada al agente de la llave por la conversación Y por el proyecto', async () => {
    findConversation.mockResolvedValue({ id: 40, project: { id_project: 7, name: 'Comex', agent: { code: 'play' } } });
    expect(await assertAgentProjectConversation(PLAY, 40)).toEqual({ id: 40, idProject: 7, projectName: 'Comex' });
    expect(findConversation.mock.calls[0][0].where).toEqual({
      id: 40,
      kind: 'project',
      id_agent: PLAY,
      project: { id_agent: PLAY, archived: false },
    });
  });

  it('sin interruptor para el agente, nada', async () => {
    findConversation.mockResolvedValue({ id: 40, project: { id_project: 7, name: 'X', agent: { code: 'horus' } } });
    expect(await assertAgentProjectConversation(PLAY, 40)).toBeNull();
  });
});
