import { describe, expect, it, vi } from 'vitest';
import { sessionTokenFromCookie, UserIdentityCache } from '../userIdentity';
import { UserAccumulator } from '../stats';

describe('sessionTokenFromCookie', () => {
  it('lee la cookie de sesión normal y la segura', () => {
    expect(sessionTokenFromCookie('a=1; next-auth.session-token=abc; b=2')).toBe('abc');
    expect(sessionTokenFromCookie('__Secure-next-auth.session-token=xyz')).toBe('xyz');
  });

  it('une los trozos .0, .1 de un token grande', () => {
    expect(sessionTokenFromCookie('next-auth.session-token.1=def; next-auth.session-token.0=abc')).toBe('abcdef');
  });

  it('devuelve null sin sesión', () => {
    expect(sessionTokenFromCookie(undefined)).toBeNull();
    expect(sessionTokenFromCookie('theme=dark; next-auth.csrf-token=1')).toBeNull();
  });
});

describe('UserIdentityCache', () => {
  it('descifra una sola vez por token y normaliza el correo', async () => {
    const decode = vi.fn(async () => ({ email: '  Ana@GSS.com ', name: 'Ana' }));
    const cache = new UserIdentityCache(decode);
    expect(cache.peek('t1')).toBeUndefined();
    const [a, b] = await Promise.all([cache.resolve('t1'), cache.resolve('t1')]);
    expect(a).toEqual({ email: 'ana@gss.com', name: 'Ana' });
    expect(b).toEqual(a);
    expect(cache.peek('t1')).toEqual(a);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it('guarda null para tokens inválidos y no vuelve a intentarlo enseguida', async () => {
    const decode = vi.fn(async () => {
      throw new Error('bad token');
    });
    const cache = new UserIdentityCache(decode);
    expect(await cache.resolve('malo')).toBeNull();
    expect(cache.peek('malo')).toBeNull();
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it('vuelve a descifrar pasados 30 minutos', async () => {
    let now = 0;
    const decode = vi.fn(async () => ({ email: 'a@b.co' }));
    const cache = new UserIdentityCache(decode, () => now);
    await cache.resolve('t');
    now = 31 * 60_000;
    expect(cache.peek('t')).toBeUndefined();
    await cache.resolve('t');
    expect(decode).toHaveBeenCalledTimes(2);
  });
});

describe('UserAccumulator', () => {
  it('suma por persona, calcula p95 y el módulo donde más tiempo gastó', () => {
    const acc = new UserAccumulator(() => 0);
    const base = { email: 'ana@gss.com', name: 'Ana' };
    acc.record({ ...base, module: 'orion', durationMs: 900, status: 200 });
    acc.record({ ...base, module: 'chat', durationMs: 100, status: 200 });
    acc.record({ ...base, module: 'chat', durationMs: 200, status: 500 });
    acc.record({ ...base, module: 'chat', durationMs: null, status: 200 });
    acc.record({ email: 'beto@gss.com', name: null, module: 'sgc', durationMs: 50, status: 200 });

    const rows = acc.drain();
    const ana = rows.find((r) => r.email === 'ana@gss.com')!;
    expect(ana).toMatchObject({
      name: 'Ana',
      requests: 4,
      errors: 1,
      totalMs: 1200,
      maxMs: 900,
      p95Ms: 900,
      topModule: 'orion',
    });
    expect(rows.find((r) => r.email === 'beto@gss.com')).toMatchObject({ requests: 1, totalMs: 50, topModule: 'sgc' });
    expect(acc.size).toBe(0);
  });
});
