import { describe, expect, it } from 'vitest';
import { readClientOrigin } from '../../../chat/client-origin';
import {
  describeFailureReason,
  isLoginAuditMarkerSubprocess,
  LOGIN_AUDIT_MARKER_URL,
} from '../constants';
import { escapeLike, parseLoginAuditFilters, todayInColombia } from '../filters';
import {
  callbackProviderFromUrl,
  csrfRejectedFromRedirectUrl,
  errorFromRedirectUrl,
  normalizeIdentifier,
} from '../flow';
import { classifyIp, normalizeIp } from '../ip';
import { parseUserAgent } from '../user-agent';

describe('IP real detrás de IIS/ARR', () => {
  it('quita el puerto que agrega ARR y toma la primera de la cadena', () => {
    const req = new Request('https://x.test/api/auth/callback/credentials', {
      headers: { 'x-forwarded-for': '181.49.10.20:54321, 10.0.0.5', 'user-agent': 'UA' },
    });
    expect(readClientOrigin(req).clientIp).toBe('181.49.10.20');
  });

  it('IPv6 entre corchetes con puerto', () => {
    const req = new Request('https://x.test/', { headers: { 'x-forwarded-for': '[2800:e2:1::5]:443' } });
    expect(readClientOrigin(req).clientIp).toBe('2800:e2:1::5');
  });
});

describe('classifyIp', () => {
  it.each([
    ['10.1.2.3', 'INTERNA'],
    ['192.168.10.20', 'INTERNA'],
    ['172.16.0.1', 'INTERNA'],
    ['172.31.255.255', 'INTERNA'],
    ['127.0.0.1', 'INTERNA'],
    ['169.254.1.1', 'INTERNA'],
    ['100.64.0.1', 'INTERNA'],
    ['::1', 'INTERNA'],
    ['fd12:3456::1', 'INTERNA'],
    ['fe80::1%eth0', 'INTERNA'],
    ['::ffff:192.168.1.4', 'INTERNA'],
    ['172.32.0.1', 'PUBLICA'],
    ['181.49.10.20', 'PUBLICA'],
    ['2800:e2:1::5', 'PUBLICA'],
    ['', 'DESCONOCIDA'],
    [null, 'DESCONOCIDA'],
    ['no-es-ip', 'DESCONOCIDA'],
    ['999.1.1.1', 'DESCONOCIDA'],
  ])('%s → %s', (ip, scope) => {
    expect(classifyIp(ip as string | null)).toBe(scope);
  });

  it('normaliza IPv4 mapeada', () => {
    expect(normalizeIp('::FFFF:8.8.8.8')).toBe('8.8.8.8');
  });
});

describe('parseUserAgent', () => {
  it('Chrome en Windows', () => {
    expect(
      parseUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
      )
    ).toEqual({ browser: 'Chrome 141', os: 'Windows 10/11', device: 'Escritorio' });
  });
  it('Edge antes que Chrome', () => {
    expect(
      parseUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.3537.71'
      ).browser
    ).toBe('Edge 141');
  });
  it('Safari en iPhone', () => {
    expect(
      parseUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1'
      )
    ).toEqual({ browser: 'Safari 18', os: 'iOS 18', device: 'Celular' });
  });
  it('Chrome en Android celular y tableta', () => {
    const phone = parseUserAgent(
      'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36'
    );
    expect(phone).toEqual({ browser: 'Chrome 141', os: 'Android 14', device: 'Celular' });
    const tablet = parseUserAgent(
      'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
    );
    expect(tablet.device).toBe('Tableta');
  });
  it('Firefox en macOS', () => {
    expect(
      parseUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0')
    ).toEqual({ browser: 'Firefox 131', os: 'macOS', device: 'Escritorio' });
  });
  it('herramientas y vacío', () => {
    expect(parseUserAgent('curl/8.7.1').browser).toBe('curl');
    expect(parseUserAgent('')).toEqual({ browser: null, os: null, device: null });
    expect(parseUserAgent(null)).toEqual({ browser: null, os: null, device: null });
  });
  it('no se cuelga con una cabecera enorme armada a propósito', () => {
    const t = Date.now();
    parseUserAgent('Chrome/'.repeat(50_000));
    expect(Date.now() - t).toBeLessThan(500);
  });
});

describe('callbackProviderFromUrl', () => {
  it('reconoce solo los callbacks auditados', () => {
    expect(callbackProviderFromUrl('https://x.test/api/auth/callback/credentials')).toBe('credentials');
    expect(callbackProviderFromUrl('https://x.test/api/auth/callback/supplier-nit?x=1')).toBe('supplier-nit');
    expect(callbackProviderFromUrl('https://x.test/api/auth/callback/azure-ad?code=abc&state=z')).toBe('azure-ad');
    expect(callbackProviderFromUrl('https://x.test/api/auth/session')).toBeNull();
    expect(callbackProviderFromUrl('https://x.test/api/auth/csrf')).toBeNull();
    expect(callbackProviderFromUrl('https://x.test/api/auth/signin/azure-ad')).toBeNull();
    expect(callbackProviderFromUrl('https://x.test/api/auth/callback/otro')).toBeNull();
    expect(callbackProviderFromUrl('https://x.test/api/auth/callback/credentials/extra')).toBeNull();
  });
});

describe('errorFromRedirectUrl', () => {
  it('lee el ?error= de NextAuth', () => {
    expect(errorFromRedirectUrl('https://x.test/api/auth/error?error=CredentialsSignin')).toBe('CredentialsSignin');
    expect(errorFromRedirectUrl('/login?error=OAuthCallback')).toBe('OAuthCallback');
    expect(errorFromRedirectUrl('https://x.test/process')).toBeNull();
    expect(errorFromRedirectUrl(null)).toBeNull();
  });
});

describe('csrfRejectedFromRedirectUrl', () => {
  it('detecta el rechazo por CSRF de NextAuth (?csrf=true, sin error=)', () => {
    expect(csrfRejectedFromRedirectUrl('https://x.test/api/auth/signin?csrf=true')).toBe(true);
    expect(csrfRejectedFromRedirectUrl('/api/auth/signin?csrf=true')).toBe(true);
    expect(errorFromRedirectUrl('https://x.test/api/auth/signin?csrf=true')).toBeNull();
  });

  it('no lo confunde con otras respuestas', () => {
    expect(csrfRejectedFromRedirectUrl('https://x.test/process')).toBe(false);
    expect(csrfRejectedFromRedirectUrl('/api/auth/signin?csrf=false')).toBe(false);
    expect(csrfRejectedFromRedirectUrl('/api/auth/error?error=CredentialsSignin')).toBe(false);
    expect(csrfRejectedFromRedirectUrl(null)).toBe(false);
    expect(csrfRejectedFromRedirectUrl('http://[')).toBe(false);
  });
});

describe('describeFailureReason (motivos nuevos)', () => {
  it('tiene etiqueta para CSRF_INVALIDO y SIN_AUTORIZACION', () => {
    expect(describeFailureReason('CSRF_INVALIDO')).toMatch(/CSRF/);
    expect(describeFailureReason('SIN_AUTORIZACION')).toMatch(/no llegó a validar/);
  });
});

describe('normalizeIdentifier', () => {
  it('minúsculas, sin espacios y recortado', () => {
    expect(normalizeIdentifier('  Nicolas.Rivera@GSSLATAM.com ')).toBe('nicolas.rivera@gsslatam.com');
    expect(normalizeIdentifier('')).toBeNull();
    expect(normalizeIdentifier(42)).toBeNull();
    expect(normalizeIdentifier('a'.repeat(1000))!.length).toBe(320);
  });
});

describe('marcador y motivos', () => {
  it('reconoce el subproceso-permiso', () => {
    expect(isLoginAuditMarkerSubprocess({ subprocess_url: LOGIN_AUDIT_MARKER_URL })).toBe(true);
    expect(isLoginAuditMarkerSubprocess({ subprocess_url: ' /Process/Administration/Users/Inicios-Sesion/ ' })).toBe(true);
    expect(isLoginAuditMarkerSubprocess({ subprocess_url: '/process/administration/users' })).toBe(false);
    expect(isLoginAuditMarkerSubprocess({ subprocess_url: null })).toBe(false);
  });
  it('describe los motivos conocidos y deja pasar los desconocidos', () => {
    expect(describeFailureReason('CONTRASENA_INCORRECTA')).toBe('Contraseña incorrecta');
    expect(describeFailureReason('OTRO')).toBe('OTRO');
    expect(describeFailureReason(null)).toBe('');
  });
});

describe('parseLoginAuditFilters', () => {
  const now = new Date('2026-10-16T15:00:00Z');

  it('por defecto: últimos 30 días hasta hoy (hora Colombia)', () => {
    const f = parseLoginAuditFilters(new URLSearchParams(), now);
    expect(f.to.toISOString()).toBe('2026-10-17T05:00:00.000Z');
    expect(f.from.toISOString()).toBe('2026-09-17T05:00:00.000Z');
    expect(f).toMatchObject({ user: '', country: null, result: null, provider: null, alertsOnly: false, page: 1, limit: 25 });
  });

  it('valida y limpia lo que llega por la URL', () => {
    const f = parseLoginAuditFilters(
      new URLSearchParams({
        user: '  ana ',
        from: '2026-10-01',
        to: '2026-10-05',
        country: 'us',
        result: 'fallo',
        provider: 'azure-ad',
        alerts: '1',
        page: '3',
        limit: '5000',
      }),
      now
    );
    expect(f.from.toISOString()).toBe('2026-10-01T05:00:00.000Z');
    expect(f.to.toISOString()).toBe('2026-10-06T05:00:00.000Z');
    expect(f).toMatchObject({ user: 'ana', country: 'US', result: 'fallo', provider: 'azure-ad', alertsOnly: true, page: 3, limit: 100 });
  });

  it('descarta valores raros y rangos invertidos o enormes', () => {
    const f = parseLoginAuditFilters(
      new URLSearchParams({ country: "CO'; DROP", result: 'x', provider: 'otro', from: '2026-10-10', to: '2026-10-01' }),
      now
    );
    expect(f.country).toBeNull();
    expect(f.result).toBeNull();
    expect(f.provider).toBeNull();
    expect(f.from < f.to).toBe(true);
    const big = parseLoginAuditFilters(new URLSearchParams({ from: '2000-01-01', to: '2026-10-16' }), now);
    expect((big.to.getTime() - big.from.getTime()) / 86_400_000).toBe(366);
    expect(parseLoginAuditFilters(new URLSearchParams({ country: 'interna' }), now).country).toBe('INTERNA');
  });

  it('el día en Colombia cambia a las 05:00 UTC (medianoche UTC−5)', () => {
    expect(todayInColombia(new Date('2026-10-17T04:59:00Z'))).toBe('2026-10-16');
    expect(todayInColombia(new Date('2026-10-17T05:00:00Z'))).toBe('2026-10-17');
  });

  it('escapa comodines de LIKE', () => {
    expect(escapeLike('a_b%c[d\\')).toBe('a\\_b\\%c\\[d\\\\');
  });
});
