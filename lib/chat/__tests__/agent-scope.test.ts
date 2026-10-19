import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * AISLAMIENTO entre el BOT VIVO y el PUENTE DE HILOS (alcance de la llave).
 *   - La llave de siempre ('channel') nunca resuelve una conversación de
 *     proyecto: la sesión viva de Play no puede escribir ni mover el
 *     indicador en un proyecto.
 *   - La llave del puente ('projects') solo resuelve proyectos: no puede
 *     tocar los hilos directos ni los grupos del agente.
 */
const findConversation = vi.hoisted(() => vi.fn());
const agentGroup = vi.hoisted(() => vi.fn());
const agentProject = vi.hoisted(() => vi.fn());

vi.mock('../../prisma', () => ({ prisma: { chatConversation: { findFirst: findConversation } } }));
vi.mock('../groups', () => ({ assertAgentGroup: agentGroup }));
vi.mock('../projects', () => ({ assertAgentProjectConversation: agentProject }));

import { resolveAgentConversation } from '../agent-auth';

beforeEach(() => {
  vi.clearAllMocks();
  findConversation.mockResolvedValue(null);
  agentGroup.mockResolvedValue(null);
  agentProject.mockResolvedValue({ id: 40, idProject: 7, projectName: 'Comex' });
});

describe('resolveAgentConversation según el alcance', () => {
  it("'channel' (por defecto) jamás prueba la puerta de proyectos", async () => {
    expect(await resolveAgentConversation(21, 40)).toBeNull();
    expect(await resolveAgentConversation(21, 40, 'channel')).toBeNull();
    expect(agentProject).not.toHaveBeenCalled();
    // y su puerta directa sigue anclada a kind = 'direct'
    expect(findConversation.mock.calls[0][0].where).toMatchObject({ kind: 'direct', id_agent: 21 });
  });

  it("'projects' solo prueba la puerta de proyectos", async () => {
    findConversation.mockResolvedValue({ id: 40, id_user: 'u' });
    agentGroup.mockResolvedValue({ id: 40, title: 'g', agentes: [] });
    const r = await resolveAgentConversation(21, 40, 'projects');
    expect(r).toEqual({ id: 40, kind: 'project', idProject: 7, projectName: 'Comex' });
    expect(findConversation).not.toHaveBeenCalled();
    expect(agentGroup).not.toHaveBeenCalled();
  });

  it("'projects' sobre un hilo que no es de proyecto: 404", async () => {
    agentProject.mockResolvedValue(null);
    expect(await resolveAgentConversation(21, 12, 'projects')).toBeNull();
  });
});
