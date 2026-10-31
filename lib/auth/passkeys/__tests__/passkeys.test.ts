import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanPasskeyName,
  isCredentialId,
  parseTransports,
  passkeyDeviceName,
  resolveRelyingParty,
  serializeTransports,
} from '../config';
import { consumeChallenge, readCookie, sealChallenge } from '../challenge';
import { callbackProviderFromUrl } from '../../login-audit/flow';
import { LOGIN_PROVIDERS, isLoginProvider } from '../../login-audit/constants';

describe('passkeys — sitio (rpID y origen)', () => {
  it('toma el dominio y el origen con puerto de NEXTAUTH_URL', () => {
    expect(resolveRelyingParty({ NEXTAUTH_URL: 'https://groupsharedservices.farmalogica.com:8445/' })).toEqual({
      rpID: 'groupsharedservices.farmalogica.com',
      rpName: 'SynerLink',
      origin: 'https://groupsharedservices.farmalogica.com:8445',
    });
  });

  it('PASSKEY_ORIGIN y PASSKEY_RP_ID mandan sobre NEXTAUTH_URL', () => {
    expect(
      resolveRelyingParty({
        NEXTAUTH_URL: 'https://otro.test',
        PASSKEY_ORIGIN: 'https://app.gsslatam.com',
        PASSKEY_RP_ID: 'gsslatam.com',
      })
    ).toMatchObject({ rpID: 'gsslatam.com', origin: 'https://app.gsslatam.com' });
  });

  it('sin HTTPS (salvo localhost) o sin URL no ofrece passkeys', () => {
    expect(resolveRelyingParty({ NEXTAUTH_URL: 'http://192.168.11.230:3030' })).toBeNull();
    expect(resolveRelyingParty({})).toBeNull();
    expect(resolveRelyingParty({ NEXTAUTH_URL: 'no-es-url' })).toBeNull();
    expect(resolveRelyingParty({ NEXTAUTH_URL: 'http://localhost:3000' })?.rpID).toBe('localhost');
  });
});

describe('passkeys — utilidades', () => {
  it('nombre del dispositivo legible y acotado', () => {
    expect(passkeyDeviceName({ os: 'iOS', browser: 'Safari' })).toBe('iOS · Safari');
    expect(passkeyDeviceName({ os: null, browser: null })).toBe('Dispositivo');
    expect(cleanPasskeyName('  Mi\u0007 iPhone  ', 'x')).toBe('Mi iPhone');
    expect(cleanPasskeyName('', 'Sugerido')).toBe('Sugerido');
    expect(cleanPasskeyName(42, 'Sugerido')).toBe('Sugerido');
    expect(cleanPasskeyName('a'.repeat(300), 'x')).toHaveLength(100);
  });

  it('transports: solo valores conocidos, ida y vuelta', () => {
    expect(serializeTransports(['internal', 'hybrid', 'internal', 'raro', 5])).toBe('internal,hybrid');
    expect(serializeTransports([])).toBeNull();
    expect(serializeTransports('internal')).toBeNull();
    expect(parseTransports('internal,hybrid,raro')).toEqual(['internal', 'hybrid']);
    expect(parseTransports(null)).toBeUndefined();
  });

  it('id de credencial: solo base64url razonable', () => {
    expect(isCredentialId('AbC_-123')).toBe(true);
    expect(isCredentialId('')).toBe(false);
    expect(isCredentialId("x' OR 1=1")).toBe(false);
    expect(isCredentialId('a'.repeat(513))).toBe(false);
    expect(isCredentialId(null)).toBe(false);
  });

  it('lee la cookie del reto de la cabecera cruda', () => {
    expect(readCookie('a=1; synerlink.passkey-challenge=abc%2Edef; b=2', 'synerlink.passkey-challenge')).toBe('abc.def');
    expect(readCookie('a=1', 'synerlink.passkey-challenge')).toBeNull();
    expect(readCookie(undefined, 'x')).toBeNull();
  });
});

describe('passkeys — reto cifrado de un solo uso', () => {
  const previous = process.env.NEXTAUTH_SECRET;
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = 'secreto-de-prueba-con-suficiente-largo-1234567890';
  });
  afterEach(() => {
    process.env.NEXTAUTH_SECRET = previous;
    vi.useRealTimers();
  });

  it('sirve una sola vez y solo para su propósito', async () => {
    const sealed = await sealChallenge({ challenge: 'reto-login-1', purpose: 'login' });
    expect(await consumeChallenge(sealed, 'register', 'u1')).toBeNull();
    expect(await consumeChallenge(sealed, 'login')).toBe('reto-login-1');
    expect(await consumeChallenge(sealed, 'login')).toBeNull();
  });

  it('el reto de registro queda atado a la persona', async () => {
    const sealed = await sealChallenge({ challenge: 'reto-registro-1', purpose: 'register', userId: 'u1' });
    expect(await consumeChallenge(sealed, 'register', 'u2')).toBeNull();
    const again = await sealChallenge({ challenge: 'reto-registro-2', purpose: 'register', userId: 'u1' });
    expect(await consumeChallenge(again, 'register', 'u1')).toBe('reto-registro-2');
  });

  it('rechaza cookies alteradas o vacías', async () => {
    const sealed = await sealChallenge({ challenge: 'reto-x', purpose: 'login' });
    expect(await consumeChallenge(`${sealed.slice(0, -4)}AAAA`, 'login')).toBeNull();
    expect(await consumeChallenge('basura', 'login')).toBeNull();
    expect(await consumeChallenge(null, 'login')).toBeNull();
  });
});

describe('passkeys — auditoría de inicios de sesión', () => {
  it('el callback de passkey se audita como su propio proveedor', () => {
    expect(isLoginProvider('passkey')).toBe(true);
    expect(LOGIN_PROVIDERS.passkey).toMatch(/Biométrico/);
    expect(callbackProviderFromUrl('https://x.test/api/auth/callback/passkey')).toBe('passkey');
  });
});

describe('passkeys — scripts SQL', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = process.cwd();
  const leer = (rel: string) => readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n');
  const bloque = (sql: string) => {
    const desde = sql.indexOf('/* ---- dbo.user_passkey');
    const hasta = sql.indexOf('END;\n', sql.indexOf("N''passkey''")) + 4;
    return sql.slice(desde, hasta);
  };

  it('PRUEBAS, PROD y la migración llevan el mismo DDL', () => {
    const migracion = bloque(leer('prisma/migrations/20261031150000_user_passkey/migration.sql'));
    expect(migracion).toContain('CREATE TABLE [dbo].[user_passkey]');
    expect(bloque(leer('prisma/manual/2026-10-31-passkeys-PRUEBAS.sql'))).toBe(migracion);
    expect(bloque(leer('prisma/manual/2026-10-31-passkeys-PROD.sql'))).toBe(migracion);
  });

  it('cada script se detiene en una base que no es la suya', () => {
    expect(leer('prisma/manual/2026-10-31-passkeys-PRUEBAS.sql')).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB_PRUEBAS'/);
    expect(leer('prisma/manual/2026-10-31-passkeys-PROD.sql')).toMatch(/IF DB_NAME\(\) NOT IN \(N'KRONOSDB'\)/);
  });
});

describe('passkeys — opciones con el reto exacto', () => {
  it('las opciones de login y de registro devuelven el MISMO reto que se guarda en la cookie', async () => {
    vi.resetModules();
    const prismaMock = { userPasskey: { findMany: vi.fn().mockResolvedValue([]) } };
    vi.doMock('../../../prisma', () => ({ prisma: prismaMock }));
    const previous = process.env.NEXTAUTH_URL;
    process.env.NEXTAUTH_URL = 'https://synerlink.test';
    try {
      const { loginOptions, registrationOptions } = await import('../service');
      const reto = 'PBGw7HGG5PZjyMCKb6FyM6oUGkYHLFGu4LuU7NVKgSk';
      expect((await loginOptions(reto)).challenge).toBe(reto);
      const reg = await registrationOptions({ id: 'u1', email: 'a@b.co', name: 'Ana' }, reto);
      expect(reg.challenge).toBe(reto);
      expect(reg.rp.id).toBe('synerlink.test');
      expect(reg.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });
    } finally {
      process.env.NEXTAUTH_URL = previous;
      vi.doUnmock('../../../prisma');
    }
  });
});
