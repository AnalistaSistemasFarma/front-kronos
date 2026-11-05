import { describe, expect, it } from 'vitest';
import { cifrarSecreto, descifrarSecreto } from '../cifrado';

const env = { NABUCO_CONFIG_KEY: 'llave-de-pruebas-suficientemente-larga' } as unknown as NodeJS.ProcessEnv;

describe('cifrado AES-256-GCM', () => {
  it('cifra y descifra; cada cifrado es distinto (IV aleatorio)', () => {
    const a = cifrarSecreto('secreto', env);
    const b = cifrarSecreto('secreto', env);
    expect(a).not.toBe(b);
    expect(a).not.toContain('secreto');
    expect(descifrarSecreto(a, env)).toBe('secreto');
  });

  it('falla con otra llave o si se altera el texto', () => {
    const a = cifrarSecreto('secreto', env);
    expect(() => descifrarSecreto(a, { NABUCO_CONFIG_KEY: 'otra-llave-distinta-123456' } as unknown as NodeJS.ProcessEnv)).toThrow();
    const partes = a.split(':');
    partes[3] = Buffer.from('xxxx').toString('base64');
    expect(() => descifrarSecreto(partes.join(':'), env)).toThrow();
  });

  it('exige la llave', () => {
    expect(() => cifrarSecreto('x', {} as NodeJS.ProcessEnv)).toThrow(/NABUCO_CONFIG_KEY/);
  });
});
