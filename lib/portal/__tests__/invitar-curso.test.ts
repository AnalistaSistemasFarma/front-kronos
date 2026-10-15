import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ESPERA_MISMA_PERSONA_MS,
  MAX_INVITACIONES_POR_HORA,
  _reiniciarLimitesInvitacion,
  cuerpoInvitacion,
  enviarInvitacionCurso,
  puedeInvitar,
  registrarInvitacion,
  urlDelCurso,
  urlPublicaDelPortal,
} from '../invitar-curso';

// Invitar a un curso por correo (Cristian Baldión, 2026-10-14). El servicio de correo se SIMULA: ningún correo real sale.

beforeEach(() => _reiniciarLimitesInvitacion());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('urlPublicaDelPortal / urlDelCurso', () => {
  it('toma la primera variable válida y la reduce al origen (sin ruta ni barra final)', () => {
    expect(urlPublicaDelPortal({ PORTAL_TH_URL_PUBLICA: 'https://portal.gsslatam.com/algo/más/', NEXTAUTH_URL: 'https://otra.com' } as unknown as NodeJS.ProcessEnv)).toBe('https://portal.gsslatam.com');
    expect(urlPublicaDelPortal({ NEXTAUTH_URL: 'http://192.168.11.230:3030' } as unknown as NodeJS.ProcessEnv)).toBe('http://192.168.11.230:3030');
  });
  it('salta las variables vacías o mal escritas, y devuelve null si no hay ninguna', () => {
    expect(urlPublicaDelPortal({ PORTAL_TH_URL_PUBLICA: 'esto no es una url', APP_URL: 'javascript:alert(1)', NEXTAUTH_URL: 'https://ok.com' } as unknown as NodeJS.ProcessEnv)).toBe('https://ok.com');
    expect(urlPublicaDelPortal({} as NodeJS.ProcessEnv)).toBeNull();
    expect(urlPublicaDelPortal({ APP_URL: 'ftp://x.com' } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });
  it('el enlace lleva a Formación con el curso', () => {
    expect(urlDelCurso('https://portal.gsslatam.com', 7)).toBe('https://portal.gsslatam.com/portal/formacion?curso=7');
  });
});

describe('cuerpoInvitacion', () => {
  it('trae el curso, quién invita, el botón y el enlace en texto', () => {
    const h = cuerpoInvitacion({ cursoTitulo: 'INDUCCIÓN SST', urlCurso: 'https://p.com/portal/formacion?curso=7', invitadoPor: 'Cristian Baldion' });
    expect(h).toContain('<strong>Cristian Baldion</strong> lo invitó');
    expect(h).toContain('INDUCCIÓN SST');
    expect(h).toContain('Ir al curso');
    expect(h.match(/https:\/\/p\.com\/portal\/formacion\?curso=7/g)).toHaveLength(3); // botón + enlace visible + su href
  });
  it('sin invitador dice «Lo invitaron»', () => {
    expect(cuerpoInvitacion({ cursoTitulo: 'X', urlCurso: 'https://p.com/x' })).toContain('Lo invitaron al curso');
  });
  it('escapa el HTML del título y del nombre (no se puede inyectar nada en el correo)', () => {
    const h = cuerpoInvitacion({ cursoTitulo: '<script>alert(1)</script> "x"', urlCurso: 'https://p.com/?a=1&b="2"', invitadoPor: '<b>Yo</b>' });
    expect(h).not.toContain('<script>');
    expect(h).not.toContain('<b>Yo</b>');
    expect(h).toContain('&lt;script&gt;');
    expect(h).toContain('&amp;b=&quot;2&quot;');
  });
});

describe('enviarInvitacionCurso', () => {
  const datos = { correo: 'ana@gsslatam.com', cursoTitulo: 'INDUCCIÓN SST', urlCurso: 'https://p.com/portal/formacion?curso=7', invitadoPor: 'Cristian Baldion' };

  it('lanza si no está configurado el servicio de correo, sin llamar a la red', async () => {
    vi.stubEnv('API_EMAIL', '');
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await expect(enviarInvitacionCurso(datos)).rejects.toThrow(/falta API_EMAIL/);
    expect(f).not.toHaveBeenCalled();
  });

  it('manda el mensaje por /sapsend/sendMessage con destinatario, asunto, curso y enlace', async () => {
    vi.stubEnv('API_EMAIL', 'https://correo.interno/');
    const f = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', f);
    await enviarInvitacionCurso(datos);
    const [url, init] = f.mock.calls[0] as unknown as [string, { method: string; body: string }];
    expect(url).toBe('https://correo.interno/sapsend/sendMessage');
    expect(init.method).toBe('POST');
    const cuerpo = JSON.parse(init.body);
    expect(cuerpo.userEmail).toBe('ana@gsslatam.com');
    expect(cuerpo.title).toBe('Lo invitaron al curso: INDUCCIÓN SST');
    expect(cuerpo.table).toEqual([{ Curso: 'INDUCCIÓN SST' }, { 'Lo invitó': 'Cristian Baldion' }]);
    expect(cuerpo.outro).toContain('https://p.com/portal/formacion?curso=7');
  });

  it('si el servicio rechaza el envío, lanza solo con el código (sin el cuerpo, que puede traer el correo)', async () => {
    vi.stubEnv('API_EMAIL', 'https://correo.interno');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('fallo para ana@gsslatam.com', { status: 500 })));
    const e = await enviarInvitacionCurso(datos).catch((x: Error) => x);
    expect((e as Error).message).toBe('El servicio de correo respondió 500.');
    expect((e as Error).message).not.toContain('ana@');
  });

  it('el título del curso con saltos de línea no rompe el asunto', async () => {
    vi.stubEnv('API_EMAIL', 'https://correo.interno');
    const f = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', f);
    await enviarInvitacionCurso({ ...datos, cursoTitulo: 'Curso\r\nBcc: x@y.com' });
    const cuerpo = JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(cuerpo.title).toBe('Lo invitaron al curso: Curso Bcc: x@y.com');
    expect(cuerpo.title).not.toMatch(/[\r\n]/);
  });
});

describe('topes', () => {
  const T0 = 1_000_000;
  it('la misma persona en el mismo curso: espera 10 minutos entre invitaciones, pero otro curso u otra persona sí', () => {
    expect(puedeInvitar('a@x.com', 7, 'ana@x.com', T0)).toEqual({ ok: true });
    registrarInvitacion('a@x.com', 7, 'ana@x.com', T0);
    const r = puedeInvitar('a@x.com', 7, 'ana@x.com', T0 + 60_000);
    expect(r).toMatchObject({ ok: false, motivo: 'reciente' });
    expect(puedeInvitar('a@x.com', 8, 'ana@x.com', T0 + 60_000).ok).toBe(true);
    expect(puedeInvitar('a@x.com', 7, 'luis@x.com', T0 + 60_000).ok).toBe(true);
    expect(puedeInvitar('a@x.com', 7, 'ana@x.com', T0 + ESPERA_MISMA_PERSONA_MS + 1).ok).toBe(true);
  });
  it('tope por hora por invitador, que se libera pasada la hora', () => {
    for (let i = 0; i < MAX_INVITACIONES_POR_HORA; i++) registrarInvitacion('a@x.com', 7, `p${i}@x.com`, T0);
    expect(puedeInvitar('a@x.com', 7, 'nuevo@x.com', T0 + 1000)).toMatchObject({ ok: false, motivo: 'hora' });
    expect(puedeInvitar('otro@x.com', 7, 'nuevo@x.com', T0 + 1000).ok).toBe(true);
    expect(puedeInvitar('a@x.com', 7, 'nuevo@x.com', T0 + 61 * 60_000).ok).toBe(true);
  });
  it('puedeInvitar no registra: un envío fallido no gasta el tope', () => {
    for (let i = 0; i < 100; i++) puedeInvitar('a@x.com', 7, 'ana@x.com', T0);
    expect(puedeInvitar('a@x.com', 7, 'ana@x.com', T0).ok).toBe(true);
  });
});
