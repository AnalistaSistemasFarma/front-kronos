/**
 * Respaldo de Orion (2026-11-11, rendimiento de la firma): la ruta se decide con una sonda corta
 * y ninguna petición del usuario espera a un Orion local que no contesta.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureOrionRoute, getOrionConfig, isOrionFallbackActive, markOrionPrimaryOk } from '../config';

const LOCAL = 'http://localhost:3000';
const TUNEL = 'https://orion-respaldo.example.com';

function resetState() {
  const g = globalThis as Record<string, unknown>;
  for (const k of ['__orionFallbackUntil', '__orionProbeAt', '__orionProbe', '__orionPrimaryOkAt']) delete g[k];
}

describe('respaldo de Orion', () => {
  beforeEach(() => {
    resetState();
    vi.stubEnv('ORION_API_BASE_URL', LOCAL);
    vi.stubEnv('ORION_FALLBACK_URL', TUNEL);
    vi.stubEnv('ORION_INTEGRATION_API_KEY', 'llave-de-prueba');
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetState();
  });

  it('si el local no contesta, pasa al respaldo y las siguientes llamadas ya no lo prueban', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    await ensureOrionRoute();
    expect(isOrionFallbackActive()).toBe(true);
    expect(getOrionConfig().apiBaseUrl).toBe(TUNEL);
    const calls = fetchMock.mock.calls.length;

    await ensureOrionRoute();
    expect(fetchMock.mock.calls.length).toBe(calls); // sin otra sonda bloqueante
  });

  it('si el local contesta (aunque sea 401), se queda en el local', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    await ensureOrionRoute();
    expect(isOrionFallbackActive()).toBe(false);
    expect(getOrionConfig().apiBaseUrl).toBe(LOCAL);
  });

  it('con el local confirmado hace poco no se sondea antes de cada llamada', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    markOrionPrimaryOk();
    await ensureOrionRoute();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('con el respaldo activo, una sonda en segundo plano vuelve al local cuando contesta', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')));
    await ensureOrionRoute();
    expect(isOrionFallbackActive()).toBe(true);

    // Pasó el intervalo de la sonda y el local ya contesta.
    (globalThis as Record<string, unknown>).__orionProbeAt = 0;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    expect(isOrionFallbackActive()).toBe(true); // esta llamada no espera la sonda
    await (globalThis as { __orionProbe?: Promise<boolean> | null }).__orionProbe;
    expect(isOrionFallbackActive()).toBe(false);
    expect(getOrionConfig().apiBaseUrl).toBe(LOCAL);
  });

  it('sin respaldo configurado no sondea nada', async () => {
    vi.stubEnv('ORION_FALLBACK_URL', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await ensureOrionRoute();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getOrionConfig().apiBaseUrl).toBe(LOCAL);
  });
});
