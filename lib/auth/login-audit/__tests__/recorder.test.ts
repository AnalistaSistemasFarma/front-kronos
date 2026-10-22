/**
 * El registro de inicios de sesión NUNCA frena ni rompe el login, y nunca guarda
 * la contraseña. Base y geolocalización simuladas.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, geolocateIp } = vi.hoisted(() => ({
  prisma: { $queryRaw: vi.fn(), $executeRaw: vi.fn() },
  geolocateIp: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('../../../prisma', () => ({ prisma }));
vi.mock('../geo', () => ({ geolocateIp }));

import { LOGIN_AUDIT_LIMITS } from '../constants';
import { noteLoginAttempt, outcomeWithoutNote, withLoginAudit, type NextAuthRouteContext } from '../recorder';

const ctx = { params: Promise.resolve({ nextauth: ['callback', 'credentials'] }) } as NextAuthRouteContext;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

function loginRequest(path: string, ip = '181.49.10.20:54321', method = 'POST') {
  return new Request(`https://synerlink.test${path}`, {
    method,
    headers: { 'x-forwarded-for': ip, 'user-agent': UA },
    body: method === 'POST' ? 'email=ana%40x.com&password=SuperSecreta123' : undefined,
  });
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

/** Valores interpolados de la ÚLTIMA llamada a $executeRaw (plantilla etiquetada). */
function insertedValues() {
  const call = prisma.$executeRaw.mock.calls.at(-1)!;
  const [, ...values] = call;
  const [provider, identifier, idUser, userName, success, reason, ip, scope, cc, cn, region, city, ua, browser, os, device, companies] =
    values;
  return { provider, identifier, idUser, userName, success, reason, ip, scope, cc, cn, region, city, ua, browser, os, device, companies, all: values };
}

beforeEach(() => {
  vi.clearAllMocks();
  geolocateIp.mockReturnValue({ scope: 'PUBLICA', countryCode: 'CO', countryName: 'Colombia', region: 'Bogotá D.C.', city: 'Bogotá' });
  prisma.$queryRaw.mockResolvedValue([{ company: 'One Latam Pharma' }, { company: 'GSS' }]);
  prisma.$executeRaw.mockResolvedValue(1);
});

describe('withLoginAudit', () => {
  it('las rutas que no son callback pasan directo y no escriben', async () => {
    const handler = vi.fn(async () => {
      noteLoginAttempt({ identifier: 'x', success: true });
      return json({ ok: true });
    });
    const res = await withLoginAudit(handler)(loginRequest('/api/auth/session', '1.1.1.1', 'GET'), ctx);
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('éxito por credenciales: IP sin puerto, país, navegador y empresas; sin contraseña', async () => {
    const handler = vi.fn(async () => {
      noteLoginAttempt({ identifier: ' Ana@X.com ', userId: 'u1', userName: 'Ana', success: true });
      return json({ url: 'https://synerlink.test/process' });
    });
    const res = await withLoginAudit(handler)(loginRequest('/api/auth/callback/credentials'), ctx);
    expect(await res.json()).toEqual({ url: 'https://synerlink.test/process' });

    await vi.waitFor(() => expect(prisma.$executeRaw).toHaveBeenCalledTimes(1));
    const v = insertedValues();
    expect(v).toMatchObject({
      provider: 'credentials',
      identifier: 'ana@x.com',
      idUser: 'u1',
      userName: 'Ana',
      success: 1,
      reason: null,
      ip: '181.49.10.20',
      scope: 'PUBLICA',
      cc: 'CO',
      city: 'Bogotá',
      browser: 'Chrome 141',
      os: 'Windows 10/11',
      device: 'Escritorio',
      companies: 'One Latam Pharma, GSS',
    });
    expect(geolocateIp).toHaveBeenCalledWith('181.49.10.20');
    expect(JSON.stringify(v.all)).not.toContain('SuperSecreta123');
  });

  it('fallo con motivo', async () => {
    const handler = vi.fn(async () => {
      noteLoginAttempt({ identifier: 'ana@x.com', userId: 'u1', success: false, reason: 'CONTRASENA_INCORRECTA' });
      return json({ url: 'https://synerlink.test/api/auth/error?error=CredentialsSignin' });
    });
    await withLoginAudit(handler)(loginRequest('/api/auth/callback/credentials'), ctx);
    await vi.waitFor(() => expect(prisma.$executeRaw).toHaveBeenCalledTimes(1));
    expect(insertedValues()).toMatchObject({ success: 0, reason: 'CONTRASENA_INCORRECTA' });
  });

  it('Microsoft rechazado (sin anotación, ?error= en Location)', async () => {
    const handler = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: 'https://synerlink.test/login?error=OAuthCallback' } })
    );
    const res = await withLoginAudit(handler)(loginRequest('/api/auth/callback/azure-ad?code=abc', '8.8.8.8', 'GET'), ctx);
    expect(res.status).toBe(302);
    await vi.waitFor(() => expect(prisma.$executeRaw).toHaveBeenCalledTimes(1));
    expect(insertedValues()).toMatchObject({ provider: 'azure-ad', identifier: null, success: 0, reason: 'MICROSOFT_RECHAZADO' });
  });

  it('POST de credenciales rechazado por CSRF (JSON ?csrf=true): FALLIDO, CSRF_INVALIDO, nunca éxito', async () => {
    // NextAuth corta antes de llamar a authorize: nadie anota el intento.
    const handler = vi.fn(async () => json({ url: 'https://synerlink.test/api/auth/signin?csrf=true' }));
    await withLoginAudit(handler)(loginRequest('/api/auth/callback/credentials'), ctx);
    await vi.waitFor(() => expect(prisma.$executeRaw).toHaveBeenCalledTimes(1));
    expect(insertedValues()).toMatchObject({ provider: 'credentials', success: 0, reason: 'CSRF_INVALIDO' });
    expect(JSON.stringify(insertedValues().all)).not.toContain('SuperSecreta123');
  });

  it('rechazo por CSRF con redirección 302 (Location ?csrf=true) en NIT: FALLIDO, CSRF_INVALIDO', async () => {
    const handler = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: 'https://synerlink.test/api/auth/signin?csrf=true' } })
    );
    await withLoginAudit(handler)(loginRequest('/api/auth/callback/supplier-nit'), ctx);
    await vi.waitFor(() => expect(prisma.$executeRaw).toHaveBeenCalledTimes(1));
    expect(insertedValues()).toMatchObject({ provider: 'supplier-nit', success: 0, reason: 'CSRF_INVALIDO' });
  });

  it('credenciales sin anotación de authorize y sin error en la respuesta: FALLIDO, SIN_AUTORIZACION', async () => {
    const handler = vi.fn(async () => json({ url: 'https://synerlink.test/process' }));
    await withLoginAudit(handler)(loginRequest('/api/auth/callback/credentials'), ctx);
    await vi.waitFor(() => expect(prisma.$executeRaw).toHaveBeenCalledTimes(1));
    expect(insertedValues()).toMatchObject({ provider: 'credentials', success: 0, reason: 'SIN_AUTORIZACION' });
  });

  it('Microsoft sin anotación y sin error sigue contando como éxito', async () => {
    const handler = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: 'https://synerlink.test/process' } })
    );
    await withLoginAudit(handler)(loginRequest('/api/auth/callback/azure-ad?code=abc', '8.8.8.8', 'GET'), ctx);
    await vi.waitFor(() => expect(prisma.$executeRaw).toHaveBeenCalledTimes(1));
    expect(insertedValues()).toMatchObject({ provider: 'azure-ad', success: 1, reason: null });
  });

  it('si authorize aprobó pero NextAuth terminó en error, cuenta como fallo', async () => {
    const handler = vi.fn(async () => {
      noteLoginAttempt({ identifier: 'ana@x.com', success: true });
      return json({ url: '/api/auth/error?error=Callback' });
    });
    await withLoginAudit(handler)(loginRequest('/api/auth/callback/credentials'), ctx);
    await vi.waitFor(() => expect(prisma.$executeRaw).toHaveBeenCalledTimes(1));
    expect(insertedValues()).toMatchObject({ success: 0, reason: 'ERROR_INTERNO' });
  });

  it('si la base falla (p. ej. falta la tabla) el login sigue igual', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    prisma.$executeRaw.mockRejectedValue(new Error("Invalid object name 'dbo.user_login_audit'"));
    prisma.$queryRaw.mockRejectedValue(new Error('caída'));
    const handler = vi.fn(async () => {
      noteLoginAttempt({ identifier: 'ana@x.com', userId: 'u1', success: true });
      return json({ url: '/process' });
    });
    const res = await withLoginAudit(handler)(loginRequest('/api/auth/callback/credentials'), ctx);
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(prisma.$executeRaw).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    errorLog.mockRestore();
  });

  it('si la geolocalización explota, tampoco se rompe nada', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    geolocateIp.mockImplementation(() => {
      throw new Error('mmdb dañado');
    });
    const handler = vi.fn(async () => json({ url: '/process' }));
    const res = await withLoginAudit(handler)(loginRequest('/api/auth/callback/credentials'), ctx);
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
  });

  it('si NextAuth lanza, el error sigue su curso y queda el intento como ERROR_INTERNO', async () => {
    const handler = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(withLoginAudit(handler)(loginRequest('/api/auth/callback/supplier-nit'), ctx)).rejects.toThrow('boom');
    await vi.waitFor(() => expect(prisma.$executeRaw).toHaveBeenCalledTimes(1));
    expect(insertedValues()).toMatchObject({ provider: 'supplier-nit', success: 0, reason: 'ERROR_INTERNO' });
  });

  it('la respuesta sale ANTES de escribir (no espera a la base)', async () => {
    let release: () => void = () => undefined;
    prisma.$executeRaw.mockImplementation(() => new Promise((r) => (release = () => r(1))));
    const handler = vi.fn(async () => {
      noteLoginAttempt({ identifier: 'ana@x.com', userId: 'u1', success: true });
      return json({ url: '/process' });
    });
    const res = await withLoginAudit(handler)(loginRequest('/api/auth/callback/credentials'), ctx);
    expect(res.status).toBe(200);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(prisma.$executeRaw).toHaveBeenCalled());
    release();
  });

  it('noteLoginAttempt fuera de contexto no hace nada', () => {
    expect(() => noteLoginAttempt({ identifier: 'x', success: true })).not.toThrow();
  });
});

describe('outcomeWithoutNote', () => {
  it('decide el resultado cuando nadie anotó el intento', () => {
    expect(outcomeWithoutNote('credentials', null, true)).toEqual({ success: false, reason: 'CSRF_INVALIDO' });
    expect(outcomeWithoutNote('azure-ad', null, true)).toEqual({ success: false, reason: 'CSRF_INVALIDO' });
    expect(outcomeWithoutNote('credentials', null, false)).toEqual({ success: false, reason: 'SIN_AUTORIZACION' });
    expect(outcomeWithoutNote('supplier-nit', 'ERROR', false)).toEqual({ success: false, reason: 'ERROR_INTERNO' });
    expect(outcomeWithoutNote('azure-ad', 'OAuthCallback', false)).toEqual({ success: false, reason: 'MICROSOFT_RECHAZADO' });
    expect(outcomeWithoutNote('azure-ad', null, false)).toEqual({ success: true, reason: null });
  });

  it('los motivos nuevos caben en failure_reason NVARCHAR(40) (sin CHECK en la tabla)', () => {
    for (const code of ['CSRF_INVALIDO', 'SIN_AUTORIZACION']) {
      expect(code.length).toBeLessThanOrEqual(LOGIN_AUDIT_LIMITS.failureReason);
    }
  });
});
