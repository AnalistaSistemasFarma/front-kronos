import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithRetry, isTransientStatus } from '../fetchWithRetry';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function mockResponses(...items: Array<number | Error>) {
  const fn = vi.fn();
  for (const item of items) {
    if (item instanceof Error) fn.mockRejectedValueOnce(item);
    else fn.mockResolvedValueOnce(new Response(null, { status: item }));
  }
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('isTransientStatus', () => {
  it('404, 5xx y 429 son temporales; 401/403/400/200 no', () => {
    expect([404, 500, 502, 503, 429].every(isTransientStatus)).toBe(true);
    expect([200, 400, 401, 403].some(isTransientStatus)).toBe(false);
  });
});

describe('fetchWithRetry', () => {
  it('reintenta una falla temporal y devuelve la respuesta buena', async () => {
    const fn = mockResponses(404, 200);
    const res = await fetchWithRetry('/x', undefined, { delayMs: 0 });
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('reintenta un error de red', async () => {
    const fn = mockResponses(new TypeError('Failed to fetch'), 200);
    const res = await fetchWithRetry('/x', undefined, { delayMs: 0 });
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('un 401 es definitivo: no reintenta', async () => {
    const fn = mockResponses(401);
    const res = await fetchWithRetry('/x', undefined, { delayMs: 0 });
    expect(res.status).toBe(401);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('tras agotar los intentos devuelve la última respuesta', async () => {
    const fn = mockResponses(500, 500, 503);
    const res = await fetchWithRetry('/x', undefined, { delayMs: 0 });
    expect(res.status).toBe(503);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('tras agotar los intentos por red, lanza el error', async () => {
    mockResponses(new TypeError('a'), new TypeError('b'), new TypeError('c'));
    await expect(fetchWithRetry('/x', undefined, { delayMs: 0 })).rejects.toThrow('c');
  });
});
