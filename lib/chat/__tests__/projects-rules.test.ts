import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetProjectAgentsCache,
  canManageProject,
  canRemoveMember,
  loadProjectAgents,
  normalizeInviteIds,
  normalizeProjectInstructions,
  normalizeProjectName,
  parseProjectAgents,
  profilesFor,
  projectsEnabledFor,
  validateProfileForAgent,
  MAX_PROJECT_INSTRUCTIONS_CHARS,
} from '../projects-rules';

/*
 * Reglas puras de los PROYECTOS del chat (F1 piloto, 2026-10-17): el
 * interruptor por agente, los perfiles de conectores y quién administra.
 */
const env = (valor?: string) => ({ CHAT_PROJECTS_AGENTS: valor }) as unknown as NodeJS.ProcessEnv;

afterEach(() => __resetProjectAgentsCache());

describe('interruptor CHAT_PROJECTS_AGENTS', () => {
  it('apagado por defecto: sin variable ningún agente tiene proyectos', () => {
    expect(loadProjectAgents(env()).size).toBe(0);
    expect(projectsEnabledFor('play', env())).toBe(false);
  });

  it('habilita solo los agentes listados, sin importar mayúsculas', () => {
    const e = env('{"play":["farmalogica","olp","comex-latam"]}');
    expect(projectsEnabledFor('play', e)).toBe(true);
    expect(projectsEnabledFor('PLAY', e)).toBe(true);
    expect(projectsEnabledFor('horus', e)).toBe(false);
    expect(profilesFor('play', e)).toEqual(['farmalogica', 'olp', 'comex-latam']);
  });

  it('una configuración inválida falla CERRADO', () => {
    expect(loadProjectAgents(env('{no es json'))).toEqual(new Map());
    __resetProjectAgentsCache();
    expect(projectsEnabledFor('play', env('{"play":["perfil-que-no-existe"]}'))).toBe(false);
    __resetProjectAgentsCache();
    expect(projectsEnabledFor('play', env('{"play":[]}'))).toBe(false);
  });

  it('parseProjectAgents explica qué está mal', () => {
    expect(() => parseProjectAgents('[]')).toThrow(/objeto/);
    expect(() => parseProjectAgents('{"play":["x"]}')).toThrow(/desconocido/);
  });
});

describe('perfil de conectores', () => {
  it('solo vale un perfil habilitado PARA ESE agente', () => {
    const e = env('{"play":["olp"]}');
    expect(validateProfileForAgent('olp', 'play', e)).toEqual({ ok: true, value: 'olp' });
    expect(validateProfileForAgent('farmalogica', 'play', e).ok).toBe(false);
    expect(validateProfileForAgent('olp', 'horus', e).ok).toBe(false);
    expect(validateProfileForAgent(undefined, 'play', e).ok).toBe(false);
  });
});

describe('validaciones', () => {
  it('nombre obligatorio, en una línea y con tope', () => {
    expect(normalizeProjectName('  Comex \n Latam ')).toEqual({ ok: true, value: 'Comex Latam' });
    expect(normalizeProjectName('   ').ok).toBe(false);
    expect(normalizeProjectName('x'.repeat(121)).ok).toBe(false);
  });

  it('instrucciones opcionales y con tope', () => {
    expect(normalizeProjectInstructions(undefined)).toEqual({ ok: true, value: null });
    expect(normalizeProjectInstructions('   ')).toEqual({ ok: true, value: null });
    expect(normalizeProjectInstructions('x'.repeat(MAX_PROJECT_INSTRUCTIONS_CHARS + 1)).ok).toBe(false);
  });

  it('invitaciones: sin duplicados ni el propio actor', () => {
    expect(normalizeInviteIds(['u2', 'u2', 'u1', ' u3 '], 'u1')).toEqual({ ok: true, value: ['u2', 'u3'] });
    expect(normalizeInviteIds(['u1'], 'u1').ok).toBe(false);
    expect(normalizeInviteIds('u2', 'u1').ok).toBe(false);
  });
});

describe('miembros: el dueño administra', () => {
  it('solo el dueño administra', () => {
    expect(canManageProject('owner')).toBe(true);
    expect(canManageProject('member')).toBe(false);
    expect(canManageProject(null)).toBe(false);
  });

  it('el dueño retira a otros, pero no a sí mismo', () => {
    expect(canRemoveMember({ actorId: 'o', actorRole: 'owner', targetId: 'm', targetRole: 'member' }).ok).toBe(true);
    expect(canRemoveMember({ actorId: 'o', actorRole: 'owner', targetId: 'o', targetRole: 'owner' }).ok).toBe(false);
  });

  it('un miembro solo puede salirse él mismo', () => {
    expect(canRemoveMember({ actorId: 'm', actorRole: 'member', targetId: 'm', targetRole: 'member' }).ok).toBe(true);
    expect(canRemoveMember({ actorId: 'm', actorRole: 'member', targetId: 'x', targetRole: 'member' }).ok).toBe(false);
    expect(canRemoveMember({ actorId: 'm', actorRole: 'member', targetId: 'o', targetRole: 'owner' }).ok).toBe(false);
  });
});
