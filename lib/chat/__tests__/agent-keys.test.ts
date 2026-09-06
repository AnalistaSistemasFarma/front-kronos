import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MIN_AGENT_KEY_LENGTH,
  __resetAgentKeysCache,
  extractBearer,
  loadAgentKeys,
  matchAgentKey,
  parseAgentKeys,
  safeEqualSecret,
} from '../agent-keys';

const KEY_A = 'a'.repeat(40);
const KEY_B = 'b'.repeat(40);

describe('extractBearer', () => {
  it('extrae el token de un header Bearer', () => {
    expect(extractBearer(`Bearer ${KEY_A}`)).toBe(KEY_A);
  });

  it('acepta el prefijo sin importar mayúsculas y recorta espacios', () => {
    expect(extractBearer(`  bearer   ${KEY_A}  `)).toBe(KEY_A);
  });

  it('rechaza un header ausente, vacío o de otro esquema', () => {
    expect(extractBearer(undefined)).toBeNull();
    expect(extractBearer(null)).toBeNull();
    expect(extractBearer('')).toBeNull();
    expect(extractBearer('Bearer')).toBeNull();
    expect(extractBearer('Bearer   ')).toBeNull();
    expect(extractBearer(`Basic ${KEY_A}`)).toBeNull();
    expect(extractBearer(KEY_A)).toBeNull();
  });
});

describe('safeEqualSecret', () => {
  it('acepta secretos idénticos', () => {
    expect(safeEqualSecret(KEY_A, KEY_A)).toBe(true);
  });

  it('rechaza secretos distintos, incluso de distinta longitud', () => {
    expect(safeEqualSecret(KEY_A, KEY_B)).toBe(false);
    expect(safeEqualSecret(KEY_A, 'x')).toBe(false);
    expect(safeEqualSecret('', KEY_A)).toBe(false);
  });
});

describe('parseAgentKeys', () => {
  it('acepta una configuración válida y usa el agent como label por defecto', () => {
    const entries = parseAgentKeys(JSON.stringify([{ key: KEY_A, agent: 'horus' }]));
    expect(entries).toEqual([{ key: KEY_A, agent: 'horus', label: 'horus' }]);
  });

  it('conserva el label cuando viene', () => {
    const entries = parseAgentKeys(
      JSON.stringify([{ key: KEY_A, agent: 'horus', label: 'orus-test' }])
    );
    expect(entries[0].label).toBe('orus-test');
  });

  it('rechaza JSON inválido', () => {
    expect(() => parseAgentKeys('{no es json')).toThrow(/no es JSON válido/);
  });

  it('rechaza un arreglo vacío o algo que no sea arreglo', () => {
    expect(() => parseAgentKeys('[]')).toThrow(/al menos una llave/);
    expect(() => parseAgentKeys('{"key":"x"}')).toThrow(/al menos una llave/);
  });

  it(`rechaza llaves de menos de ${MIN_AGENT_KEY_LENGTH} caracteres`, () => {
    expect(() => parseAgentKeys(JSON.stringify([{ key: 'corta', agent: 'horus' }]))).toThrow(
      /al menos 32 caracteres/
    );
  });

  it('rechaza una entrada sin agent', () => {
    expect(() => parseAgentKeys(JSON.stringify([{ key: KEY_A }]))).toThrow(/debe indicar el "agent"/);
    expect(() => parseAgentKeys(JSON.stringify([{ key: KEY_A, agent: '   ' }]))).toThrow(
      /debe indicar el "agent"/
    );
  });

  it('rechaza llaves duplicadas (dos identidades para el mismo secreto)', () => {
    expect(() =>
      parseAgentKeys(
        JSON.stringify([
          { key: KEY_A, agent: 'horus' },
          { key: KEY_A, agent: 'otro' },
        ])
      )
    ).toThrow(/duplicadas/);
  });
});

describe('matchAgentKey', () => {
  const keys = parseAgentKeys(
    JSON.stringify([
      { key: KEY_A, agent: 'horus' },
      { key: KEY_B, agent: 'adriana' },
    ])
  );

  it('resuelve el agente correcto por su llave', () => {
    expect(matchAgentKey(KEY_A, keys)?.agent).toBe('horus');
    expect(matchAgentKey(KEY_B, keys)?.agent).toBe('adriana');
  });

  it('rechaza un token inválido, vacío o nulo', () => {
    expect(matchAgentKey('c'.repeat(40), keys)).toBeNull();
    expect(matchAgentKey('', keys)).toBeNull();
    expect(matchAgentKey(null, keys)).toBeNull();
  });

  it('no casa nada cuando no hay llaves configuradas (cerrado por defecto)', () => {
    expect(matchAgentKey(KEY_A, [])).toBeNull();
  });
});

describe('loadAgentKeys', () => {
  beforeEach(() => {
    __resetAgentKeysCache();
    vi.restoreAllMocks();
  });

  it('devuelve vacío cuando no hay configuración (cerrado por defecto)', () => {
    expect(loadAgentKeys({} as NodeJS.ProcessEnv)).toEqual([]);
  });

  it('lee las llaves de CHAT_AGENT_API_KEYS', () => {
    const env = {
      CHAT_AGENT_API_KEYS: JSON.stringify([{ key: KEY_A, agent: 'horus' }]),
    } as unknown as NodeJS.ProcessEnv;
    expect(loadAgentKeys(env)).toHaveLength(1);
  });

  it('falla CERRADO (vacío) si la configuración es inválida, no abierto', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = {
      CHAT_AGENT_API_KEYS: JSON.stringify([{ key: 'corta', agent: 'horus' }]),
    } as unknown as NodeJS.ProcessEnv;
    expect(loadAgentKeys(env)).toEqual([]);
  });
});
