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
  canRemoveContribution,
  capabilitiesFor,
  isAssignableRole,
  MAX_LINK_SUMMARY_CHARS,
  MAX_PROJECT_AGENTS,
  MAX_PROJECT_DESCRIPTION_CHARS,
  normalizeAgentCodes,
  normalizeLinkSummary,
  normalizeProjectDescription,
  roleFromDb,
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
    expect(canManageProject('editor')).toBe(false);
    expect(canManageProject('reader')).toBe(false);
    expect(canManageProject(null)).toBe(false);
  });

  it('el dueño retira a otros, pero no a sí mismo', () => {
    expect(canRemoveMember({ actorId: 'o', actorRole: 'owner', targetId: 'm', targetRole: 'editor' }).ok).toBe(true);
    expect(canRemoveMember({ actorId: 'o', actorRole: 'owner', targetId: 'l', targetRole: 'reader' }).ok).toBe(true);
    expect(canRemoveMember({ actorId: 'o', actorRole: 'owner', targetId: 'o', targetRole: 'owner' }).ok).toBe(false);
  });

  it('un editor o lector solo puede salirse él mismo', () => {
    for (const r of ['editor', 'reader'] as const) {
      expect(canRemoveMember({ actorId: 'm', actorRole: r, targetId: 'm', targetRole: r }).ok).toBe(true);
      expect(canRemoveMember({ actorId: 'm', actorRole: r, targetId: 'x', targetRole: 'editor' }).ok).toBe(false);
      expect(canRemoveMember({ actorId: 'm', actorRole: r, targetId: 'o', targetRole: 'owner' }).ok).toBe(false);
    }
  });
});

describe('roles del módulo (dueño / editor / lector)', () => {
  it('el rol de la F1 («member») se lee como editor; lo desconocido, como lector', () => {
    expect(roleFromDb('owner')).toBe('owner');
    expect(roleFromDb('member')).toBe('editor');
    expect(roleFromDb('editor')).toBe('editor');
    expect(roleFromDb('reader')).toBe('reader');
    expect(roleFromDb('admin')).toBe('reader');
    expect(roleFromDb(null)).toBe('reader');
  });

  it('tabla de capacidades', () => {
    expect(capabilitiesFor('owner')).toEqual({
      write: true, contribute: true, removeAny: true, edit: true, manageAgents: true, manageMembers: true, archive: true, leave: false,
    });
    expect(capabilitiesFor('editor')).toEqual({
      write: true, contribute: true, removeAny: false, edit: false, manageAgents: false, manageMembers: false, archive: false, leave: true,
    });
    expect(capabilitiesFor('reader')).toEqual({
      write: false, contribute: false, removeAny: false, edit: false, manageAgents: false, manageMembers: false, archive: false, leave: true,
    });
    // Sin rol: nada.
    expect(Object.values(capabilitiesFor(null)).some(Boolean)).toBe(false);
  });

  it('quitar vínculos o archivos: el dueño todo; el editor lo suyo; el lector nada', () => {
    expect(canRemoveContribution('owner', 'o', 'otro')).toBe(true);
    expect(canRemoveContribution('editor', 'e', 'e')).toBe(true);
    expect(canRemoveContribution('editor', 'e', 'otro')).toBe(false);
    expect(canRemoveContribution('editor', 'e', null)).toBe(false);
    expect(canRemoveContribution('reader', 'l', 'l')).toBe(false);
  });

  it('solo se asignan editor o lector (el dueño no se asigna)', () => {
    expect(isAssignableRole('editor')).toBe(true);
    expect(isAssignableRole('reader')).toBe(true);
    expect(isAssignableRole('owner')).toBe(false);
    expect(isAssignableRole('member')).toBe(false);
  });

  it('agentes: sin duplicados, en minúsculas, al menos uno y con tope', () => {
    expect(normalizeAgentCodes([' Play ', 'play', 'horus'])).toEqual({ ok: true, value: ['play', 'horus'] });
    expect(normalizeAgentCodes([]).ok).toBe(false);
    expect(normalizeAgentCodes(['a b']).ok).toBe(false);
    expect(normalizeAgentCodes(Array.from({ length: MAX_PROJECT_AGENTS + 1 }, (_, i) => `a${i}`)).ok).toBe(false);
  });

  it('resumen y descripción: opcionales y con tope', () => {
    expect(normalizeLinkSummary('  ')).toEqual({ ok: true, value: null });
    expect(normalizeLinkSummary('x'.repeat(MAX_LINK_SUMMARY_CHARS + 1)).ok).toBe(false);
    expect(normalizeProjectDescription('x'.repeat(MAX_PROJECT_DESCRIPTION_CHARS + 1)).ok).toBe(false);
    expect(normalizeProjectDescription(' Hola ')).toEqual({ ok: true, value: 'Hola' });
  });
});
