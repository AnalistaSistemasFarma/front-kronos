import { beforeEach, describe, expect, it, vi } from 'vitest';

// Acuse automático en el hilo, con la base y Graph simulados (ningún correo real sale).
const db = vi.hoisted(() => {
  const names = [
    'usuariosPorCorreo', 'usuarioDeEmpresa', 'vinculosDeHilos', 'solicitudesDeCorreos',
    'reservarHilo', 'activarHilo', 'liberarHilo', 'vincularExistente', 'vinculoDeHilo', 'correosRegistrados', 'registrarCorreo',
    'marcarSincronizado', 'hilosParaSincronizar', 'auditar', 'reservarAcuse', 'liberarAcuse',
  ] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});
vi.mock('../db', () => db);

import { ACUSE_A_TODOS, ACUSE_PLANTILLAS, claveAcuse, enlaceSolicitud, parseOpcionesAcuse, textoAcuse } from '../acuse';
import { readCorreoConfig } from '../config';
import { limpiarTokensApp } from '../graph';
import { enviadosSimulados, reiniciarBuzonSimulado } from '../mock';
import { notaDesdeRespuesta } from '../rules';
import { crearDesdeFila, destinatariosAcuse, enviarAcuse, mensajeParaAcuse, vincularHilo, type CorreoDeps } from '../service';
import type { AccesoCorreo } from '../db';
import type { MensajeCompleto } from '../types';

const yo: AccesoCorreo = {
  idUser: 'op1',
  nombre: 'Laura Ayala',
  email: 'laura@gsslatam.com',
  empresas: [{ idCompany: 1, companyName: 'GSS' }],
  empresasSolicitud: [{ idCompany: 1, companyName: 'GSS' }],
};
const catalogo = { categorias: [{ id: 5, categoria: 'Jurídica' }], procesos: [{ id: 10, nombre: 'Contratos', idCategoria: 5, categoria: 'Jurídica' }] };
const auditDb = { emailAudit: { findMany: vi.fn(async () => [] as Array<{ created_at: Date }>) } };

function deps(extra: Partial<CorreoDeps> = {}, env: Record<string, string> = { CORREO_MODO: 'mock' }): CorreoDeps {
  return {
    db: auditDb as never,
    cfg: readCorreoConfig(env),
    kronos: {
      catalogoEmpresa: vi.fn(async () => catalogo),
      solicitudVisible: vi.fn(async () => ({ id: 77, asunto: 'Contrato existente', idCompany: 1, estado: 1 })),
      insertarNota: vi.fn(async () => 1),
    },
    crearSolicitud: vi.fn(async () => ({ id_request: 500, processEmail: null, processEmails: [], taskEmails: [] })),
    notificarNueva: vi.fn(),
    subirAdjuntos: vi.fn(async () => ({ subidos: 0, fallidos: [] })),
    dominiosGrupo: ['gsslatam.com', 'onelatampharma.com'],
    appBaseUrl: 'https://synerlink-pruebas.ejemplo.com/',
    ...extra,
  };
}

const fila = {
  conversationId: 'mock-conv-01AAAA',
  mensajeId: 'mock-msg-0001AAAA',
  mensajesIds: ['mock-msg-0001AAAA', 'mock-msg-0002AAAA'],
  idCompany: 1,
  idProcess: 10,
  idSolicitante: 'u-remitente',
  titulo: 'Revisión de contrato',
  descripcion: 'Extracto',
  adjuntosIds: [],
  etiquetar: false,
};
const vinculo = (idRequest: number, conv = 'mock-conv-01AAAA') => ({ id: 3, conversationId: conv, idRequest, asunto: 'Revisión de contrato', creadoEn: '2026-10-15T00:00:00Z', origen: 'CREADA', lastSyncedAt: null });
const ACUSE = { enviar: true, todos: false, confirmarExterno: false };

beforeEach(() => {
  vi.clearAllMocks();
  reiniciarBuzonSimulado();
  limpiarTokensApp();
  db.usuarioDeEmpresa.mockResolvedValue({ id: 'u-remitente', nombre: 'Uno', correo: 'prueba.uno@gsslatam.com', empresas: [1] });
  db.reservarHilo.mockResolvedValue({ idLink: 3 });
  db.vinculoDeHilo.mockResolvedValue(vinculo(500));
  db.reservarAcuse.mockResolvedValue(true);
  db.liberarAcuse.mockResolvedValue(undefined);
  db.auditar.mockResolvedValue(undefined);
  db.vincularExistente.mockResolvedValue(vinculo(77));
});

describe('Correo · plantilla del acuse', () => {
  it('formal (plural, a todos), número, título, enlace del ambiente y firma', () => {
    const t = textoAcuse({ id: 812, titulo: '  Revisión   de contrato ', enlace: enlaceSolicitud('https://synerlink.ejemplo.com/', 812), firma: 'Laura Ayala' });
    expect(t).toBe(
      [
        'Cordial saludo.',
        '',
        'Les informamos que a partir de este hilo de correo se creó la solicitud #812 — Revisión de contrato en SynerLink.',
        '',
        'El seguimiento se hará por SynerLink: https://synerlink.ejemplo.com/process/request-general/view-request?id=812&from=general-requests',
        '',
        'Si necesitan agregar información, respondan a este mismo correo y quedará como nota de la solicitud.',
        '',
        'Quedamos atentos.',
        '',
        'Laura Ayala',
      ].join('\n')
    );
    expect(ACUSE_PLANTILLAS.predeterminada).not.toMatch(/\b(vos|tú|tenés)\b/);
  });

  it('las opciones solo se activan con true explícito (la API sin la casilla no responde sola)', () => {
    expect(parseOpcionesAcuse(undefined)).toEqual({ enviar: false, todos: false, confirmarExterno: false });
    expect(parseOpcionesAcuse({ enviar: 'true', todos: 1 })).toEqual({ enviar: false, todos: false, confirmarExterno: false });
    expect(parseOpcionesAcuse({ enviar: true, todos: true, confirmarExterno: true })).toEqual({ enviar: true, todos: true, confirmarExterno: true });
    expect(claveAcuse(500, 3)).toBe('synerlink-acuse:500:3');
  });

  it('responde al último correo del remitente de origen; «Responder» solo a él, «a todos» sin la persona', () => {
    const m = (id: string, de: string, fecha: string, cc: string[] = []): MensajeCompleto =>
      ({ id, de: { nombre: de, correo: de }, para: [{ nombre: 'yo', correo: 'laura@gsslatam.com' }], cc: cc.map((c) => ({ nombre: c, correo: c })), fecha }) as MensajeCompleto;
    const hilo = [m('a', 'uno@gsslatam.com', '2026-10-14T10:00:00Z'), m('b', 'laura@gsslatam.com', '2026-10-14T11:00:00Z'), m('c', 'uno@gsslatam.com', '2026-10-14T12:00:00Z', ['jefe@gsslatam.com']), m('d', 'otro@gsslatam.com', '2026-10-14T13:00:00Z')];
    expect(mensajeParaAcuse(hilo, 'laura@gsslatam.com')?.id).toBe('c');
    expect(mensajeParaAcuse([hilo[1]], 'laura@gsslatam.com')).toBeNull();
    expect(destinatariosAcuse(hilo[2], 'laura@gsslatam.com', false)).toEqual(['uno@gsslatam.com']);
    expect(destinatariosAcuse(hilo[2], 'laura@gsslatam.com', true)).toEqual(['uno@gsslatam.com', 'jefe@gsslatam.com']);
  });
});

describe('Correo · acuse al crear desde la simulación', () => {
  it('después de crear responde en el MISMO hilo, audita, deja nota y reserva la clave de idempotencia', async () => {
    const d = deps();
    const r = await crearDesdeFila(d, yo, { ...fila, acuse: ACUSE }, '10.0.0.1');
    expect(r).toMatchObject({ ok: true, idRequest: 500, acuse: { estado: 'ENVIADO', idRequest: 500, para: ['prueba.uno@gsslatam.com'] } });
    // El envío ocurre DESPUÉS de crear y activar el vínculo.
    expect(d.crearSolicitud).toHaveBeenCalled();
    expect(db.activarHilo.mock.invocationCallOrder[0]).toBeLessThan(db.reservarAcuse.mock.invocationCallOrder[0]);
    expect(db.reservarAcuse).toHaveBeenCalledWith(expect.anything(), 3, 'synerlink-acuse:500:3');
    const enviados = enviadosSimulados(yo.email);
    expect(enviados).toHaveLength(1);
    // Al correo MÁS RECIENTE del remitente en el hilo, solo a él.
    expect(enviados[0]).toMatchObject({ mensajeId: 'mock-msg-0002AAAA', todos: false });
    expect(enviados[0].texto).toContain('solicitud #500 — Revisión de contrato en SynerLink');
    expect(enviados[0].texto).toContain('https://synerlink-pruebas.ejemplo.com/process/request-general/view-request?id=500&from=general-requests');
    expect(enviados[0].texto.endsWith('Laura Ayala')).toBe(true);
    expect(db.auditar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'ACUSE_HILO', idRequest: 500, conversationId: 'mock-conv-01AAAA', ip: '10.0.0.1' }));
    expect(d.kronos.insertarNota).toHaveBeenCalledWith(500, expect.stringContaining('Respuesta automática (acuse de creación del caso)'), 'op1');
  });

  it('sin la casilla no responde', async () => {
    const r = await crearDesdeFila(deps(), yo, fila, null);
    expect(r.acuse).toBeUndefined();
    expect(enviadosSimulados(yo.email)).toHaveLength(0);
    expect(db.reservarAcuse).not.toHaveBeenCalled();
  });

  it('respeta CORREO_ENVIO_HABILITADO=false: crea la solicitud y no responde', async () => {
    const d = deps({}, { CORREO_MODO: 'mock', CORREO_ENVIO_HABILITADO: 'false' });
    const r = await crearDesdeFila(d, yo, { ...fila, acuse: ACUSE }, null);
    expect(r).toMatchObject({ ok: true, idRequest: 500, acuse: { estado: 'DESHABILITADO' } });
    expect(enviadosSimulados(yo.email)).toHaveLength(0);
    expect(db.reservarAcuse).not.toHaveBeenCalled();
  });

  it('idempotente: si la clave ya está reservada, no envía otra vez', async () => {
    db.reservarAcuse.mockResolvedValue(false);
    const r = await crearDesdeFila(deps(), yo, { ...fila, acuse: ACUSE }, null);
    expect(r.acuse).toMatchObject({ estado: 'YA_ENVIADO' });
    expect(enviadosSimulados(yo.email)).toHaveLength(0);
  });

  it('remitente EXTERNO: no responde sin confirmación explícita; con ella sí', async () => {
    const ext = { ...fila, conversationId: 'mock-conv-03AAAA', mensajeId: 'mock-msg-0004AAAA', mensajesIds: ['mock-msg-0004AAAA'] };
    db.vinculoDeHilo.mockResolvedValue(vinculo(500, 'mock-conv-03AAAA'));
    const r = await crearDesdeFila(deps(), yo, { ...ext, acuse: ACUSE }, null);
    expect(r).toMatchObject({ ok: true, acuse: { estado: 'OMITIDO', codigo: 'EXTERNO_SIN_CONFIRMAR', para: ['asesor@externo-ejemplo.com'] } });
    expect(enviadosSimulados(yo.email)).toHaveLength(0);
    expect(db.reservarAcuse).not.toHaveBeenCalled();
    const ok = await enviarAcuse(deps(), yo, { conversationId: 'mock-conv-03AAAA', todos: false, confirmarExterno: true, ip: null });
    expect(ok).toMatchObject({ estado: 'ENVIADO', para: ['asesor@externo-ejemplo.com'] });
  });

  it('si el envío falla: la solicitud existe, se libera la reserva (para «Reintentar respuesta») y se audita el fallo', async () => {
    const prov = { hilo: vi.fn(), responder: vi.fn(async () => { throw new Error('Graph 503'); }) };
    const { MockMailProvider } = await import('../mock');
    const real = new MockMailProvider(yo.email);
    prov.hilo.mockImplementation((c: string) => real.hilo(c));
    const d = deps({ proveedor: async () => Object.assign(Object.create(real), { responder: prov.responder }) });
    const r = await crearDesdeFila(d, yo, { ...fila, acuse: ACUSE }, null);
    expect(r).toMatchObject({ ok: true, idRequest: 500, acuse: { estado: 'ERROR', mensaje: 'Graph 503' } });
    expect(db.liberarAcuse).toHaveBeenCalledWith(expect.anything(), 3, 'synerlink-acuse:500:3');
    expect(db.auditar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'ACUSE_HILO_FALLIDO', idRequest: 500 }));
    expect(d.kronos.insertarNota).not.toHaveBeenCalled();
    // Reintento: ahora sí sale.
    const again = await enviarAcuse(deps(), yo, { conversationId: 'mock-conv-01AAAA', todos: false, confirmarExterno: false, ip: null });
    expect(again.estado).toBe('ENVIADO');
  });

  it('un hilo sin vínculo activo no se responde (el reintento solo vale para hilos propios vinculados)', async () => {
    db.vinculoDeHilo.mockResolvedValue(null);
    const r = await enviarAcuse(deps(), yo, { conversationId: 'mock-conv-01AAAA', todos: false, confirmarExterno: false, ip: null });
    expect(r).toMatchObject({ estado: 'OMITIDO', codigo: 'SIN_VINCULO' });
    expect(enviadosSimulados(yo.email)).toHaveLength(0);
  });
});

describe('Correo · acuse al vincular', () => {
  it('vincula y responde con el número de la solicitud existente', async () => {
    db.vinculoDeHilo.mockResolvedValue(vinculo(77));
    const r = await vincularHilo(deps(), yo, 'mock-conv-01AAAA', 77, null, { enviar: true, todos: true, confirmarExterno: false });
    expect(r).toMatchObject({ idRequest: 77, acuse: { estado: 'ENVIADO' } });
    const e = enviadosSimulados(yo.email);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ todos: true });
    expect(e[0].texto).toContain('#77 — Contrato existente');
  });
});

describe('Correo · acuse con Microsoft Graph simulado', () => {
  it('createReplyAll del buzón de la SESIÓN → PATCH con la plantilla ENCIMA del historial → send (sin correo real)', async () => {
    const urls: Array<{ url: string; body: string; method: string }> = [];
    const msg = (id: string, de: string, fecha: string) => ({
      id,
      conversationId: 'conv-graph-1AAAA',
      internetMessageId: `<${id}@x>`,
      subject: 'Contrato',
      from: { emailAddress: { name: de, address: de } },
      toRecipients: [{ emailAddress: { name: 'Laura', address: 'laura@gsslatam.com' } }],
      ccRecipients: [],
      receivedDateTime: fecha,
      isRead: true,
      hasAttachments: false,
      bodyPreview: '',
      categories: [],
      body: { contentType: 'html', content: '<p>Hola</p>' },
      attachments: [],
    });
    const f = vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.includes('login.microsoftonline.com')) return new Response(JSON.stringify({ access_token: 'APP', expires_in: 3600 }), { status: 200 });
      urls.push({ url, body: String(init.body ?? ''), method: String(init.method ?? 'GET') });
      if (url.endsWith('/createReplyAll')) {
        return new Response(
          JSON.stringify({ id: 'DRAFT-ACUSE-1AAAA', body: { contentType: 'html', content: '<html><head></head><body><div id="divRplyFwdMsg">De: uno</div><p>Hola</p></body></html>' } }),
          { status: 201 }
        );
      }
      if (url.includes('/DRAFT-ACUSE-1AAAA')) return new Response(null, { status: url.endsWith('/send') ? 202 : 200 });
      if (url.includes('/messages?')) return new Response(JSON.stringify({ value: [msg('graph-msg-1AAAA', 'uno@gsslatam.com', '2026-10-14T10:00:00Z')] }), { status: 200 });
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    });
    const d = deps(
      { fetchFn: f as unknown as typeof fetch },
      {
        CORREO_MODO: 'graph',
        CORREO_INQUILINOS: 'gss',
        CORREO_GSS_TENANT_ID: '3409fd29-f351-4a98-8ef4-d98c8874a836',
        CORREO_GSS_CLIENT_ID: '28c47cc5-342a-4781-909e-d234db1bb993',
        CORREO_GSS_CLIENT_SECRET: 'secreto-de-prueba',
        CORREO_GSS_DOMINIOS: 'gsslatam.com',
      }
    );
    db.vinculoDeHilo.mockResolvedValue(vinculo(900, 'conv-graph-1AAAA'));
    // Como lo manda la interfaz («Informar en el hilo a todos los participantes»): /replyAll.
    const r = await enviarAcuse(d, yo, { conversationId: 'conv-graph-1AAAA', ...ACUSE_A_TODOS, ip: null });
    expect(r).toMatchObject({ estado: 'ENVIADO', idRequest: 900 });
    const base = 'https://graph.microsoft.com/v1.0/users/laura%40gsslatam.com/messages';
    const graph = urls.filter((u) => !u.url.includes('/messages?'));
    expect(graph.map((u) => `${u.method} ${u.url}`)).toEqual([
      `POST ${base}/graph-msg-1AAAA/createReplyAll`,
      `PATCH ${base}/DRAFT-ACUSE-1AAAA`,
      `POST ${base}/DRAFT-ACUSE-1AAAA/send`,
    ]);
    const patch = JSON.parse(graph[1].body) as { body: { contentType: string; content: string } };
    expect(patch.body.contentType).toBe('HTML');
    const html = patch.body.content;
    // La plantilla va dentro de <body>, ANTES del historial citado, que se conserva intacto.
    expect(html.indexOf('Se creó una solicitud a partir de este correo')).toBeGreaterThan(html.indexOf('<body>'));
    expect(html.indexOf('Se creó una solicitud a partir de este correo')).toBeLessThan(html.indexOf('<div id="divRplyFwdMsg">De: uno</div><p>Hola</p>'));
    expect(html).toContain('#900');
    expect(html).toContain('Revisión de contrato');
    expect(html).toContain('href="https://synerlink-pruebas.ejemplo.com/process/request-general/view-request?id=900&amp;from=general-requests"');
    expect(html).not.toContain('<script');
    // Ni /reply ni /replyAll con comment (texto plano): siempre el borrador con HTML.
    expect(urls.some((u) => /\/(reply|replyAll)$/.test(u.url))).toBe(false);
  });
});

describe('Correo · nota del acuse', () => {
  it('distingue la respuesta automática de una manual', () => {
    expect(notaDesdeRespuesta({ operador: 'L', para: ['a@b.c'], texto: 'x', adjuntos: [], todos: false, automatica: true }, 500)).toMatch(/^Respuesta automática/);
    expect(notaDesdeRespuesta({ operador: 'L', para: ['a@b.c'], texto: 'x', adjuntos: [], todos: false }, 500)).toMatch(/^Respuesta enviada/);
  });
});
