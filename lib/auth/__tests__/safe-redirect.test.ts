import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getSafeCallbackUrl, DEFAULT_POST_LOGIN_URL } from '../logout';
import { isSafeRelativePath, resolveAuthRedirect } from '../safe-redirect';

const ORIGIN = 'https://groupsharedservices.farmalogica.com:8445';

// Valores que un navegador lleva a otro host (OWASP H-05).
const MALICIOSOS = [
  '//evil.example',
  '//evil.example/robo',
  '/\\evil.example',
  '/\\evil.example/robo',
  '\\\\evil.example',
  '/%5Cevil.example',
  '/%5cevil.example',
  '/%2F/evil.example',
  '/%2f%2fevil.example',
  '/\t/evil.example',
  '/\n/evil.example',
  '/\r/evil.example',
  '/%09/evil.example',
  'https:evil.example',
  'https://evil.example',
  'http://evil.example/login',
  'javascript:alert(1)',
  'data:text/html,hola',
  'evil.example',
  '',
];

describe('isSafeRelativePath', () => {
  it.each([
    '/home',
    '/dashboard/solicitudes?id=12&tab=notas',
    '/process/sgc#documento',
    '/proveedor/portal',
    '/process/busqueda?q=hola%20mundo',
  ])('acepta la ruta relativa %j', (v) => {
    expect(isSafeRelativePath(v)).toBe(true);
  });

  it.each(MALICIOSOS)('rechaza %j', (v) => {
    expect(isSafeRelativePath(v)).toBe(false);
  });

  it('rechaza null y undefined', () => {
    expect(isSafeRelativePath(null)).toBe(false);
    expect(isSafeRelativePath(undefined)).toBe(false);
  });

  it('rechaza un % mal formado', () => {
    expect(isSafeRelativePath('/home%E0%A4%A')).toBe(false);
  });
});

describe('getSafeCallbackUrl (página de login)', () => {
  it('devuelve la ruta relativa válida', () => {
    expect(getSafeCallbackUrl('/home', ORIGIN)).toBe('/home');
    expect(getSafeCallbackUrl('  /process/sgc?x=1  ', ORIGIN)).toBe('/process/sgc?x=1');
  });

  it('convierte una URL absoluta del mismo origen en ruta relativa', () => {
    expect(getSafeCallbackUrl(`${ORIGIN}/dashboard/solicitudes?id=3`, ORIGIN)).toBe(
      '/dashboard/solicitudes?id=3'
    );
  });

  it.each(MALICIOSOS)('manda %j al inicio por defecto', (v) => {
    expect(getSafeCallbackUrl(v, ORIGIN)).toBe(DEFAULT_POST_LOGIN_URL);
  });

  it('el caso de la auditoría: /\\evil.example no sale del sitio', () => {
    expect(getSafeCallbackUrl('/\\evil.example/robo', ORIGIN)).toBe(DEFAULT_POST_LOGIN_URL);
  });

  it('una URL del mismo origen con ruta //otro-host tampoco pasa', () => {
    expect(getSafeCallbackUrl(`${ORIGIN}//evil.example`, ORIGIN)).toBe(DEFAULT_POST_LOGIN_URL);
    expect(getSafeCallbackUrl(`${ORIGIN}/\\evil.example`, ORIGIN)).toBe(DEFAULT_POST_LOGIN_URL);
  });

  it('sin origen no acepta URL absolutas', () => {
    expect(getSafeCallbackUrl(`${ORIGIN}/home`)).toBe(DEFAULT_POST_LOGIN_URL);
  });

  it('vacío o nulo → inicio por defecto', () => {
    expect(getSafeCallbackUrl(null, ORIGIN)).toBe(DEFAULT_POST_LOGIN_URL);
    expect(getSafeCallbackUrl('   ', ORIGIN)).toBe(DEFAULT_POST_LOGIN_URL);
  });
});

describe('resolveAuthRedirect (callback redirect de NextAuth)', () => {
  it('ruta relativa → baseUrl + ruta', () => {
    expect(resolveAuthRedirect('/home', ORIGIN)).toBe(`${ORIGIN}/home`);
    expect(resolveAuthRedirect('/login', `${ORIGIN}/`)).toBe(`${ORIGIN}/login`);
  });

  it('URL del mismo origen se respeta', () => {
    expect(resolveAuthRedirect(`${ORIGIN}/process/sgc?x=1`, ORIGIN)).toBe(
      `${ORIGIN}/process/sgc?x=1`
    );
  });

  it.each(MALICIOSOS)('%j → baseUrl', (v) => {
    expect(resolveAuthRedirect(v, ORIGIN)).toBe(ORIGIN);
  });

  it('mismo host pero otro puerto o esquema → baseUrl', () => {
    expect(resolveAuthRedirect('https://groupsharedservices.farmalogica.com/home', ORIGIN)).toBe(
      ORIGIN
    );
    expect(resolveAuthRedirect('http://groupsharedservices.farmalogica.com:8445/home', ORIGIN)).toBe(
      ORIGIN
    );
  });

  it('mismo origen con ruta //otro-host → baseUrl', () => {
    expect(resolveAuthRedirect(`${ORIGIN}//evil.example`, ORIGIN)).toBe(ORIGIN);
  });
});

describe('rutas retiradas por la auditoría OWASP del login', () => {
  const raiz = (rel: string) => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));

  it.each([
    'app/api/auth/register/route.ts', // H-03: registro público sin sesión
    'app/register/page.tsx', // H-03: página de registro pública
    'app/api/auth/callback/route.ts', // H-10: canje heredado de Microsoft con el secreto
  ])('%s ya no existe', (rel) => {
    expect(existsSync(raiz(rel))).toBe(false);
  });

  it('la ruta de NextAuth sigue existiendo', () => {
    expect(existsSync(raiz('app/api/auth/[...nextauth]/route.ts'))).toBe(true);
  });
});
