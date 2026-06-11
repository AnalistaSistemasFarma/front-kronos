import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = (apiKeys: unknown): NodeJS.ProcessEnv => ({
  MCP_API_KEYS: JSON.stringify(apiKeys),
});

describe('loadConfig — validación de keys y alcance', () => {
  it('carga keys válidas desde MCP_API_KEYS', () => {
    const cfg = loadConfig(
      base([{ key: 'a'.repeat(20), agent: 'horus', companyIds: [1, 2], role: 'reader' }])
    );
    expect(cfg.apiKeys).toHaveLength(1);
    expect(cfg.apiKeys[0]!.companyIds).toEqual([1, 2]);
    expect(cfg.port).toBe(3020);
  });

  it('rechaza una key sin companyIds', () => {
    expect(() => loadConfig(base([{ key: 'a'.repeat(20), agent: 'x', companyIds: [] }]))).toThrow();
  });

  it('acepta companyIds "*" para una key admin', () => {
    const cfg = loadConfig(
      base([{ key: 'a'.repeat(20), agent: 'admin', companyIds: '*', role: 'admin' }])
    );
    expect(cfg.apiKeys[0]!.companyIds).toBe('*');
    expect(cfg.apiKeys[0]!.role).toBe('admin');
  });

  it('rechaza un comodín distinto de "*"', () => {
    expect(() =>
      loadConfig(base([{ key: 'a'.repeat(20), agent: 'x', companyIds: 'all' }]))
    ).toThrow();
  });

  it('rechaza companyIds con valores no enteros o no positivos', () => {
    expect(() =>
      loadConfig(base([{ key: 'a'.repeat(20), agent: 'x', companyIds: [0] }]))
    ).toThrow();
    expect(() =>
      loadConfig(base([{ key: 'a'.repeat(20), agent: 'x', companyIds: [-1] }]))
    ).toThrow();
    expect(() =>
      loadConfig(base([{ key: 'a'.repeat(20), agent: 'x', companyIds: [1.5] }]))
    ).toThrow();
  });

  it('rechaza keys demasiado cortas', () => {
    expect(() => loadConfig(base([{ key: 'corta', agent: 'x', companyIds: [1] }]))).toThrow();
  });

  it('rechaza keys duplicadas', () => {
    const k = 'z'.repeat(20);
    expect(() =>
      loadConfig(
        base([
          { key: k, agent: 'a', companyIds: [1] },
          { key: k, agent: 'b', companyIds: [2] },
        ])
      )
    ).toThrow(/duplicad/i);
  });

  it('falla si no hay ni MCP_API_KEYS ni MCP_API_KEYS_FILE', () => {
    expect(() => loadConfig({})).toThrow(/API keys/i);
  });

  it('respeta MCP_PORT del entorno', () => {
    const cfg = loadConfig({
      ...base([{ key: 'a'.repeat(20), agent: 'x', companyIds: [1] }]),
      MCP_PORT: '4099',
    });
    expect(cfg.port).toBe(4099);
  });
});
