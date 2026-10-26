import { beforeEach, describe, expect, it } from 'vitest';
import { enviarConToken, expiracionToken, limpiarCacheTokens, obtenerToken, renovarToken, MARGEN_EXP_MS, VIGENCIA_SIN_EXP_MS, type IdentidadToken } from '../tokenCache';
import type { NabucoConexion } from '../nabucoClient';

const conexion: NabucoConexion = {
  url: 'https://nabuco.test',
  usuario: 'u',
  password: 'p',
  org: '1',
  rutaToken: '/AuthBI',
  rutaSolicitudes: '/api/NabucoWmsSolicitudesAlistamiento',
  timeoutMs: 5000,
};
const ident: IdentidadToken = { idConfig: 7, url: 'https://nabuco.test', usuario: 'u', passwordEnc: 'v1:a:b:c' };

function jwt(exp?: number): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'HS256' })}.${b(exp === undefined ? { sub: 'x' } : { sub: 'x', exp })}.firma`;
}

/** fetch simulado: /AuthBI devuelve los tokens en orden (como string JSON entre comillas); solicitudes, los status en orden. */
function fakeFetch(tokens: string[], statuses: number[] = []) {
  const llamadas: { url: string; auth?: string; body?: string }[] = [];
  let it = 0;
  let is = 0;
  const f = (async (url: string, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    llamadas.push({ url, auth: h.Authorization, body: init?.body as string });
    if (url.endsWith('/AuthBI')) return new Response(JSON.stringify(tokens[Math.min(it++, tokens.length - 1)]), { status: 200 });
    const st = statuses[Math.min(is++, statuses.length - 1)] ?? 200;
    return new Response(st === 200 ? '{"ok":true}' : 'no', { status: st });
  }) as unknown as typeof fetch;
  return { f, llamadas, auths: () => llamadas.filter((l) => l.url.endsWith('/AuthBI')).length };
}

describe('tokenCache', () => {
  beforeEach(() => limpiarCacheTokens());

  it('quita las comillas del token devuelto como string JSON', async () => {
    const { f } = fakeFetch(['abc']);
    expect(await obtenerToken(ident, conexion, { fetcher: f })).toBe('abc');
  });

  it('usa exp del JWT con 60 s de margen; sin exp, 50 minutos', () => {
    const ahora = 1_000_000_000_000;
    const exp = Math.floor(ahora / 1000) + 3600;
    expect(expiracionToken(jwt(exp), ahora)).toBe(exp * 1000 - MARGEN_EXP_MS);
    expect(expiracionToken(jwt(), ahora)).toBe(ahora + VIGENCIA_SIN_EXP_MS);
    expect(expiracionToken('opaco', ahora)).toBe(ahora + VIGENCIA_SIN_EXP_MS);
  });

  it('reutiliza el token hasta exp − 60 s y luego pide uno nuevo', async () => {
    let ahora = 1_000_000_000_000;
    const exp = Math.floor(ahora / 1000) + 600;
    const { f, auths } = fakeFetch([jwt(exp), 'segundo']);
    const opts = { fetcher: f, ahora: () => ahora };
    const t1 = await obtenerToken(ident, conexion, opts);
    ahora += 500_000; // 500 s: aún vigente (vence a los 540 s)
    expect(await obtenerToken(ident, conexion, opts)).toBe(t1);
    expect(auths()).toBe(1);
    ahora += 41_000; // 541 s: vencido por el margen
    expect(await obtenerToken(ident, conexion, opts)).toBe('segundo');
    expect(auths()).toBe(2);
  });

  it('sin exp vence a los 50 minutos', async () => {
    let ahora = 0;
    const { f, auths } = fakeFetch(['a', 'b']);
    const opts = { fetcher: f, ahora: () => ahora };
    await obtenerToken(ident, conexion, opts);
    ahora = VIGENCIA_SIN_EXP_MS - 1;
    expect(await obtenerToken(ident, conexion, opts)).toBe('a');
    ahora = VIGENCIA_SIN_EXP_MS;
    expect(await obtenerToken(ident, conexion, opts)).toBe('b');
    expect(auths()).toBe(2);
  });

  it('envía varios documentos con un solo /AuthBI', async () => {
    const { f, auths, llamadas } = fakeFetch(['tok'], [200, 200, 200]);
    for (let i = 0; i < 3; i++) expect((await enviarConToken(ident, conexion, '{"a":1}', { fetcher: f })).ok).toBe(true);
    expect(auths()).toBe(1);
    expect(llamadas.filter((l) => !l.url.endsWith('/AuthBI')).every((l) => l.auth === 'Bearer tok' && l.body === '{"a":1}')).toBe(true);
  });

  it('ante un 401 invalida, pide token nuevo UNA vez y reintenta UNA sola vez', async () => {
    const { f, auths, llamadas } = fakeFetch(['viejo', 'nuevo'], [401, 200]);
    const r = await enviarConToken(ident, conexion, '{}', { fetcher: f });
    expect(r.ok).toBe(true);
    expect(r.tokenRenovado).toBe(true);
    expect(auths()).toBe(2);
    const envios = llamadas.filter((l) => !l.url.endsWith('/AuthBI'));
    expect(envios.map((l) => l.auth)).toEqual(['Bearer viejo', 'Bearer nuevo']);
    // el token nuevo queda en caché
    await enviarConToken(ident, conexion, '{}', { fetcher: f });
    expect(auths()).toBe(2);
  });

  it('si el reintento también da 401 no vuelve a intentar', async () => {
    const { f, auths, llamadas } = fakeFetch(['a', 'b', 'c'], [401, 401, 401]);
    const r = await enviarConToken(ident, conexion, '{}', { fetcher: f });
    expect(r.status).toBe(401);
    expect(auths()).toBe(2);
    expect(llamadas.filter((l) => !l.url.endsWith('/AuthBI'))).toHaveLength(2);
  });

  it('cambiar usuario, URL o contraseña invalida la caché', async () => {
    const { f, auths } = fakeFetch(['t1', 't2', 't3', 't4']);
    await obtenerToken(ident, conexion, { fetcher: f });
    await obtenerToken(ident, conexion, { fetcher: f });
    expect(auths()).toBe(1);
    expect(await obtenerToken({ ...ident, passwordEnc: 'v1:otro' }, conexion, { fetcher: f })).toBe('t2');
    expect(await obtenerToken({ ...ident, passwordEnc: 'v1:otro', usuario: 'otro' }, conexion, { fetcher: f })).toBe('t3');
    expect(await obtenerToken({ ...ident, passwordEnc: 'v1:otro', usuario: 'otro', url: 'https://otra' }, conexion, { fetcher: f })).toBe('t4');
    expect(auths()).toBe(4);
  });

  it('«Probar conexión» siempre pide token nuevo y actualiza la caché', async () => {
    const { f, auths } = fakeFetch(['a', 'b']);
    await obtenerToken(ident, conexion, { fetcher: f });
    expect((await renovarToken(ident, conexion, { fetcher: f })).status).toBe(200);
    expect(auths()).toBe(2);
    expect(await obtenerToken(ident, conexion, { fetcher: f })).toBe('b');
    expect(auths()).toBe(2);
  });
});
