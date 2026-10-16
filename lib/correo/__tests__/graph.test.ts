import { describe, expect, it, vi } from 'vitest';
import { assertGraphId, codificarCursor, GraphMailProvider, limpiarTokensApp, mailboxForSession, textoAHtml, tokenApp, urlBandeja, urlDelBuzon, validarCursor } from '../graph';

const MB = mailboxForSession('Laura@GSSLATAM.com');
const BASE = 'https://graph.microsoft.com/v1.0/users/laura%40gsslatam.com';
const tok = async () => 'TOKEN';

const ID = 'AAMkAGI2THVSAAA=';

function fakeFetch(handler: (url: string, init: RequestInit) => { status?: number; body?: unknown; headers?: Record<string, string>; raw?: Buffer }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const r = handler(url, init);
    if (r.raw) return new Response(new Uint8Array(r.raw), { status: r.status ?? 200, headers: r.headers });
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers });
  });
  return { f: f as unknown as typeof fetch, calls };
}

describe('Correo · consultas a Graph', () => {
  it('bandeja: filtros OData con fecha primero (requisito de $orderby); un remitente con comillas no entra al filtro', () => {
    expect(new URL(urlBandeja(MB, { de: "o'neil@ejemplo.com' or 1 eq 1" })).searchParams.get('$filter')).not.toContain('from');
    const u = new URL(urlBandeja(MB, { desde: '2026-10-01', hasta: '2026-10-15', de: 'Ana.Perez@Ejemplo.com', noLeidos: true, conAdjuntos: true }));
    expect(u.pathname).toBe('/v1.0/users/laura%40gsslatam.com/mailFolders/inbox/messages');
    const f = u.searchParams.get('$filter')!;
    expect(f.startsWith('receivedDateTime ge 2026-10-01T00:00:00Z')).toBe(true);
    expect(f).toContain("from/emailAddress/address eq 'ana.perez@ejemplo.com'");
    expect(f).toContain('isRead eq false');
    expect(f).toContain('hasAttachments eq true');
    expect(u.searchParams.get('$orderby')).toBe('receivedDateTime desc');
    expect(u.searchParams.get('$top')).toBe('25');
  });

  it('bandeja con búsqueda: KQL en $search sin $filter, comillas del usuario neutralizadas', () => {
    const u = new URL(urlBandeja(MB, { buscar: 'contrato "x" OR', de: 'a@b.com', conAdjuntos: true, carpetaId: ID }));
    expect(u.pathname).toBe(`/v1.0/users/laura%40gsslatam.com/mailFolders/${encodeURIComponent(ID)}/messages`);
    expect(u.searchParams.get('$filter')).toBeNull();
    expect(u.searchParams.get('$search')).toBe('"contrato x OR from:a@b.com hasattachments:true"');
  });

  it('ignora filtros mal formados', () => {
    const u = new URL(urlBandeja(MB, { desde: '2026/10/01', de: 'no-es-correo' }));
    expect(u.searchParams.get('$filter')).toBe('receivedDateTime ge 1900-01-01T00:00:00Z');
    expect(() => urlBandeja(MB, { carpetaId: '../users/otro' })).toThrow(/carpeta/);
  });

  it('el cursor solo puede ser un nextLink del buzón DE LA SESIÓN en graph.microsoft.com (anti-IDOR y anti-SSRF)', () => {
    for (const ok of [`${BASE}/messages?$skip=25`, 'https://graph.microsoft.com/v1.0/users/laura@gsslatam.com/mailFolders/inbox/messages?$skip=50']) {
      expect(validarCursor(codificarCursor(ok)!, MB)).toBe(new URL(ok).toString());
    }
    for (const malo of [
      'https://graph.microsoft.com/v1.0/users/gerencia%40gsslatam.com/messages',
      'https://graph.microsoft.com/v1.0/users/laura%40gsslatam.com.evil/messages',
      'https://graph.microsoft.com/v1.0/users/laura%40gsslatam.com/../gerencia%40gsslatam.com/messages',
      'https://graph.microsoft.com/v1.0/users/laura%40gsslatam.com%2F..%2Fgerencia%40gsslatam.com/messages',
      'https://graph.microsoft.com/v1.0/users/laura%40gsslatam.com/%2e%2e/gerencia/messages',
      'https://graph.microsoft.com/v1.0/me/messages',
      'https://graph.microsoft.com/v1.0/users/laura%40gsslatam.com%5c..%5cotro/messages',
      'https://evil.com/v1.0/users/laura%40gsslatam.com/messages',
      'http://graph.microsoft.com/v1.0/users/laura%40gsslatam.com/messages',
      'https://graph.microsoft.com:8443/v1.0/users/laura%40gsslatam.com/messages',
      'https://x@graph.microsoft.com/v1.0/users/laura%40gsslatam.com/messages',
      'no-es-url',
    ]) {
      expect(() => validarCursor(codificarCursor(malo)!, MB), malo).toThrow(/Cursor/);
    }
    expect(codificarCursor(undefined)).toBeNull();
  });

  it('mailboxForSession: único constructor de /users/{correo}; valida el correo de la sesión', () => {
    expect(MB).toMatchObject({ correo: 'laura@gsslatam.com', base: BASE });
    for (const x of ['', 'sin-arroba', 'a@b', 'laura@gsslatam.com/../otro@x.com', 'a b@x.com', "o'neil@x.com", 'x@y.com?$filter=1']) {
      expect(() => mailboxForSession(x), x).toThrow();
    }
    expect(urlDelBuzon(BASE, MB)).toBe(true);
    expect(urlDelBuzon(`${BASE}?$select=x`, MB)).toBe(true);
    expect(() => new GraphMailProvider({ correo: 'otro@x.com', base: 'https://graph.microsoft.com/v1.0/users/otro@x.com' } as never, tok)).toThrow(/no permitido/);
  });

  it('ids de Graph válidos; rutas o inyecciones se rechazan', () => {
    expect(assertGraphId(ID)).toBe(ID);
    for (const x of ['', 'corto', '../../users/x', "a' or 1 eq 1", 'a'.repeat(600)]) expect(() => assertGraphId(x)).toThrow();
  });

  it('textoAHtml escapa y conserva saltos', () => {
    expect(textoAHtml('<b>hola</b>\nmundo')).toBe('&lt;b&gt;hola&lt;/b&gt;<br>mundo');
  });
});

describe('Correo · GraphMailProvider (siempre el buzón de la sesión)', () => {
  it('lista mensajes con el token Bearer y devuelve el cursor', async () => {
    const { f, calls } = fakeFetch(() => ({
      body: {
        value: [{ id: ID, conversationId: 'C1AAAAAAAA', internetMessageId: '<a@b>', subject: 'Hola', from: { emailAddress: { name: 'A', address: 'A@B.COM' } }, receivedDateTime: '2026-10-15T10:00:00Z', isRead: false, hasAttachments: true, bodyPreview: 'x', categories: ['c'] }],
        '@odata.nextLink': `${BASE}/mailFolders/inbox/messages?$skip=25`,
      },
    }));
    const p = new GraphMailProvider(MB, tok, f);
    const r = await p.mensajes({});
    expect(r.mensajes[0]).toMatchObject({ id: ID, de: { correo: 'a@b.com' }, leido: false, conAdjuntos: true });
    expect(r.siguiente).not.toBeNull();
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN');
    await p.mensajes({}, r.siguiente);
    expect(calls[1].url).toContain('$skip=25');
  });

  it('hilo: filtra por conversationId, ordena del más antiguo y pasa las imágenes cid a data:', async () => {
    const { f, calls } = fakeFetch((url) => {
      if (url.includes('/attachments')) {
        return { body: { value: [
          { id: 'ATT1AAAAAA', name: 'logo.png', contentType: 'image/png', size: 3, isInline: true, contentId: '<img1>', contentBytes: 'AAAA' },
          { id: 'ATT2AAAAAA', name: 'a.pdf', contentType: 'application/pdf', size: 10, isInline: false, contentBytes: 'BBBB' },
        ] } };
      }
      return { body: { value: [
        { id: 'M2AAAAAAAA', conversationId: 'C1AAAAAAAA', subject: 'RE', receivedDateTime: '2026-10-15T10:00:00Z', body: { contentType: 'text', content: 'b<c' } },
        { id: 'M1AAAAAAAA', conversationId: 'C1AAAAAAAA', subject: 'Hola', receivedDateTime: '2026-10-14T10:00:00Z', hasAttachments: true, body: { contentType: 'html', content: '<img src="cid:img1">' } },
      ] } };
    });
    const hilo = await new GraphMailProvider(MB, tok, f).hilo('C1AAAAAAAA');
    expect(hilo.map((m) => m.id)).toEqual(['M1AAAAAAAA', 'M2AAAAAAAA']);
    expect(hilo[0].imagenesCid).toEqual({ img1: 'data:image/png;base64,AAAA' });
    expect(hilo[0].adjuntos.map((a) => a.id)).toEqual(['ATT2AAAAAA']);
    expect(hilo[1].html).toBe('<p>b&lt;c</p>');
    expect(new URL(calls[0].url).searchParams.get('$filter')).toBe("conversationId eq 'C1AAAAAAAA'");
    expect((calls[0].init.headers as Record<string, string>).Prefer).toContain('html');
    expect(calls.every((c) => c.url.startsWith(`${BASE}/`))).toBe(true);
  });

  it('responder sin adjuntos usa /reply o /replyAll; con adjuntos: borrador → adjuntos → enviar', async () => {
    const { f, calls } = fakeFetch((url) => (url.endsWith('/createReplyAll') ? { body: { id: 'DRAFTAAAAA' } } : { status: 202 }));
    const p = new GraphMailProvider(MB, tok, f);
    await p.responder(ID, { texto: 'ok <b>', todos: false, adjuntos: [] });
    expect(calls[0].url).toBe(`${BASE}/messages/${encodeURIComponent(ID)}/reply`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ comment: 'ok &lt;b&gt;' });
    calls.length = 0;
    // Con el HTML ya saneado del Markdown, ese es el comentario (mismo flujo de envío).
    await p.responder(ID, { texto: 'ok negrita', comentarioHtml: '<p>ok <strong>negrita</strong></p>', todos: false, adjuntos: [] });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ comment: '<p>ok <strong>negrita</strong></p>' });
    calls.length = 0;
    await p.responder(ID, { texto: 'va', todos: true, adjuntos: [{ nombre: 'a.txt', tipo: 'text/plain', bytes: Buffer.from('hola') }] });
    expect(calls.map((c) => c.url.replace(`${BASE}/messages/`, ''))).toEqual([
      `${encodeURIComponent(ID)}/createReplyAll`,
      'DRAFTAAAAA/attachments',
      'DRAFTAAAAA/send',
    ]);
    expect(JSON.parse(String(calls[1].init.body))).toMatchObject({ name: 'a.txt', contentBytes: Buffer.from('hola').toString('base64') });
  });

  it('con html: createReply → (lee el cuerpo si no vino) → PATCH con el bloque encima del historial → send; si falla, borra el borrador', async () => {
    const { f, calls } = fakeFetch((url, init) => {
      if (url.endsWith('/createReply')) return { status: 201, body: { id: 'DRAFTHTMLAA' } };
      if (url.includes('$select=body')) return { body: { body: { contentType: 'html', content: '<html><body><p>citado</p></body></html>' } } };
      if (init.method === 'PATCH') return { status: 200, body: {} };
      return { status: 202 };
    });
    const p = new GraphMailProvider(MB, tok, f);
    await p.responder(ID, { texto: 'plano', html: '<div>ACUSE</div>', todos: false, adjuntos: [] });
    expect(calls.map((c) => `${c.init.method ?? 'GET'} ${c.url.replace(`${BASE}/messages/`, '')}`)).toEqual([
      `POST ${encodeURIComponent(ID)}/createReply`,
      'GET DRAFTHTMLAA?$select=body',
      'PATCH DRAFTHTMLAA',
      'POST DRAFTHTMLAA/send',
    ]);
    expect((calls[0].init.headers as Record<string, string>).Prefer).toContain('html');
    const content = JSON.parse(String(calls[2].init.body)).body.content as string;
    expect(content).toMatch(/^<html><body>\n<div>ACUSE<\/div>[\s\S]*<p>citado<\/p><\/body><\/html>$/);

    const { f: f2, calls: c2 } = fakeFetch((url, init) => {
      if (url.endsWith('/createReplyAll')) return { status: 201, body: { id: 'DRAFTHTMLBB', body: { contentType: 'html', content: '<body></body>' } } };
      if (init.method === 'PATCH') return { status: 500, body: {} };
      return { status: 204 };
    });
    await expect(new GraphMailProvider(MB, tok, f2).responder(ID, { texto: 'x', html: '<div>A</div>', todos: true, adjuntos: [] })).rejects.toBeTruthy();
    expect(c2.map((c) => `${c.init.method ?? 'GET'} ${c.url.replace(`${BASE}/messages/`, '')}`)).toEqual([
      `POST ${encodeURIComponent(ID)}/createReplyAll`,
      'PATCH DRAFTHTMLBB',
      'DELETE DRAFTHTMLBB',
    ]);
  });

  it('categorizar agrega «SynerLink #N» sin borrar las categorías existentes ni repetir', async () => {
    const { f, calls } = fakeFetch((url, init) => (init.method === 'PATCH' ? { status: 200, body: {} } : { body: { categories: ['Rojo'] } }));
    await new GraphMailProvider(MB, tok, f).categorizar(ID, 'SynerLink #7');
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ categories: ['Rojo', 'SynerLink #7'] });
    const { f: f2, calls: c2 } = fakeFetch(() => ({ body: { categories: ['SynerLink #7'] } }));
    await new GraphMailProvider(MB, tok, f2).categorizar(ID, 'SynerLink #7');
    expect(c2).toHaveLength(1);
  });

  it('adjunto: solo archivos; devuelve los bytes', async () => {
    const { f } = fakeFetch((url) => (url.endsWith('/$value') ? { raw: Buffer.from('PDF') } : { body: { name: 'a.pdf', contentType: 'application/pdf', '@odata.type': '#microsoft.graph.fileAttachment' } }));
    const a = await new GraphMailProvider(MB, tok, f).adjunto(ID, 'ATT2AAAAAA');
    expect(a.bytes.toString()).toBe('PDF');
    const { f: f2 } = fakeFetch(() => ({ body: { name: 'x', '@odata.type': '#microsoft.graph.itemAttachment' } }));
    await expect(new GraphMailProvider(MB, tok, f2).adjunto(ID, 'ATT2AAAAAA')).rejects.toMatchObject({ status: 415 });
  });

  it('traduce los errores de Graph (401 autenticación de la app, 403 permiso, 404, 429 con espera)', async () => {
    const casos: Array<[number, object]> = [
      [401, { status: 502 }],
      [403, { status: 403 }],
      [404, { status: 404 }],
      [429, { status: 429 }],
      [500, { status: 502 }],
    ];
    for (const [status, esperado] of casos) {
      const { f } = fakeFetch(() => ({ status, body: {}, headers: { 'retry-after': '7' } }));
      await expect(new GraphMailProvider(MB, tok, f).carpetas()).rejects.toMatchObject(esperado);
    }
    const { f } = fakeFetch(() => ({ status: 429, body: {}, headers: { 'retry-after': '7' } }));
    await expect(new GraphMailProvider(MB, tok, f).carpetas()).rejects.toThrow(/7 s/);
  });

  it('perfil: el buzón de la sesión, sin llamar a Graph', async () => {
    const { f, calls } = fakeFetch(() => ({ body: {} }));
    expect(await new GraphMailProvider(MB, tok, f).perfil()).toEqual({ correo: 'laura@gsslatam.com' });
    expect(calls).toHaveLength(0);
  });

  it('ids manipulados nunca salen del buzón de la sesión (un id ajeno solo da 404 dentro de SU buzón)', async () => {
    const { f, calls } = fakeFetch(() => ({ status: 404, body: {} }));
    const p = new GraphMailProvider(MB, tok, f);
    await expect(p.mensaje('AAMkOTROBUZON==')).rejects.toMatchObject({ status: 404 });
    await expect(p.adjunto('AAMkOTROBUZON==', 'ATTOTRO1234')).rejects.toMatchObject({ status: 404 });
    await expect(p.hilo('CONVOTRA1234')).rejects.toMatchObject({ status: 404 });
    for (const malo of ['../../gerencia@gsslatam.com', 'x/../../users/otro', '%2e%2e%2fotro']) {
      await expect(p.mensaje(malo)).rejects.toMatchObject({ status: 400 });
    }
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.url.startsWith(`${BASE}/`))).toBe(true);
  });
});

describe('Correo · token de aplicación (solo en memoria del servidor)', () => {
  const inq = { clave: 'gss', tenantId: '3409fd29-f351-4a98-8ef4-d98c8874a836', clientId: '28c47cc5-342a-4781-909e-d234db1bb993', clientSecret: 'secreto', dominios: ['gsslatam.com'] };

  it('client credentials; se reutiliza hasta 5 minutos antes de vencer', async () => {
    limpiarTokensApp();
    const f = vi.fn(async () => new Response(JSON.stringify({ access_token: 'APP', expires_in: 3600 }), { status: 200 }));
    expect(await tokenApp(inq, f as unknown as typeof fetch, 0)).toBe('APP');
    expect(await tokenApp(inq, f as unknown as typeof fetch, 1000)).toBe('APP');
    expect(f).toHaveBeenCalledTimes(1);
    const body = new URLSearchParams(String(((f.mock.calls[0] as unknown[])[1] as RequestInit).body));
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('scope')).toBe('https://graph.microsoft.com/.default');
    await tokenApp(inq, f as unknown as typeof fetch, 3600_000 - 60_000);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('error de Microsoft: mensaje sin detalles ni secreto, y no queda en caché', async () => {
    limpiarTokensApp();
    const f = vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_client', error_description: 'secreto vencido' }), { status: 401 }));
    const e = await tokenApp(inq, f as unknown as typeof fetch, 0).catch((x) => x);
    expect(e.message).toContain('invalid_client');
    expect(e.message).not.toMatch(/secreto/);
    const ok = vi.fn(async () => new Response(JSON.stringify({ access_token: 'APP2' }), { status: 200 }));
    expect(await tokenApp(inq, ok as unknown as typeof fetch, 0)).toBe('APP2');
  });
});
