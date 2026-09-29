import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activateOrionFallback, getOrionConfig, isOrionFallbackActive } from '../config';

const LOCAL = 'http://localhost:3000';
const TUNNEL = 'https://orion-tunel.example.com';
const keys = ['ORION_API_BASE_URL', 'ORION_EMBED_ORIGIN', 'ORION_FALLBACK_URL'] as const;
const state = globalThis as typeof globalThis & { __orionFallbackUntil?: number };

describe('Orion fallback', () => {
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of keys) prev[k] = process.env[k];
    process.env.ORION_API_BASE_URL = LOCAL;
    process.env.ORION_EMBED_ORIGIN = LOCAL;
    process.env.ORION_FALLBACK_URL = TUNNEL;
    delete state.__orionFallbackUntil;
  });

  afterEach(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
    delete state.__orionFallbackUntil;
  });

  it('usa Orion local mientras responde', () => {
    expect(getOrionConfig().apiBaseUrl).toBe(LOCAL);
    expect(getOrionConfig().embedOrigin).toBe(LOCAL);
  });

  it('cambia API y embed al túnel cuando se activa el respaldo', () => {
    activateOrionFallback();
    expect(isOrionFallbackActive()).toBe(true);
    expect(getOrionConfig().apiBaseUrl).toBe(TUNNEL);
    expect(getOrionConfig().embedOrigin).toBe(TUNNEL);
  });

  it('vuelve a Orion local cuando vence el respaldo', () => {
    state.__orionFallbackUntil = Date.now() - 1;
    expect(getOrionConfig().apiBaseUrl).toBe(LOCAL);
  });

  it('sin ORION_FALLBACK_URL no cambia nada', () => {
    delete process.env.ORION_FALLBACK_URL;
    activateOrionFallback();
    expect(isOrionFallbackActive()).toBe(false);
    expect(getOrionConfig().apiBaseUrl).toBe(LOCAL);
  });
});
