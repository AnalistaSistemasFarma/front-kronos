import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Puertas del módulo «Proyectos» (lib/chat/projects.ts).
 *   - Entrar: miembro + permiso del módulo en la empresa del proyecto. Un no
 *     miembro, un permiso revocado o un archivado (salvo su dueño) → null (404).
 *   - Escribir: dueño o editor + agente designado y habilitado + la persona lo
 *     tiene asignado en la empresa del proyecto. Un lector lee pero no escribe.
 *   - Agente (llave del puente): solo SUS conversaciones en proyectos activos
 *     donde está designado.
 */
const findProject = vi.hoisted(() => vi.fn());
const findConversation = vi.hoisted(() => vi.fn());
const moduleCount = vi.hoisted(() => vi.fn());
const findDesignation = vi.hoisted(() => vi.fn());
const chatAccess = vi.hoisted(() => vi.fn());

vi.mock('../../prisma', () => ({
  prisma: {
    chatProject: { findUnique: findProject },
    chatConversation: { findFirst: findConversation },
    subprocessUserCompany: { count: moduleCount },
    chatProjectAgent: { findFirst: findDesignation },
  },
}));
vi.mock('../access', () => ({ CHAT_MODULE_URL: '/process/chat', getChatAccess: chatAccess, getChatAgentAccess: vi.fn() }));

import {
  assertAgentProjectConversation,
  assertProjectConversationAccess,
  resolveProjectForUser,
  writeAccessForAgent,
} from '../projects';
import { __resetProjectAgentsCache } from '../projects-rules';

const ANA = { id: 'u-ana', email: 'ana@gsslatam.com' };
const EMPRESA = 3;
const PLAY = 21;

function proyecto(over: Record<string, unknown> = {}) {
  return { id_project: 7, name: 'Comex Latam', id_company: EMPRESA, profile: 'comex-latam', archived: false, members: [{ role: 'editor' }], ...over };
}
const designado = (over: Record<string, unknown> = {}) => ({ agent: { id_agent: PLAY, code: 'play', is_active: true, ...over } });
const conAgente = (empresas: number[]) => ({
  canUseChat: true,
  companies: [],
  agents: [{ idAgent: PLAY, code: 'play', companies: empresas.map((idCompany) => ({ idCompany, companyName: 'X', isPrimary: false })) }],
});

beforeEach(() => {
  vi.clearAllMocks();
  __resetProjectAgentsCache();
  process.env.CHAT_PROJECTS_AGENTS = '{"play":["comex-latam","olp"]}';
  moduleCount.mockResolvedValue(1);
  findDesignation.mockResolvedValue(designado());
  chatAccess.mockResolvedValue(conAgente([EMPRESA]));
});

describe('resolveProjectForUser (entrar)', () => {
  it('un miembro con el permiso del módulo entra', async () => {
    findProject.mockResolvedValue(proyecto());
    expect(await resolveProjectForUser(ANA, 7)).toMatchObject({ idProject: 7, role: 'editor', idCompany: EMPRESA, archived: false });
    // La pertenencia se consulta SOLO para la persona de la sesión…
    expect(findProject.mock.calls[0][0].select.members.where).toEqual({ id_user: ANA.id });
    // …y el permiso del módulo, en la empresa DEL PROYECTO.
    expect(moduleCount.mock.calls[0][0].where.companyUser).toMatchObject({ id_user: ANA.id, id_company: EMPRESA });
    expect(moduleCount.mock.calls[0][0].where.subprocess).toEqual({ subprocess_url: '/process/proyectos' });
  });

  it('el «member» de la F1 se lee como editor; dueño y lector se respetan', async () => {
    findProject.mockResolvedValue(proyecto({ members: [{ role: 'member' }] }));
    expect((await resolveProjectForUser(ANA, 7))?.role).toBe('editor');
    findProject.mockResolvedValue(proyecto({ members: [{ role: 'owner' }] }));
    expect((await resolveProjectForUser(ANA, 7))?.role).toBe('owner');
    findProject.mockResolvedValue(proyecto({ members: [{ role: 'reader' }] }));
    expect((await resolveProjectForUser(ANA, 7))?.role).toBe('reader');
  });

  it('un NO miembro no ve el proyecto (404)', async () => {
    findProject.mockResolvedValue(proyecto({ members: [] }));
    expect(await resolveProjectForUser(ANA, 7)).toBeNull();
    expect(moduleCount).not.toHaveBeenCalled();
  });

  it('sin el permiso del módulo en esa empresa (revocado), tampoco', async () => {
    findProject.mockResolvedValue(proyecto());
    moduleCount.mockResolvedValue(0);
    expect(await resolveProjectForUser(ANA, 7)).toBeNull();
  });

  it('archivado: nadie entra; su dueño solo con allowArchived (para restaurarlo)', async () => {
    findProject.mockResolvedValue(proyecto({ archived: true }));
    expect(await resolveProjectForUser(ANA, 7, { allowArchived: true })).toBeNull();
    findProject.mockResolvedValue(proyecto({ archived: true, members: [{ role: 'owner' }] }));
    expect(await resolveProjectForUser(ANA, 7)).toBeNull();
    expect(await resolveProjectForUser(ANA, 7, { allowArchived: true })).toMatchObject({ archived: true, role: 'owner' });
  });

  it('ids basura no llegan a la base', async () => {
    expect(await resolveProjectForUser(ANA, -1)).toBeNull();
    expect(await resolveProjectForUser(ANA, '7' as unknown as number)).toBeNull();
    expect(findProject).not.toHaveBeenCalled();
  });
});

describe('escribirle a un agente', () => {
  const acceso = (role: 'owner' | 'editor' | 'reader') => ({ idProject: 7, name: 'Comex', idCompany: EMPRESA, profile: 'comex-latam', role, archived: false });

  it('editor con el agente asignado en la empresa del proyecto: sí', async () => {
    expect(await writeAccessForAgent(ANA, acceso('editor'), PLAY)).toEqual({ ok: true });
  });

  it('lector: no (y ni siquiera se consulta su permiso del agente)', async () => {
    const r = await writeAccessForAgent(ANA, acceso('reader'), PLAY);
    expect(r.ok).toBe(false);
    expect(chatAccess).not.toHaveBeenCalled();
  });

  it('sin el agente asignado en ESA empresa: no (el agente no es una puerta a datos ajenos)', async () => {
    chatAccess.mockResolvedValue(conAgente([99]));
    expect((await writeAccessForAgent(ANA, acceso('owner'), PLAY)).ok).toBe(false);
  });

  it('agente retirado del proyecto, inactivo, sin interruptor o sin el perfil: no', async () => {
    findDesignation.mockResolvedValue(null);
    expect((await writeAccessForAgent(ANA, acceso('owner'), PLAY)).ok).toBe(false);
    findDesignation.mockResolvedValue(designado({ is_active: false }));
    expect((await writeAccessForAgent(ANA, acceso('owner'), PLAY)).ok).toBe(false);
    findDesignation.mockResolvedValue(designado());
    expect((await writeAccessForAgent(ANA, { ...acceso('owner'), profile: 'gss' }, PLAY)).ok).toBe(false);
    process.env.CHAT_PROJECTS_AGENTS = '';
    __resetProjectAgentsCache();
    expect((await writeAccessForAgent(ANA, acceso('owner'), PLAY)).ok).toBe(false);
  });

  it('la designación se busca en ESTE proyecto', async () => {
    await writeAccessForAgent(ANA, acceso('editor'), PLAY);
    expect(findDesignation.mock.calls[0][0].where).toEqual({ id_project: 7, id_agent: PLAY });
  });
});

describe('assertProjectConversationAccess (conversación)', () => {
  it('solo conversaciones kind = project', async () => {
    findConversation.mockResolvedValue(null);
    expect(await assertProjectConversationAccess(ANA, 40)).toBeNull();
    expect(findConversation.mock.calls[0][0].where).toMatchObject({ id: 40, kind: 'project' });
  });

  it('miembro: entra y puede escribir con el agente de ESA conversación', async () => {
    findConversation.mockResolvedValue({ id: 40, id_project: 7, id_agent: PLAY, archived: false });
    findProject.mockResolvedValue(proyecto());
    expect(await assertProjectConversationAccess(ANA, 40)).toMatchObject({ conversationId: 40, idProject: 7, idAgent: PLAY, writable: { ok: true } });
  });

  it('lector: entra a leer, pero no escribe', async () => {
    findConversation.mockResolvedValue({ id: 40, id_project: 7, id_agent: PLAY, archived: false });
    findProject.mockResolvedValue(proyecto({ members: [{ role: 'reader' }] }));
    const r = await assertProjectConversationAccess(ANA, 40);
    expect(r?.conversationId).toBe(40);
    expect(r?.writable.ok).toBe(false);
  });

  it('no miembro: no entra a la conversación (404)', async () => {
    findConversation.mockResolvedValue({ id: 40, id_project: 7, id_agent: PLAY, archived: false });
    findProject.mockResolvedValue(proyecto({ members: [] }));
    expect(await assertProjectConversationAccess(ANA, 40)).toBeNull();
  });

  it('proyecto archivado: ni el dueño entra a sus conversaciones', async () => {
    findConversation.mockResolvedValue({ id: 40, id_project: 7, id_agent: PLAY, archived: false });
    findProject.mockResolvedValue(proyecto({ archived: true, members: [{ role: 'owner' }] }));
    expect(await assertProjectConversationAccess(ANA, 40)).toBeNull();
  });
});

describe('assertAgentProjectConversation (llave del puente)', () => {
  it('anclada al agente de la llave: SU conversación, en un proyecto activo donde está designado', async () => {
    findConversation.mockResolvedValue({ id: 40, agent: { code: 'play' }, project: { id_project: 7, name: 'Comex', profile: 'comex-latam' } });
    expect(await assertAgentProjectConversation(PLAY, 40)).toEqual({ id: 40, idProject: 7, projectName: 'Comex' });
    expect(findConversation.mock.calls[0][0].where).toEqual({
      id: 40,
      kind: 'project',
      archived: false,
      id_agent: PLAY,
      project: { archived: false, agents: { some: { id_agent: PLAY } } },
    });
  });

  it('sin interruptor para el agente, o sin el perfil del proyecto: nada', async () => {
    findConversation.mockResolvedValue({ id: 40, agent: { code: 'horus' }, project: { id_project: 7, name: 'X', profile: 'comex-latam' } });
    expect(await assertAgentProjectConversation(99, 40)).toBeNull();
    findConversation.mockResolvedValue({ id: 40, agent: { code: 'play' }, project: { id_project: 7, name: 'X', profile: 'gss' } });
    expect(await assertAgentProjectConversation(PLAY, 40)).toBeNull();
  });
});
