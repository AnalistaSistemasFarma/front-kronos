import { describe, expect, it } from 'vitest';
import { entregasConPersonas, handlePersona, personasMencionadas, personasParaAgente } from '../menciones-personas';

const ORUS = { idAgent: 1, code: 'orus', displayName: 'Orus', handle: null };
const PLAY = { idAgent: 2, code: 'play', displayName: 'Play', handle: '@silvia' };
const NICO = { idUser: 'u1', name: 'Nicolás Rivera', email: 'nicolas.rivera@gsslatam.com' };
const ANA = { idUser: 'u2', name: 'Ana Pérez', email: 'ana.perez@gsslatam.com' };
const PLAYP = { idUser: 'u3', name: 'Persona Play', email: 'play@otra.com' };

describe('handlePersona', () => {
  it('uses the local part of the email, lower case', () => {
    expect(handlePersona('Nicolas.Rivera@gsslatam.com')).toBe('nicolas.rivera');
    expect(handlePersona('')).toBeNull();
    expect(handlePersona(null)).toBeNull();
    expect(handlePersona('-x@y.com')).toBeNull();
  });
});

describe('personasMencionadas', () => {
  it('finds members, without the author, without duplicates and not inside code', () => {
    const body = 'Hola @ana.perez y @nicolas.rivera, ver `@ana.perez` @ana.perez.';
    expect(personasMencionadas(body, [NICO, ANA], { idAutor: 'u1' })).toEqual([ANA]);
  });
  it('an agent name wins over a person with the same handle', () => {
    expect(personasMencionadas('@play revise', [PLAYP], { agentes: [PLAY] })).toEqual([]);
  });
  it('an email is not a mention', () => {
    expect(personasMencionadas('escriba a ana.perez@gsslatam.com', [ANA])).toEqual([]);
  });
});

describe('entregasConPersonas', () => {
  const base = { principal: ORUS, mencionables: [PLAY], personas: [NICO, ANA], idAutor: 'u1' };
  it('no @: only the main agent', () => {
    expect(entregasConPersonas({ ...base, body: 'hola' })).toEqual({ invitados: [], principalAtiende: true, personas: [] });
  });
  it('only people: no agent takes it, the people are notified', () => {
    expect(entregasConPersonas({ ...base, body: '@ana.perez revise esto' })).toEqual({ invitados: [], principalAtiende: false, personas: [ANA] });
  });
  it('people and another agent: the agent rules apply', () => {
    expect(entregasConPersonas({ ...base, body: '@ana.perez y @play revisen' })).toEqual({ invitados: [2], principalAtiende: false, personas: [ANA] });
  });
  it('people and the main agent: the main agent answers', () => {
    expect(entregasConPersonas({ ...base, body: '@orus avísele a @ana.perez' })).toEqual({ invitados: [], principalAtiende: true, personas: [ANA] });
  });
  it('without other agents in the project, still works for people', () => {
    expect(entregasConPersonas({ ...base, mencionables: [], body: '@ana.perez' })).toEqual({ invitados: [], principalAtiende: false, personas: [ANA] });
  });
  it('an unknown @ keeps the main agent', () => {
    expect(entregasConPersonas({ ...base, body: '@nadie hola' })).toEqual({ invitados: [], principalAtiende: true, personas: [] });
  });
});

describe('personasParaAgente', () => {
  it('lists name and handle, without agent collisions', () => {
    expect(personasParaAgente([NICO, PLAYP], [PLAY])).toEqual([{ name: 'Nicolás Rivera', handle: 'nicolas.rivera' }]);
  });
});
