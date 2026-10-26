import { beforeEach, describe, expect, it, vi } from 'vitest';

// Redactar (correo nuevo, 2026-10-19): destinatarios, envío desde el buzón de la sesión, bandera, auditoría sin el
// cuerpo, saneado de HTML malicioso, tablas pegadas y autocompletado (recientes + directorio) con Graph simulado.
const db = vi.hoisted(() => ({ auditar: vi.fn(async () => undefined) }));
vi.mock('../db', () => db);

import { readCorreoConfig } from '../config';
import { normalizarDestinatario, revisarDestinatarios, separarDestinatarios, esExterno } from '../destinatarios';
import { esUrlDirectorio, GraphMailProvider, limpiarTokensApp, mailboxForSession, urlDirectorio } from '../graph';
import { markdownAHtml, markdownATexto } from '../markdown';
import { filasAMarkdown, tsvAMarkdown } from '../tablaPegada';
import { nuevosSimulados, reiniciarBuzonSimulado } from '../mock';
import { enviarNuevo, limpiarAsunto, limpiarRecientes, sugerirDestinatarios, type CorreoDeps } from '../service';
import type { AccesoCorreo } from '../db';
import type { ArchivoAdjunto } from '../types';

const graphEnv = {
  CORREO_MODO: 'graph',
  CORREO_INQUILINOS: 'gss',
  CORREO_GSS_TENANT_ID: '3409fd29-f351-4a98-8ef4-d98c8874a836',
  CORREO_GSS_CLIENT_ID: '28c47cc5-342a-4781-909e-d234db1bb993',
  CORREO_GSS_CLIENT_SECRET: 'secreto-de-prueba',
  CORREO_GSS_DOMINIOS: 'gsslatam.com',
};
const BASE = 'https://graph.microsoft.com/v1.0/users/laura%40gsslatam.com';
const MB = mailboxForSession('laura@gsslatam.com');
const yo: AccesoCorreo = { idUser: 'op1', nombre: 'Laura', email: 'laura@gsslatam.com', empresas: [{ idCompany: 1, companyName: 'GSS' }], empresasSolicitud: [{ idCompany: 1, companyName: 'GSS' }] };

function graphFalso(handler: (url: string, init: RequestInit) => { status?: number; body?: unknown }) {
  const llamadas: Array<{ url: string; init: RequestInit }> = [];
  const f = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url.includes('login.microsoftonline.com')) return new Response(JSON.stringify({ access_token: 'APP', expires_in: 3600 }), { status: 200 });
    llamadas.push({ url, init });
    const r = handler(url, init);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status ?? 200 });
  });
  return { f: f as unknown as typeof fetch, llamadas };
}

function deps(env: Record<string, string> = { CORREO_MODO: 'mock' }, extra: Partial<CorreoDeps> = {}): CorreoDeps {
  return {
    db: {} as never,
    cfg: readCorreoConfig(env),
    kronos: {} as never,
    crearSolicitud: vi.fn() as never,
    notificarNueva: vi.fn(),
    subirAdjuntos: vi.fn() as never,
    dominiosGrupo: ['gsslatam.com'],
    ...extra,
  };
}

const base = { para: ['ana@gsslatam.com'], cc: [] as string[], cco: [] as string[], asunto: 'Contrato', texto: 'Hola', adjuntos: [] as ArchivoAdjunto[], ip: '10.0.0.1' };

beforeEach(() => {
  vi.clearAllMocks();
  reiniciarBuzonSimulado();
  limpiarTokensApp();
  limpiarRecientes();
});

describe('Redactar · destinatarios', () => {
  it('normaliza «Nombre <correo>», mailto: y mayúsculas; rechaza lo que no es un correo', () => {
    expect(normalizarDestinatario('Ana Pérez <Ana.Perez@GSSLATAM.com>')).toBe('ana.perez@gsslatam.com');
    expect(normalizarDestinatario('mailto:x@y.co')).toBe('x@y.co');
    for (const malo of ['ana', 'ana@', '@x.com', 'a b@x.com', 'a@x', 'a@x.com\r\nBcc: v@x.com', '<script>@x.com']) expect(normalizarDestinatario(malo)).toBeNull();
  });

  it('separa lo pegado desde Outlook (comas, punto y coma, saltos y nombres con coma)', () => {
    expect(separarDestinatarios('a@x.com; b@x.com,\n"Pérez, Ana" <ana@x.com>; Luis <luis@x.com> c@x.com')).toEqual(['"Pérez, Ana" <ana@x.com>', 'Luis <luis@x.com>', 'a@x.com', 'b@x.com', 'c@x.com']);
  });

  it('sin repetidos entre campos, al menos uno, máximo 50 y los inválidos se informan', () => {
    const r = revisarDestinatarios({ para: ['A@x.com', 'a@x.com'], cc: ['a@x.com', 'b@x.com'], cco: ['b@x.com', 'c@x.com'] });
    expect(r).toMatchObject({ para: ['a@x.com'], cc: ['b@x.com'], cco: ['c@x.com'], total: 3, error: null });
    expect(revisarDestinatarios({ para: [], cc: [], cco: [] }).error).toMatch(/al menos un destinatario/);
    expect(revisarDestinatarios({ para: ['no-es-correo'], cc: [], cco: [] }).error).toMatch(/no-es-correo/);
    const muchos = Array.from({ length: 51 }, (_, i) => `p${i}@x.com`);
    expect(revisarDestinatarios({ para: muchos, cc: [], cco: [] }).error).toMatch(/Máximo 50/);
    expect(esExterno('a@externo.com', ['gsslatam.com'])).toBe(true);
    expect(esExterno('a@GSSLATAM.com', ['gsslatam.com'])).toBe(false);
  });
});

describe('Redactar · envío (servicio)', () => {
  it('bandera CORREO_ENVIO_HABILITADO=false → 403 sin tocar el buzón ni la auditoría', async () => {
    const { f, llamadas } = graphFalso(() => ({ status: 202 }));
    const d = deps({ ...graphEnv, CORREO_ENVIO_HABILITADO: 'false' }, { fetchFn: f });
    await expect(enviarNuevo(d, yo, base)).rejects.toMatchObject({ status: 403 });
    expect(llamadas).toHaveLength(0);
    expect(db.auditar).not.toHaveBeenCalled();
  });

  it('valida destinatarios, asunto y contenido antes de llamar a Microsoft', async () => {
    const { f, llamadas } = graphFalso(() => ({ status: 202 }));
    const d = deps(graphEnv, { fetchFn: f });
    await expect(enviarNuevo(d, yo, { ...base, para: ['malo'] })).rejects.toMatchObject({ status: 400, code: 'DESTINATARIOS' });
    await expect(enviarNuevo(d, yo, { ...base, para: [] })).rejects.toMatchObject({ status: 400 });
    await expect(enviarNuevo(d, yo, { ...base, asunto: 'x'.repeat(256) })).rejects.toMatchObject({ status: 400 });
    await expect(enviarNuevo(d, yo, { ...base, asunto: '', texto: '' })).rejects.toMatchObject({ status: 400 });
    await expect(enviarNuevo(d, yo, { ...base, adjuntos: [{ nombre: 'g.pdf', tipo: 'application/pdf', bytes: Buffer.alloc(3 * 1024 * 1024 + 1) }] })).rejects.toThrow(/3 MB/);
    await expect(enviarNuevo(d, yo, { ...base, adjuntos: Array.from({ length: 6 }, (_, i) => ({ nombre: `${i}.txt`, tipo: 'text/plain', bytes: Buffer.from('x') })) })).rejects.toThrow(/Máximo 5/);
    expect(llamadas).toHaveLength(0);
  });

  it('sin adjuntos: POST /users/{buzón DE LA SESIÓN}/sendMail con Para, CC, CCO y el cuerpo saneado; auditoría sin el cuerpo', async () => {
    const { f, llamadas } = graphFalso(() => ({ status: 202 }));
    const d = deps(graphEnv, { fetchFn: f });
    const r = await enviarNuevo(d, yo, { ...base, para: ['Ana <ana@gsslatam.com>'], cc: ['jefe@gsslatam.com'], cco: ['archivo@gsslatam.com'], asunto: 'Contrato\r\nBcc: victima@x.com', texto: 'Texto **secreto** del cuerpo' });
    expect(r).toEqual({ destinatarios: 3 });
    expect(llamadas.map((l) => `${l.init.method} ${l.url}`)).toEqual([`POST ${BASE}/sendMail`]);
    const body = JSON.parse(String(llamadas[0].init.body));
    expect(body.saveToSentItems).toBe(true);
    expect(body.message.subject).toBe('Contrato Bcc: victima@x.com');
    expect(body.message.toRecipients).toEqual([{ emailAddress: { address: 'ana@gsslatam.com' } }]);
    expect(body.message.ccRecipients).toEqual([{ emailAddress: { address: 'jefe@gsslatam.com' } }]);
    expect(body.message.bccRecipients).toEqual([{ emailAddress: { address: 'archivo@gsslatam.com' } }]);
    expect(body.message.body).toEqual({ contentType: 'HTML', content: '<p>Texto <strong>secreto</strong> del cuerpo</p>' });
    expect(db.auditar).toHaveBeenCalledTimes(1);
    const audit = (db.auditar.mock.calls[0] as unknown[])[1] as { accion: string; mailbox: string; detalle: string };
    expect(audit.accion).toBe('ENVIAR_NUEVO');
    expect(audit.mailbox).toBe('laura@gsslatam.com');
    expect(audit.detalle).toContain('ana@gsslatam.com');
    expect(audit.detalle).toContain('archivo@gsslatam.com');
    expect(audit.detalle).toContain('Contrato');
    expect(audit.detalle).not.toMatch(/secreto|cuerpo/);
  });

  it('con adjuntos: borrador en el buzón propio → adjuntos → send; si un adjunto falla, el borrador se borra', async () => {
    const ok = graphFalso((url, init) => (init.method === 'POST' && url === `${BASE}/messages` ? { status: 201, body: { id: 'DRAFT-ID-0001AAAA' } } : { status: 202 }));
    const adj = [{ nombre: 'acta.pdf', tipo: 'application/pdf', bytes: Buffer.from('%PDF') }];
    await enviarNuevo(deps(graphEnv, { fetchFn: ok.f }), yo, { ...base, adjuntos: adj });
    expect(ok.llamadas.map((l) => `${l.init.method} ${l.url}`)).toEqual([
      `POST ${BASE}/messages`,
      `POST ${BASE}/messages/DRAFT-ID-0001AAAA/attachments`,
      `POST ${BASE}/messages/DRAFT-ID-0001AAAA/send`,
    ]);
    expect(JSON.parse(String(ok.llamadas[1].init.body))).toMatchObject({ name: 'acta.pdf', contentBytes: Buffer.from('%PDF').toString('base64') });

    const falla = graphFalso((url, init) =>
      init.method === 'POST' && url === `${BASE}/messages` ? { status: 201, body: { id: 'DRAFT-ID-0002AAAA' } } : url.endsWith('/attachments') ? { status: 413 } : { status: 204 }
    );
    await expect(enviarNuevo(deps(graphEnv, { fetchFn: falla.f }), yo, { ...base, adjuntos: adj })).rejects.toMatchObject({ status: 502 });
    expect(falla.llamadas.map((l) => `${l.init.method} ${l.url}`)).toEqual([`POST ${BASE}/messages`, `POST ${BASE}/messages/DRAFT-ID-0002AAAA/attachments`, `DELETE ${BASE}/messages/DRAFT-ID-0002AAAA`]);
    expect(db.auditar).toHaveBeenCalledTimes(1);
  });

  it('buzón ajeno: un usuario de una empresa sin el módulo habilitado → 403; un buzón inexistente en Graph → 404', async () => {
    const { f, llamadas } = graphFalso(() => ({ status: 404 }));
    const otro = { ...yo, email: 'gerencia@otraempresa.com' };
    await expect(enviarNuevo(deps(graphEnv, { fetchFn: f }), otro, base)).rejects.toMatchObject({ status: 403 });
    expect(llamadas).toHaveLength(0);
    await expect(enviarNuevo(deps(graphEnv, { fetchFn: f }), yo, base)).rejects.toMatchObject({ status: 404 });
    expect(llamadas.every((l) => l.url.startsWith(`${BASE}/`))).toBe(true);
  });

  it('el proveedor no sale hacia otro buzón aunque alguien arme la URL a mano', async () => {
    const { f, llamadas } = graphFalso(() => ({ status: 202 }));
    const p = new GraphMailProvider(MB, async () => 'T', f);
    await expect((p as unknown as { call: (u: string, i: RequestInit) => Promise<Response> }).call('https://graph.microsoft.com/v1.0/users/gerencia%40gsslatam.com/sendMail', { method: 'POST' })).rejects.toThrow(/no permitido/);
    expect(llamadas).toHaveLength(0);
  });

  it('sondeo de seguridad: HTML, scripts, manejadores y esquemas peligrosos quedan como texto o se quitan', async () => {
    const malicioso = [
      '<script>alert(document.cookie)</script>',
      '<img src=x onerror="alert(1)">',
      '<iframe src="https://malo.example"></iframe>',
      '[clic](javascript:alert(1)) [datos](data:text/html;base64,PHNjcmlwdD4=)',
      '<a href="javascript:alert(2)">x</a>',
      '| a | b |\n|---|---|\n| <svg onload=alert(3)> | [x](vbscript:msgbox) |',
    ].join('\n\n');
    await enviarNuevo(deps(), yo, { ...base, texto: malicioso });
    const [{ html }] = nuevosSimulados('laura@gsslatam.com');
    // Ninguna etiqueta peligrosa y ninguna etiqueta con manejadores o esquemas peligrosos (lo escrito queda como texto).
    expect(html).not.toMatch(/<(script|img|iframe|svg|object|embed)\b/i);
    for (const tag of html.match(/<[^>]+>/g) ?? []) expect(tag).not.toMatch(/\son\w+=|javascript:|vbscript:|data:/i);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<table');
  });
});

describe('Redactar · tablas pegadas (Markdown)', () => {
  it('«| a | b |» + separador → tabla con bordes; formato en las celdas; barra escapada; texto plano sin el separador', () => {
    const html = markdownAHtml('Resumen:\n\n| Ítem | Valor |\n|---|:---:|\n| **IVA** | 1 \\| 2 |\n| Total |\n\nFin');
    expect(html).toMatch(/^<p>Resumen:<\/p><table [^>]*style="[^"]*border-collapse:collapse/);
    expect(html).toContain('<th');
    expect(html).toContain('<strong>IVA</strong>');
    expect(html).toContain('1 | 2');
    // Una fila corta se completa con celdas vacías (mismo número de columnas que el encabezado).
    expect((html.match(/<td/g) ?? []).length).toBe(4);
    expect(html.endsWith('<p>Fin</p>')).toBe(true);
    expect(markdownATexto('| a | b |\n|---|---|\n| 1 | 2 |')).toBe('| a | b |\n| 1 | 2 |');
    // Sin separador no es tabla (no cambia las respuestas que ya usaban «|»).
    expect(markdownAHtml('a | b')).toBe('<p>a | b</p>');
  });
});

describe('Redactar · pegar tablas (Excel / Word)', () => {
  it('texto con tabuladores (Excel) y filas de una tabla HTML → tabla Markdown; las barras se escapan', () => {
    expect(tsvAMarkdown('Ítem\tValor\r\nIVA\t19%\r\nA|B\t2\r\n')).toBe('| Ítem | Valor |\n| --- | --- |\n| IVA | 19% |\n| A\\|B | 2 |');
    expect(tsvAMarkdown('una sola línea sin tabuladores')).toBeNull();
    expect(filasAMarkdown([['Nombre', 'Cargo'], ['Ana', 'Jurídica'], ['Luis']])).toBe('| Nombre | Cargo |\n| --- | --- |\n| Ana | Jurídica |\n| Luis |  |');
    expect(filasAMarkdown([['sola']])).toBeNull();
    // Ida y vuelta: lo pegado se convierte en una tabla HTML saneada.
    expect(markdownAHtml(tsvAMarkdown('a\tb\n1\t2')!)).toContain('<td');
  });
});

describe('Redactar · asunto', () => {
  it('una sola línea, sin caracteres de control', () => {
    expect(limpiarAsunto('  Hola\r\n\tmundo\u0000 ')).toBe('Hola mundo');
  });
});

describe('Redactar · autocompletado', () => {
  it('directorio: solo GET a la colección /v1.0/users con filtro de miembros activos; búsqueda saneada', () => {
    const u = new URL(urlDirectorio("o'neil", 8));
    expect(u.pathname).toBe('/v1.0/users');
    expect(u.searchParams.get('$filter')).toContain("startswith(displayName,'o''neil')");
    expect(u.searchParams.get('$filter')).toMatch(/^accountEnabled eq true and userType eq 'Member'/);
    expect(u.searchParams.get('$select')).toBe('displayName,mail,userType');
    expect(() => urlDirectorio("a') or (1 eq 1", 8)).toThrow(/inválida/);
    expect(() => urlDirectorio('a', 8)).toThrow();
    expect(esUrlDirectorio(urlDirectorio('ana', 8))).toBe(true);
    for (const malo of [`${BASE}/messages`, 'https://graph.microsoft.com/v1.0/users/otro@x.com', 'https://evil.com/v1.0/users', 'https://graph.microsoft.com/beta/users']) expect(esUrlDirectorio(malo)).toBe(false);
  });

  it('recientes de Enviados (sin la propia dirección) y directorio filtrado al dominio del inquilino, sin invitados', async () => {
    const { f, llamadas } = graphFalso((url) => {
      if (url.startsWith(`${BASE}/mailFolders/sentitems/messages`)) {
        return { body: { value: [{ toRecipients: [{ emailAddress: { name: 'Ana Ruiz', address: 'Ana.Ruiz@gsslatam.com' } }, { emailAddress: { address: 'laura@gsslatam.com' } }], ccRecipients: [{ emailAddress: { name: 'Proveedor', address: 'ventas@proveedor.com' } }] }] } };
      }
      if (url.startsWith('https://graph.microsoft.com/v1.0/users?')) {
        return {
          body: {
            value: [
              { displayName: 'Andrés Gómez', mail: 'andres.gomez@gsslatam.com', userType: 'Member' },
              { displayName: 'Ana Ruiz', mail: 'ana.ruiz@gsslatam.com', userType: 'Member' },
              { displayName: 'Invitado', mail: 'an.invitado@gsslatam.com', userType: 'Guest' },
              { displayName: 'Otra empresa', mail: 'ana@otra.com', userType: 'Member' },
              { displayName: 'Sin correo', mail: null, userType: 'Member' },
            ],
          },
        };
      }
      return { status: 404 };
    });
    const d = deps(graphEnv, { fetchFn: f });
    const r = await sugerirDestinatarios(d, yo, 'an');
    expect(r).toEqual([
      { nombre: 'Ana Ruiz', correo: 'ana.ruiz@gsslatam.com', origen: 'reciente' },
      { nombre: 'Andrés Gómez', correo: 'andres.gomez@gsslatam.com', origen: 'directorio' },
    ]);
    const dir = llamadas.find((l) => l.url.startsWith('https://graph.microsoft.com/v1.0/users?'))!;
    expect((dir.init.headers as Record<string, string>).ConsistencyLevel).toBe('eventual');
    expect(dir.init.method).toBe('GET');
    // Sin texto: solo los recientes, y la segunda consulta sale de la caché (no vuelve a Graph).
    const antes = llamadas.length;
    expect((await sugerirDestinatarios(d, yo, '')).map((x) => x.correo)).toEqual(['ana.ruiz@gsslatam.com', 'ventas@proveedor.com']);
    expect(llamadas.length).toBe(antes);
  });

  it('si el directorio no está autorizado (403), sigue con los recientes', async () => {
    const { f } = graphFalso((url) => (url.includes('/sentitems/') ? { body: { value: [{ toRecipients: [{ emailAddress: { name: 'Ana', address: 'ana@gsslatam.com' } }] }] } } : { status: 403 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await sugerirDestinatarios(deps(graphEnv, { fetchFn: f }), yo, 'an')).toEqual([{ nombre: 'Ana', correo: 'ana@gsslatam.com', origen: 'reciente' }]);
    warn.mockRestore();
  });
});
