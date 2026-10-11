import { describe, expect, it, vi } from 'vitest';
import { RELOAD_KEY, RELOAD_WINDOW_MS, claimAutoReload, isChunkLoadError, tryAutoReload } from './chunkError';

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe('isChunkLoadError', () => {
  it('detecta los errores de chunk e import dinámico', () => {
    const e = new Error('Loading chunk 123 failed. (error: /_next/static/chunks/123.js)');
    e.name = 'ChunkLoadError';
    expect(isChunkLoadError(e)).toBe(true);
    expect(isChunkLoadError(new Error('Loading chunk app/home/page failed.'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/_next/a.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Failed to load chunk /_next/static/chunks/abc.js'))).toBe(true);
    expect(isChunkLoadError('Loading CSS chunk 7 failed')).toBe(true);
    expect(isChunkLoadError({ reason: new Error('ChunkLoadError') })).toBe(true);
  });
  it('no confunde otros errores', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe('límite de una recarga', () => {
  it('permite una sola recarga dentro de la ventana y deja la fecha', () => {
    const s = memStorage();
    expect(claimAutoReload(s, 1_000_000)).toBe(true);
    expect(s.m.get(RELOAD_KEY)).toBe('1000000');
    expect(claimAutoReload(s, 1_000_000 + 5_000)).toBe(false);
    expect(claimAutoReload(s, 1_000_000 + RELOAD_WINDOW_MS + 1)).toBe(true);
  });
  it('sin storage no recarga (evita bucles)', () => {
    expect(claimAutoReload(null, 1)).toBe(false);
  });
  it('tryAutoReload recarga solo con errores de chunk y una vez', () => {
    const s = memStorage();
    const reload = vi.fn();
    expect(tryAutoReload(new Error('boom'), { storage: s, now: 10, reload })).toBe(false);
    const chunk = new Error('ChunkLoadError: Loading chunk 9 failed');
    expect(tryAutoReload(chunk, { storage: s, now: 10, reload })).toBe(true);
    expect(tryAutoReload(chunk, { storage: s, now: 20, reload })).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
