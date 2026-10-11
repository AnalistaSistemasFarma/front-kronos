import { describe, expect, it } from 'vitest';
import { CLAVE_RECARGA, isChunkLoadError, marcarRecargaSiPermitida } from '../chunk-recovery';

function almacen() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe('isChunkLoadError', () => {
  it('reconoce los mensajes de webpack, turbopack y navegadores', () => {
    const e = new Error('Loading chunk 123 failed.\n(error: /_next/static/chunks/123.js)');
    e.name = 'ChunkLoadError';
    expect(isChunkLoadError(e)).toBe(true);
    expect(isChunkLoadError(new Error('Loading chunk app/home/page failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Failed to load chunk /_next/static/chunks/abc.js from module 1'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/_next/a.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Loading CSS chunk 9 failed'))).toBe(true);
  });
  it('no confunde otros errores', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe('marcarRecargaSiPermitida', () => {
  it('permite una recarga y bloquea la siguiente dentro de la ventana', () => {
    const a = almacen();
    expect(marcarRecargaSiPermitida(a, 1_000_000)).toBe(true);
    expect(a.m.get(CLAVE_RECARGA)).toBe('1000000');
    expect(marcarRecargaSiPermitida(a, 1_030_000)).toBe(false);
    expect(marcarRecargaSiPermitida(a, 1_070_000)).toBe(true);
  });
  it('sin almacenamiento no recarga (evita bucles)', () => {
    expect(marcarRecargaSiPermitida(null)).toBe(false);
  });
});
