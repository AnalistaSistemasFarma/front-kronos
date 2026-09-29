import { describe, expect, it } from 'vitest';
import {
  MAX_DM_KEY_CHARS,
  buildDmKey,
  empresasCompartidas,
  empresasParaIniciar,
  puedeIniciar,
  puedenEscribirse,
  type PersonaParaAcceso,
} from '../people-rules';

const hashFalso = (texto: string) => `hash(${texto.length})`;

function persona(
  id: string,
  chat: number[],
  piloto: number[] = [],
  extra: Partial<PersonaParaAcceso> = {}
): PersonaParaAcceso {
  return {
    id,
    isActive: true,
    role: 'user',
    empresasChat: new Set(chat),
    empresasPersonas: new Set(piloto),
    ...extra,
  };
}

describe('buildDmKey', () => {
  it('es la misma clave sin importar el orden del par', () => {
    expect(buildDmKey('b', 'a', hashFalso)).toBe('a:b');
    expect(buildDmKey('a', 'b', hashFalso)).toBe('a:b');
  });

  it('cabe siempre en la columna: con ids larguísimos usa el resumen', () => {
    const largo = 'x'.repeat(100);
    const clave = buildDmKey(largo, `${largo}y`, hashFalso);
    expect(clave.startsWith('h:')).toBe(true);
    expect(clave.length).toBeLessThanOrEqual(MAX_DM_KEY_CHARS);
  });

  it('rechaza un par consigo mismo o incompleto', () => {
    expect(() => buildDmKey('a', 'a', hashFalso)).toThrow();
    expect(() => buildDmKey('', 'a', hashFalso)).toThrow();
  });
});

describe('puedenEscribirse (D1)', () => {
  it('sí, si comparten una empresa con Chat', () => {
    expect(puedenEscribirse(persona('a', [1, 8]), persona('b', [8]))).toBe(true);
    expect(empresasCompartidas(persona('a', [1, 8]), persona('b', [8, 1]))).toEqual([1, 8]);
  });

  it('no, si no comparten ninguna empresa', () => {
    expect(puedenEscribirse(persona('a', [1]), persona('b', [8]))).toBe(false);
  });

  it('no con uno mismo, ni con inactivos, ni con proveedores', () => {
    expect(puedenEscribirse(persona('a', [8]), persona('a', [8]))).toBe(false);
    expect(puedenEscribirse(persona('a', [8]), persona('b', [8], [], { isActive: false }))).toBe(false);
    expect(puedenEscribirse(persona('a', [8]), persona('b', [8], [], { role: 'supplier' }))).toBe(false);
    expect(puedenEscribirse(persona('a', [8], [], { role: ' Supplier ' }), persona('b', [8]))).toBe(false);
  });
});

describe('puedeIniciar (D2)', () => {
  it('exige el piloto en una empresa COMPARTIDA', () => {
    const conPiloto = persona('a', [1, 8], [8]);
    expect(puedeIniciar(conPiloto, persona('b', [8]))).toBe(true);
    // El piloto está en la 8 pero la otra persona solo está en la 1.
    expect(puedeIniciar(conPiloto, persona('c', [1]))).toBe(false);
  });

  it('quien no tiene el piloto no inicia, aunque compartan empresa', () => {
    expect(puedeIniciar(persona('a', [8]), persona('b', [8], [8]))).toBe(false);
  });

  it('el piloto sin el Chat en esa empresa no cuenta', () => {
    expect(empresasParaIniciar(persona('a', [1], [8]))).toEqual([]);
    expect(empresasParaIniciar(persona('a', [1, 8], [8]))).toEqual([8]);
  });
});
