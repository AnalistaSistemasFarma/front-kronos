import { beforeEach, describe, expect, it, vi } from 'vitest';

// Rutas del módulo Correo con sesión, base y buzón simulados: sesión obligatoria,
// permiso del módulo, aislamiento por persona (anti-IDOR), límites y cabeceras seguras.

const m = vi.hoisted(() => {
  const names = [
    'getServerSession', 'getCorreoAccess', 'vinculosDeHilos', 'vinculosDeSolicitud', 'buscarUsuariosEmpresa',
    'usuariosPorCorreo', 'usuarioDeEmpresa', 'solicitudesDeCorreos', 'reservarHilo', 'activarHilo', 'liberarHilo', 'vincularExistente', 'vinculoDeHilo',
    'correosRegistrados', 'registrarCorreo', 'marcarSincronizado', 'hilosParaSincronizar', 'auditar', 'correoDeps', 'reservarAcuse', 'liberarAcuse', 'proyectosDeHilos',
  ] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});

vi.mock('next-auth', () => ({ getServerSession: m.getServerSession }));
vi.mock('../../auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('../../../../lib/prisma', () => ({ prisma: { tag: 'prisma' } }));
vi.mock('../../../../lib/correo/runtime', () => ({ correoDeps: m.correoDeps }));
vi.mock('../../../../lib/correo/db', () => {
  const { correoDeps: _c, getServerSession: _g, ...rest } = m;
  return rest;
});

import { readCorreoConfig } from '../../../../lib/correo/config';
import { reiniciarBuzonSimulado } from '../../../../lib/correo/mock';
import * as estado from '../route';
import * as mensajes from '../mensajes/route';
import * as carpetas from '../carpetas/route';
import * as hilo from '../hilo/route';
import * as notas from '../hilo/notas/route';
import * as leido from '../hilo/leido/route';
import * as leidoSel from '../leido/route';
import * as leidoCarpeta from '../leido/carpeta/route';
import * as vincular from '../hilo/vincular/route';
import * as adjunto from '../adjunto/route';
import * as responder from '../responder/route';
import * as simular from '../simular/route';
import * as crear from '../crear/route';
import * as usuarios from '../usuarios/route';
import * as procesos from '../procesos/route';
import * as vinculos from '../vinculos/route';
import * as acuse from '../acuse/route';
import * as eliminar from '../eliminar/route';
import * as deshacer from '../eliminar/deshacer/route';
import * as redactar from '../redactar/route';
import * as destinatarios from '../destinatarios/route';
import { nuevosSimulados } from '../../../../lib/correo/mock';
import { limpiarRecientes } from '../../../../lib/correo/service';
import { codificarCursor, limpiarTokensApp } from '../../../../lib/correo/graph';

const yo = {
  idUser: 'op1',
  nombre: 'Laura',
  email: 'laura@gsslatam.com',
  empresas: [{ idCompany: 1, companyName: 'GSS' }],
  empresasSolicitud: [{ idCompany: 1, companyName: 'GSS' }, { idCompany: 2, companyName: 'OLP' }],
};
let cfgEnv: Record<string, string> = { CORREO_MODO: 'mock' };
let fetchFn: typeof fetch | undefined;
const GRAPH_ENV = {
  CORREO_MODO: 'graph',
  CORREO_INQUILINOS: 'gss',
  CORREO_GSS_TENANT_ID: '3409fd29-f351-4a98-8ef4-d98c8874a836',
  CORREO_GSS_CLIENT_ID: '28c47cc5-342a-4781-909e-d234db1bb993',
  CORREO_GSS_CLIENT_SECRET: 'secreto-de-prueba',
  CORREO_GSS_DOMINIOS: 'gsslatam.com',
};
const BASE = 'https://graph.microsoft.com/v1.0/users/laura%40gsslatam.com';
const kronos = {
  catalogoEmpresa: vi.fn(async () => ({
    categorias: [{ id: 5, categoria: 'Jurídica' }, { id: 6, categoria: 'Tesorería' }],
    procesos: [
      { id: 10, nombre: 'Contratos', idCategoria: 5, categoria: 'Jurídica' },
      { id: 30, nombre: 'Solicitud de Pago', idCategoria: 6, categoria: 'Tesorería' },
    ],
  })),
  solicitudVisible: vi.fn(async () => null),
  solicitudExiste: vi.fn(async () => true),
  insertarNota: vi.fn(async () => 1),
};

let n = 0;
function comoUsuario(acceso: typeof yo | null = yo) {
  // Cada prueba con un usuario distinto: el límite de tasa es por persona.
  const a = acceso ? { ...acceso, idUser: `${acceso.idUser}-${++n}` } : null;
  m.getServerSession.mockResolvedValue({ user: { email: a?.email ?? yo.email } });
  m.getCorreoAccess.mockResolvedValue(a);
  return a;
}
const H = { 'x-forwarded-for': '10.0.0.9' };
const get = (q: string) => new Request(`http://x/api/correo${q}`, { headers: H });
const post = (q: string, body: unknown) => new Request(`http://x/api/correo${q}`, { method: 'POST', body: JSON.stringify(body), headers: { ...H, 'content-type': 'application/json' } });

beforeEach(() => {
  vi.clearAllMocks();
  reiniciarBuzonSimulado();
  cfgEnv = { CORREO_MODO: 'mock' };
  fetchFn = undefined;
  limpiarTokensApp();
  limpiarRecientes();
  m.correoDeps.mockImplementation(() => ({
    fetchFn,
    db: { emailAudit: { findMany: async () => [] } },
    cfg: readCorreoConfig(cfgEnv),
    kronos,
    crearSolicitud: vi.fn(async () => ({ id_request: 900, processEmail: null, processEmails: [], taskEmails: [] })),
    notificarNueva: vi.fn(),
    subirAdjuntos: vi.fn(async () => ({ subidos: 0, fallidos: [] })),
    dominiosGrupo: ['gsslatam.com'],
    secretoFirma: 'secreto-de-firma-de-pruebas-0123456789',
  }));
  m.vinculosDeHilos.mockResolvedValue(new Map([['mock-conv-01AAAA', { idRequest: 321 }]]));
  m.vinculosDeSolicitud.mockResolvedValue([]);
  m.vinculoDeHilo.mockResolvedValue(null);
  m.correosRegistrados.mockResolvedValue(new Set());
  m.usuariosPorCorreo.mockResolvedValue(new Map());
  m.solicitudesDeCorreos.mockResolvedValue(new Map());
  m.proyectosDeHilos.mockResolvedValue(new Map());
});

describe('Correo · rutas: sesión y permiso', () => {
  const llamadas: Array<[string, () => Promise<Response>]> = [
    ['estado', () => estado.GET(get(''))],
    ['carpetas', () => carpetas.GET(get('/carpetas'))],
    ['mensajes', () => mensajes.GET(get('/mensajes'))],
    ['hilo', () => hilo.GET(get('/hilo?id=mock-conv-01AAAA'))],
    ['notas', () => notas.POST(post('/hilo/notas', {}))],
    ['leido', () => leido.POST(post('/hilo/leido', {}))],
    ['leido-seleccion', () => leidoSel.POST(post('/leido', {}))],
    ['leido-carpeta', () => leidoCarpeta.POST(post('/leido/carpeta', {}))],
    ['vincular', () => vincular.POST(post('/hilo/vincular', {}))],
    ['adjunto', () => adjunto.GET(get('/adjunto'))],
    ['simular', () => simular.POST(post('/simular', {}))],
    ['crear', () => crear.POST(post('/crear', {}))],
    ['usuarios', () => usuarios.GET(get('/usuarios?empresa=1'))],
    ['procesos', () => procesos.GET(get('/procesos?empresa=1'))],
    ['vinculos', () => vinculos.GET(get('/vinculos?solicitud=1'))],
    ['acuse', () => acuse.POST(post('/acuse', {}))],
    ['eliminar', () => eliminar.POST(post('/eliminar', {}))],
    ['eliminar-deshacer', () => deshacer.POST(post('/eliminar/deshacer', {}))],
    ['responder', () => responder.POST(new Request('http://x/api/correo/responder', { method: 'POST', body: new FormData(), headers: H }))],
    ['redactar', () => redactar.POST(new Request('http://x/api/correo/redactar', { method: 'POST', body: new FormData(), headers: H }))],
    ['destinatarios', () => destinatarios.GET(get('/destinatarios?q=an'))],
  ];

  it.each(llamadas)('%s: 401 sin sesión', async (_n, call) => {
    m.getServerSession.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it.each(llamadas)('%s: 403 sin el permiso «Correo»', async (_n, call) => {
    comoUsuario(null);
    expect((await call()).status).toBe(403);
  });
});

describe('Correo · rutas: aislamiento por persona (anti-IDOR)', () => {
  it('la bandeja es la del usuario de la sesión: parámetros de otro usuario o buzón se ignoran', async () => {
    const a = comoUsuario()!;
    const r = await mensajes.GET(get('/mensajes?usuario=otro&mailbox=gerencia@gsslatam.com&idUser=victima'));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.mensajes.length).toBeGreaterThan(0);
    expect(body.mensajes.find((x: { conversationId: string }) => x.conversationId === 'mock-conv-01AAAA').solicitud).toBe(321);
    expect(m.vinculosDeHilos).toHaveBeenCalledWith(expect.anything(), a.idUser, expect.any(Array));
    expect(r.headers.get('cache-control')).toContain('no-store');
  });

  it('vínculos de una solicitud: solo los hilos PROPIOS', async () => {
    const a = comoUsuario()!;
    await vinculos.GET(get('/vinculos?solicitud=55&usuario=otro'));
    expect(m.vinculosDeSolicitud).toHaveBeenCalledWith(expect.anything(), a.idUser, 55);
    expect((await vinculos.GET(get('/vinculos?solicitud=abc'))).status).toBe(400);
  });

  it('procesos: el catálogo completo de «Nueva solicitud» en cualquier empresa a la que pertenece', async () => {
    comoUsuario();
    const r = await procesos.GET(get('/procesos?empresa=2'));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.categorias).toHaveLength(2);
    expect(body.procesos.map((p: { id: number }) => p.id)).toEqual([10, 30]);
    expect(kronos.catalogoEmpresa).toHaveBeenLastCalledWith(2);
  });

  it('usuarios y procesos solo de empresas a las que pertenece', async () => {
    comoUsuario();
    expect((await usuarios.GET(get('/usuarios?empresa=3'))).status).toBe(403);
    expect((await procesos.GET(get('/procesos?empresa=3'))).status).toBe(403);
    m.buscarUsuariosEmpresa.mockResolvedValue([{ id: 'u1', nombre: 'Uno', correo: 'uno@gss.com', empresas: [1] }]);
    const r = await usuarios.GET(get('/usuarios?empresa=1&q=un'));
    expect(await r.json()).toEqual({ usuarios: [{ id: 'u1', nombre: 'Uno', correo: 'uno@gss.com' }] });
  });

  it('crear: identidad y buzón salen de la sesión; un idUser/mailbox en el cuerpo no cambia nada', async () => {
    const a = comoUsuario()!;
    m.usuarioDeEmpresa.mockResolvedValue({ id: 'u-rem', nombre: 'Uno', correo: 'prueba.uno@gsslatam.com', empresas: [1] });
    m.reservarHilo.mockResolvedValue({ idLink: 1 });
    const r = await crear.POST(
      post('/crear', {
        conversationId: 'mock-conv-01AAAA', mensajeId: 'mock-msg-0001AAAA', mensajesIds: ['mock-msg-0001AAAA'], idCompany: 1, idProcess: 10,
        idSolicitante: 'u-rem', titulo: 'Contrato', descripcion: 'Texto', adjuntosIds: [], etiquetar: false, idUser: 'victima', mailbox: 'otro@x.com',
      })
    );
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ ok: true, idRequest: 900 });
    expect(m.reservarHilo).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ idUser: a.idUser, mailbox: 'laura@gsslatam.com' }));
  });

  it('hilo: id inválido 400; HTML saneado', async () => {
    comoUsuario();
    expect((await hilo.GET(get('/hilo?id=../../users/x'))).status).toBe(400);
    const r = await hilo.GET(get('/hilo?id=mock-conv-02AAAA'));
    const body = await r.json();
    expect(body.hilo.mensajes[0].html).not.toMatch(/<script/i);
  });

  it('simular: selección y empresa obligatorias, máximo 50', async () => {
    comoUsuario();
    expect((await simular.POST(post('/simular', { mensajesIds: [], empresa: 1 }))).status).toBe(400);
    expect((await simular.POST(post('/simular', { mensajesIds: ['mock-msg-0001AAAA'] }))).status).toBe(400);
    const r = await simular.POST(post('/simular', { mensajesIds: ['mock-msg-0001AAAA'], empresa: 1 }));
    expect(r.status).toBe(200);
    expect((await r.json()).filas).toHaveLength(1);
  });

  it('vincular exige número de solicitud y que participe en ella', async () => {
    comoUsuario();
    expect((await vincular.POST(post('/hilo/vincular', { conversationId: 'mock-conv-01AAAA' }))).status).toBe(400);
    expect((await vincular.POST(post('/hilo/vincular', { conversationId: 'mock-conv-01AAAA', idRequest: 5 }))).status).toBe(404);
  });

  it('acuse («Reintentar respuesta»): hilo inválido 400; hilo ajeno o sin vínculo no envía nada', async () => {
    comoUsuario();
    expect((await acuse.POST(post('/acuse', { conversationId: '../x' }))).status).toBe(400);
    const r = await acuse.POST(post('/acuse', { conversationId: 'mock-conv-01AAAA' }));
    expect(r.status).toBe(200);
    expect((await r.json()).acuse).toMatchObject({ estado: 'OMITIDO', codigo: 'SIN_VINCULO' });
    expect(m.reservarAcuse).not.toHaveBeenCalled();
  });

  it('marcar leído / no leído: solo hilos del buzón propio, valor obligatorio y auditado', async () => {
    comoUsuario();
    expect((await leido.POST(post('/hilo/leido', { conversationId: 'mock-conv-01AAAA' }))).status).toBe(400);
    expect((await leido.POST(post('/hilo/leido', { conversationId: '<x>', leido: true }))).status).toBe(400);
    const r = await leido.POST(post('/hilo/leido', { conversationId: 'mock-conv-01AAAA', leido: true }));
    expect(r.status).toBe(200);
    expect((await r.json()).cambiados).toBeGreaterThanOrEqual(0);
    expect(m.auditar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'MARCAR_LEIDO', conversationId: 'mock-conv-01AAAA', mailbox: 'laura@gsslatam.com' }));
    const n = await leido.POST(post('/hilo/leido', { conversationId: 'mock-conv-01AAAA', leido: false }));
    expect(await n.json()).toEqual({ cambiados: 1 });
    expect(m.auditar).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ accion: 'MARCAR_NO_LEIDO' }));
  });

  it('marcar seleccionados y toda la carpeta (simulado): por lotes, con «restantes» para el avance, auditado', async () => {
    comoUsuario();
    expect((await leidoSel.POST(post('/leido', { mensajesIds: [], leido: true }))).status).toBe(400);
    expect((await leidoSel.POST(post('/leido', { mensajesIds: Array.from({ length: 101 }, (_, i) => `mock-msg-${i}AAAAAA`), leido: true }))).status).toBe(400);
    const sel = await leidoSel.POST(post('/leido', { mensajesIds: ['mock-msg-0001AAAA', 'mock-msg-0001AAAA', 'no-existe-AAAA'], leido: true }));
    expect(await sel.json()).toEqual({ cambiados: 1, fallidos: 1 });
    expect(m.auditar).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ accion: 'MARCAR_LEIDO', detalle: 'Selección: 1 de 2 mensaje(s)' }));
    expect((await leidoCarpeta.POST(post('/leido/carpeta', { carpeta: '<x>', leido: true }))).status).toBe(400);
    const todo = await (await leidoCarpeta.POST(post('/leido/carpeta', { carpeta: null, leido: true }))).json();
    expect(todo.restantes).toBe(0);
    expect(todo.cambiados).toBeGreaterThan(0);
    const otra = await (await leidoCarpeta.POST(post('/leido/carpeta', { carpeta: null, leido: true }))).json();
    expect(otra).toEqual({ cambiados: 0, fallidos: 0, restantes: 0 });
  });

  it('con CORREO_ETIQUETAR_HABILITADO=false (sin escritura en el buzón) leído / no leído responde 403', async () => {
    cfgEnv = { CORREO_MODO: 'mock', CORREO_ETIQUETAR_HABILITADO: 'false' };
    comoUsuario();
    expect((await leido.POST(post('/hilo/leido', { conversationId: 'mock-conv-01AAAA', leido: true }))).status).toBe(403);
    expect((await leidoSel.POST(post('/leido', { mensajesIds: ['mock-msg-0001AAAA'], leido: true }))).status).toBe(403);
    expect((await leidoCarpeta.POST(post('/leido/carpeta', { carpeta: null, leido: true }))).status).toBe(403);
    expect(m.auditar).not.toHaveBeenCalled();
  });

  it('notas de un hilo no vinculado: 404', async () => {
    comoUsuario();
    expect((await notas.POST(post('/hilo/notas', { conversationId: 'mock-conv-01AAAA' }))).status).toBe(404);
  });
});

describe('Correo · rutas: adjuntos, respuesta y límites', () => {
  it('adjunto: vista previa solo para PDF/imagen; lo demás se descarga; siempre nosniff', async () => {
    comoUsuario();
    const ver = await adjunto.GET(get('/adjunto?mensaje=mock-msg-0001AAAA&adjunto=mock-adj-1AAAA&ver=1'));
    expect(ver.status).toBe(200);
    expect(ver.headers.get('content-type')).toBe('application/pdf');
    expect(ver.headers.get('content-disposition')).toMatch(/^inline; filename="soporte-1.pdf"/);
    expect(ver.headers.get('x-content-type-options')).toBe('nosniff');
    const desc = await adjunto.GET(get('/adjunto?mensaje=mock-msg-0001AAAA&adjunto=mock-adj-1AAAA'));
    expect(desc.headers.get('content-type')).toBe('application/octet-stream');
    expect(desc.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect((await adjunto.GET(get('/adjunto?mensaje=mock-msg-0001AAAA&adjunto=nooo'))).status).toBe(400);
  });

  it('responder (multipart) desde el buzón propio; tras 10 envíos por minuto responde 429', async () => {
    comoUsuario();
    const enviar = () => {
      const fd = new FormData();
      fd.set('mensajeId', 'mock-msg-0003AAAA');
      fd.set('texto', 'Recibido');
      fd.append('files', new Blob(['hola'], { type: 'text/plain' }), 'nota.txt');
      return responder.POST(new Request('http://x/api/correo/responder', { method: 'POST', body: fd, headers: H }));
    };
    const r = await enviar();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, notaEnSolicitud: null });
    for (let i = 0; i < 9; i++) await enviar();
    const limitado = await enviar();
    expect(limitado.status).toBe(429);
    expect(limitado.headers.get('retry-after')).toBeTruthy();
  });

  it('estado: empresas y modo (simulado)', async () => {
    comoUsuario();
    const body = await (await estado.GET(get(''))).json();
    expect(body).toMatchObject({ empresas: [{ idCompany: 1 }, { idCompany: 2 }], empresaBuzon: 1, conexion: { modo: 'mock', disponible: true, correo: 'laura@gsslatam.com' } });
    expect(JSON.stringify(body)).not.toMatch(/token/i);
  });
});

describe('Correo · rutas: app de aplicación y buzón de la sesión (anti-IDOR)', () => {
  function graph(handler: (url: string) => { status?: number; body?: unknown }) {
    const urls: string[] = [];
    fetchFn = (async (url: string) => {
      if (url.includes('login.microsoftonline.com')) return new Response(JSON.stringify({ access_token: 'APP', expires_in: 3600 }), { status: 200 });
      urls.push(url);
      const r = handler(url);
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
    }) as unknown as typeof fetch;
    cfgEnv = GRAPH_ENV;
    return urls;
  }

  it('la bandeja se lee SIEMPRE en /users/{correo de la sesión}, aunque pidan otro buzón por parámetro', async () => {
    const urls = graph(() => ({ body: { value: [] } }));
    comoUsuario();
    const r = await mensajes.GET(get('/mensajes?mailbox=gerencia@gsslatam.com&buzon=gerencia@gsslatam.com&upn=x&usuario=y'));
    expect(r.status).toBe(200);
    expect(urls).toHaveLength(1);
    expect(urls[0].startsWith(`${BASE}/mailFolders/inbox/messages?`)).toBe(true);
    expect(urls[0]).not.toContain('gerencia');
    expect(m.auditar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'LEER_BANDEJA', mailbox: 'laura@gsslatam.com' }));
  });

  it('un cursor que apunta a OTRO buzón se rechaza (400) sin llamar a Graph', async () => {
    const urls = graph(() => ({ body: { value: [] } }));
    comoUsuario();
    const ajeno = codificarCursor('https://graph.microsoft.com/v1.0/users/gerencia%40gsslatam.com/messages?$skip=25')!;
    expect((await mensajes.GET(get(`/mensajes?cursor=${ajeno}`))).status).toBe(400);
    expect(urls).toHaveLength(0);
  });

  it('ids de hilo, mensaje o adjunto de otro buzón: 404 consultando el buzón propio', async () => {
    const urls = graph(() => ({ status: 404, body: { error: { code: 'ErrorItemNotFound' } } }));
    comoUsuario();
    expect((await hilo.GET(get('/hilo?id=CONVDEGERENCIA1'))).status).toBe(404);
    expect((await adjunto.GET(get('/adjunto?mensaje=AAMkGERENCIA1&adjunto=ATTGERENCIA1'))).status).toBe(404);
    expect((await leido.POST(post('/hilo/leido', { conversationId: 'CONVDEGERENCIA1', leido: true }))).status).toBe(404);
    const fd = new FormData();
    fd.set('mensajeId', 'AAMkGERENCIA1');
    fd.set('texto', 'x');
    expect((await responder.POST(new Request('http://x/api/correo/responder', { method: 'POST', body: fd, headers: H }))).status).toBe(404);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => u.startsWith(`${BASE}/`))).toBe(true);
  });

  it('marcar leído por Graph $batch: lotes de 20, cada sub-petición en /users/{correo de la sesión}, reintento de 429', async () => {
    const lotes: Array<{ requests: Array<{ id: string; method: string; url: string; body: unknown }> }> = [];
    let limitarUno = true;
    fetchFn = (async (url: string, init?: RequestInit) => {
      if (url.includes('login.microsoftonline.com')) return new Response(JSON.stringify({ access_token: 'APP', expires_in: 3600 }), { status: 200 });
      if (url === 'https://graph.microsoft.com/v1.0/$batch') {
        const b = JSON.parse(String(init?.body));
        lotes.push(b);
        const responses = b.requests.map((r: { id: string }, i: number) => {
          if (limitarUno && i === 0) {
            limitarUno = false;
            return { id: r.id, status: 429, headers: { 'Retry-After': '0' } };
          }
          return { id: r.id, status: 200 };
        });
        return new Response(JSON.stringify({ responses }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
    cfgEnv = GRAPH_ENV;
    comoUsuario();
    const ids = Array.from({ length: 45 }, (_, i) => `AAMkSEL${String(i).padStart(4, '0')}`);
    const r = await leidoSel.POST(post('/leido', { mensajesIds: ids, leido: true, mailbox: 'gerencia@gsslatam.com' }));
    expect(await r.json()).toEqual({ cambiados: 45, fallidos: 0 });
    // 3 lotes (20 + 20 + 5) más el reintento de la sub-petición limitada.
    expect(lotes.map((l) => l.requests.length)).toEqual([20, 1, 20, 5]);
    const subs = lotes.flatMap((l) => l.requests);
    expect(subs.every((q) => q.method === 'PATCH' && q.url.startsWith('/users/laura%40gsslatam.com/messages/AAMkSEL'))).toBe(true);
    expect(subs.every((q) => JSON.stringify(q.body) === '{"isRead":true}')).toBe(true);
    expect(JSON.stringify(lotes)).not.toContain('gerencia');
  }, 15_000);

  it('throttling (2026-10-16): Graph responde 429 y luego 200 → el hilo abre (reintento con Retry-After, sin error)', async () => {
    let n = 0;
    const hiloGraph = { value: [{ id: 'M1AAAAAAAA', conversationId: 'CONV429AAAAA', subject: 'Hola', receivedDateTime: '2026-10-16T16:13:00Z', isRead: true, body: { contentType: 'html', content: '<p>ok</p>' }, attachments: [] }] };
    const urls: string[] = [];
    fetchFn = (async (url: string) => {
      if (url.includes('login.microsoftonline.com')) return new Response(JSON.stringify({ access_token: 'APP', expires_in: 3600 }), { status: 200 });
      urls.push(url);
      if (++n === 1) return new Response('{"error":{"code":"ApplicationThrottled"}}', { status: 429, headers: { 'Retry-After': '1' } });
      return new Response(JSON.stringify(hiloGraph), { status: 200 });
    }) as unknown as typeof fetch;
    cfgEnv = GRAPH_ENV;
    comoUsuario();
    // Dos aperturas simultáneas del mismo hilo (doble clic): una sola cadena de consultas a Graph.
    const [r, r2] = await Promise.all([hilo.GET(get('/hilo?id=CONV429AAAAA')), hilo.GET(get('/hilo?id=CONV429AAAAA'))]);
    expect(r.status).toBe(200);
    expect(r2.status).toBe(200);
    expect((await r.json()).hilo.mensajes).toHaveLength(1);
    expect(urls).toHaveLength(2);
    // Reabrir enseguida: caché corta, sin Graph; «Actualizar» (fresco=1) sí consulta.
    expect((await hilo.GET(get('/hilo?id=CONV429AAAAA'))).status).toBe(200);
    expect(urls).toHaveLength(2);
    expect((await hilo.GET(get('/hilo?id=CONV429AAAAA&fresco=1'))).status).toBe(200);
    expect(urls).toHaveLength(3);
  }, 15_000);

  it('throttling persistente: tras 3 reintentos, 429 con mensaje claro (la vista ofrece «Reintentar»)', async () => {
    const urls: string[] = [];
    fetchFn = (async (url: string) => {
      if (url.includes('login.microsoftonline.com')) return new Response(JSON.stringify({ access_token: 'APP', expires_in: 3600 }), { status: 200 });
      urls.push(url);
      return new Response('{}', { status: 429, headers: { 'Retry-After': '0' } });
    }) as unknown as typeof fetch;
    cfgEnv = GRAPH_ENV;
    comoUsuario();
    const r = await hilo.GET(get('/hilo?id=CONV429BBBBB'));
    expect(r.status).toBe(429);
    expect((await r.json()).error).toMatch(/Microsoft limitó las consultas a su buzón/);
    expect(urls).toHaveLength(4);
  }, 15_000);

  it('usuarios de un inquilino sin app habilitada: «Correo disponible próximamente para su empresa»', async () => {
    graph(() => ({ body: {} }));
    comoUsuario({ ...yo, email: 'ana@onelatampharma.com' });
    const r = await mensajes.GET(get('/mensajes'));
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ code: 'NO_DISPONIBLE', error: 'Correo disponible próximamente para su empresa.' });
    const e = await (await estado.GET(get(''))).json();
    expect(e.conexion).toMatchObject({ disponible: false, correo: 'ana@onelatampharma.com' });
  });

  it('cada lectura queda auditada: carpetas, hilo y adjunto (usuario, acción, mensaje)', async () => {
    comoUsuario();
    await carpetas.GET(get('/carpetas'));
    await hilo.GET(get('/hilo?id=mock-conv-01AAAA'));
    await adjunto.GET(get('/adjunto?mensaje=mock-msg-0001AAAA&adjunto=mock-adj-1AAAA'));
    const acciones = m.auditar.mock.calls.map((c) => c[1]);
    expect(acciones).toEqual([
      expect.objectContaining({ accion: 'LEER_CARPETAS', mailbox: 'laura@gsslatam.com' }),
      expect.objectContaining({ accion: 'LEER_HILO', conversationId: 'mock-conv-01AAAA', mensajeId: 'mock-msg-0001AAAA' }),
      expect.objectContaining({ accion: 'DESCARGAR_ADJUNTO', mensajeId: 'mock-msg-0001AAAA', ip: '10.0.0.9' }),
    ]);
  });
});

describe('Correo · rutas: eliminar (deslizar) y «Deshacer»', () => {
  const enBandeja = async () => ((await (await mensajes.GET(get('/mensajes'))).json()).mensajes as Array<{ id: string }>).map((x) => x.id);

  it('mueve a Elementos eliminados del buzón de la SESIÓN (un buzón en el cuerpo se ignora) y «Deshacer» lo restaura', async () => {
    const a = comoUsuario()!;
    m.vinculosDeHilos.mockResolvedValue(new Map());
    const r = await eliminar.POST(post('/eliminar', { mensajesIds: ['mock-msg-0003AAAA'], mailbox: 'gerencia@gsslatam.com', idUser: 'victima' }));
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toContain('no-store');
    const body = await r.json();
    expect(body).toMatchObject({ eliminados: [{ id: 'mock-msg-0003AAAA', nuevoId: 'mock-msg-0003AAAA-ELIM' }], fallidos: [], yaEnEliminados: [] });
    expect(body.requiereConfirmacion).toBeUndefined();
    expect(await enBandeja()).not.toContain('mock-msg-0003AAAA');
    expect(m.auditar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'ELIMINAR', idUser: a.idUser, mailbox: 'laura@gsslatam.com', ip: '10.0.0.9' }));
    const u = await deshacer.POST(post('/eliminar/deshacer', { deshacer: body.deshacer }));
    expect(u.status).toBe(200);
    expect(await u.json()).toEqual({ restaurados: [{ id: 'mock-msg-0003AAAA-ELIM', nuevoId: 'mock-msg-0003AAAA' }], fallidos: [] });
    expect(await enBandeja()).toContain('mock-msg-0003AAAA');
    expect(m.auditar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'RESTAURAR', idUser: a.idUser }));
  });

  it('el «Deshacer» de otra persona: 403; sin comprobante: 400', async () => {
    comoUsuario();
    m.vinculosDeHilos.mockResolvedValue(new Map());
    const body = await (await eliminar.POST(post('/eliminar', { mensajesIds: ['mock-msg-0004AAAA'] }))).json();
    comoUsuario();
    expect((await deshacer.POST(post('/eliminar/deshacer', { deshacer: body.deshacer }))).status).toBe(403);
    expect((await deshacer.POST(post('/eliminar/deshacer', {}))).status).toBe(400);
  });

  it('hilo vinculado: 409 VINCULADO con el detalle; con confirmarVinculados, elimina', async () => {
    comoUsuario();
    m.proyectosDeHilos.mockResolvedValue(new Map([['mock-conv-01AAAA', ['Proyecto X']]]));
    const r = await eliminar.POST(post('/eliminar', { mensajesIds: ['mock-msg-0001AAAA'] }));
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: 'VINCULADO', vinculos: [{ mensajeId: 'mock-msg-0001AAAA', idRequest: 321, proyectos: ['Proyecto X'] }] });
    const ok = await eliminar.POST(post('/eliminar', { mensajesIds: ['mock-msg-0001AAAA'], confirmarVinculados: true }));
    expect(ok.status).toBe(200);
    expect(m.proyectosDeHilos).toHaveBeenCalledWith(expect.anything(), 'laura@gsslatam.com', expect.any(Array));
  });

  it('cuerpo inválido 400; escritura apagada 403', async () => {
    comoUsuario();
    expect((await eliminar.POST(post('/eliminar', { mensajesIds: 'x' }))).status).toBe(400);
    cfgEnv = { CORREO_MODO: 'mock', CORREO_ELIMINAR_HABILITADO: 'false' };
    expect((await eliminar.POST(post('/eliminar', { mensajesIds: ['mock-msg-0003AAAA'] }))).status).toBe(403);
    expect((await estado.GET(get(''))).status).toBe(200);
    expect((await (await estado.GET(get(''))).json()).conexion.eliminarHabilitado).toBe(false);
  });

  it('Graph: un id de OTRO buzón responde 404 consultando el buzón propio y no se hace ningún `move`', async () => {
    const subs: Array<{ method: string; url: string }> = [];
    fetchFn = (async (url: string, init?: RequestInit) => {
      if (url.includes('login.microsoftonline.com')) return new Response(JSON.stringify({ access_token: 'APP', expires_in: 3600 }), { status: 200 });
      if (url === `${BASE}/mailFolders/deleteditems?$select=id`) return new Response(JSON.stringify({ id: 'FOLDERDELETED1' }), { status: 200 });
      if (url === 'https://graph.microsoft.com/v1.0/$batch') {
        const reqs = JSON.parse(String(init?.body)).requests as Array<{ id: string; method: string; url: string }>;
        subs.push(...reqs);
        return new Response(JSON.stringify({ responses: reqs.map((q) => ({ id: q.id, status: 404 })) }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
    cfgEnv = GRAPH_ENV;
    comoUsuario();
    const r = await eliminar.POST(post('/eliminar', { mensajesIds: ['AAMkGERENCIA1'], mailbox: 'gerencia@gsslatam.com' }));
    expect(r.status).toBe(404);
    expect(subs).toEqual([expect.objectContaining({ method: 'GET', url: expect.stringMatching(/^\/users\/laura%40gsslatam\.com\/messages\/AAMkGERENCIA1\?/) })]);
    expect(JSON.stringify(subs)).not.toContain('gerencia');
  });
});

describe('Correo · Redactar (correo nuevo, 2026-10-19)', () => {
  const formulario = (campos: Record<string, string>, archivos: Array<[string, string]> = []) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(campos)) fd.set(k, v);
    for (const [nombre, txt] of archivos) fd.append('files', new Blob([txt], { type: 'text/plain' }), nombre);
    return redactar.POST(new Request('http://x/api/correo/redactar', { method: 'POST', body: fd, headers: H }));
  };

  it('envía desde el buzón de la SESIÓN: remitente, buzón o usuario del formulario se ignoran', async () => {
    cfgEnv = GRAPH_ENV;
    const llamadas: string[] = [];
    fetchFn = (async (url: string) => {
      if (String(url).includes('login.microsoftonline.com')) return new Response(JSON.stringify({ access_token: 'APP', expires_in: 3600 }));
      llamadas.push(String(url));
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;
    const a = comoUsuario()!;
    const r = await formulario({ para: JSON.stringify(['ana@gsslatam.com']), asunto: 'Hola', texto: 'Buen día', de: 'gerencia@gsslatam.com', mailbox: 'gerencia@gsslatam.com', usuario: 'victima', from: 'gerencia@gsslatam.com' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, destinatarios: 1 });
    expect(llamadas).toEqual([`${BASE}/sendMail`]);
    expect(m.auditar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ idUser: a.idUser, accion: 'ENVIAR_NUEVO', mailbox: 'laura@gsslatam.com' }));
    expect(r.headers.get('cache-control')).toContain('no-store');
  });

  it('bandera CORREO_ENVIO_HABILITADO=false → 403; destinatario inválido → 400 (simulado)', async () => {
    cfgEnv = { CORREO_MODO: 'mock', CORREO_ENVIO_HABILITADO: 'false' };
    comoUsuario();
    const r = await formulario({ para: JSON.stringify(['ana@gsslatam.com']), asunto: 'Hola', texto: 'x' });
    expect(r.status).toBe(403);
    expect(nuevosSimulados('laura@gsslatam.com')).toHaveLength(0);
    cfgEnv = { CORREO_MODO: 'mock' };
    comoUsuario();
    const malo = await formulario({ para: JSON.stringify(['no es correo']), asunto: 'Hola', texto: 'x' });
    expect(malo.status).toBe(400);
    expect((await malo.json()).code).toBe('DESTINATARIOS');
    const roto = await formulario({ para: '{no-json', asunto: 'Hola', texto: 'x' });
    expect(roto.status).toBe(400);
  });

  it('con adjuntos en el buzón simulado: queda en Enviados; comparte la cuota de envío (10 por minuto)', async () => {
    comoUsuario();
    const ok = await formulario({ para: JSON.stringify(['ana@gsslatam.com']), cco: JSON.stringify(['archivo@gsslatam.com']), asunto: 'Acta', texto: '**Adjunto**' }, [['acta.txt', 'hola']]);
    expect(ok.status).toBe(200);
    expect(nuevosSimulados('laura@gsslatam.com')).toEqual([
      { asunto: 'Acta', html: '<p><strong>Adjunto</strong></p>', para: ['ana@gsslatam.com'], cc: [], cco: ['archivo@gsslatam.com'], adjuntos: ['acta.txt'] },
    ]);
    for (let i = 0; i < 9; i++) await formulario({ para: JSON.stringify(['ana@gsslatam.com']), asunto: `n${i}`, texto: 'x' });
    expect((await formulario({ para: JSON.stringify(['ana@gsslatam.com']), asunto: 'once', texto: 'x' })).status).toBe(429);
  });

  it('destinatarios: recientes y directorio simulado; parámetros de otro buzón se ignoran', async () => {
    comoUsuario();
    const r = await destinatarios.GET(get('/destinatarios?q=prueba&mailbox=gerencia@gsslatam.com'));
    expect(r.status).toBe(200);
    const { destinatarios: lista } = await r.json();
    expect(lista.length).toBeGreaterThan(0);
    for (const x of lista) expect(x.correo).not.toBe('laura@gsslatam.com');
    expect(lista.map((x: { origen: string }) => x.origen)).toContain('reciente');
  });
});
