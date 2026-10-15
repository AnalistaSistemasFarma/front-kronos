import { beforeEach, describe, expect, it, vi } from 'vitest';

// Servicio del módulo Correo con la base y Graph simulados.
const db = vi.hoisted(() => {
  const names = [
    'usuariosPorCorreo', 'usuarioDeEmpresa', 'vinculosDeHilos', 'solicitudesDeCorreos',
    'reservarHilo', 'activarHilo', 'liberarHilo', 'vincularExistente', 'vinculoDeHilo', 'correosRegistrados', 'registrarCorreo',
    'marcarSincronizado', 'hilosParaSincronizar', 'auditar',
  ] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});
vi.mock('../db', () => db);

import { readCorreoConfig } from '../config';
import { limpiarTokensApp } from '../graph';
import { CorreoError } from '../errors';
import { MockMailProvider, enviadosSimulados, reiniciarBuzonSimulado } from '../mock';
import {
  auditarLectura,
  crearDesdeFila,
  estadoConexion,
  proveedorDe,
  responder,
  simular,
  sincronizarHilo,
  sincronizarTodo,
  verHilo,
  vincularHilo,
  type CorreoDeps,
} from '../service';
import type { AccesoCorreo } from '../db';

const graphEnv = {
  CORREO_MODO: 'graph',
  CORREO_INQUILINOS: 'gss',
  CORREO_GSS_TENANT_ID: '3409fd29-f351-4a98-8ef4-d98c8874a836',
  CORREO_GSS_CLIENT_ID: '28c47cc5-342a-4781-909e-d234db1bb993',
  CORREO_GSS_CLIENT_SECRET: 'secreto-de-prueba',
  CORREO_GSS_DOMINIOS: 'gsslatam.com',
};
const BASE = 'https://graph.microsoft.com/v1.0/users/laura%40gsslatam.com';

/** Graph simulado: token de app + respuestas por URL; registra cada URL pedida. */
function graphFalso(handler: (url: string, init: RequestInit) => { status?: number; body?: unknown }) {
  const urls: string[] = [];
  const f = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url.includes('login.microsoftonline.com')) return new Response(JSON.stringify({ access_token: 'APP', expires_in: 3600 }), { status: 200 });
    urls.push(url);
    const r = handler(url, init);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status ?? 200 });
  });
  return { f: f as unknown as typeof fetch, urls };
}

const yo: AccesoCorreo = {
  idUser: 'op1',
  nombre: 'Laura',
  email: 'laura@gsslatam.com',
  empresas: [{ idCompany: 1, companyName: 'GSS' }],
  // Pertenece también a OLP (sin el módulo Correo allí): puede crear solicitudes de OLP.
  empresasSolicitud: [{ idCompany: 1, companyName: 'GSS' }, { idCompany: 2, companyName: 'OLP' }],
};
const catalogo = {
  categorias: [{ id: 5, categoria: 'Jurídica' }, { id: 6, categoria: 'Tesorería' }],
  procesos: [
    { id: 10, nombre: 'Elaboración y revisión de contratos', idCategoria: 5, categoria: 'Jurídica', responsables: ['María Camila'] },
    { id: 20, nombre: 'Solicitud de poderes', idCategoria: 5, categoria: 'Jurídica' },
    { id: 30, nombre: 'Solicitud de Pago', idCategoria: 6, categoria: 'Tesorería' },
  ],
};

const auditDb = { emailAudit: { findMany: vi.fn(async () => [] as Array<{ created_at: Date }>) } };

function deps(extra: Partial<CorreoDeps> = {}): CorreoDeps {
  return {
    db: auditDb as never,
    cfg: readCorreoConfig({ CORREO_MODO: 'mock' }),
    kronos: {
      catalogoEmpresa: vi.fn(async () => catalogo),
      solicitudVisible: vi.fn(async () => ({ id: 77, asunto: 'X', idCompany: 1, estado: 1 })),
      insertarNota: vi.fn(async () => 1),
    },
    crearSolicitud: vi.fn(async () => ({ id_request: 500, processEmail: 'p@x', processEmails: ['p@x'], taskEmails: ['t@x'] })),
    notificarNueva: vi.fn(),
    subirAdjuntos: vi.fn(async (_id: number, a: unknown[]) => ({ subidos: a.length, fallidos: [] })),
    dominiosGrupo: ['gsslatam.com', 'onelatampharma.com'],
    ...extra,
  };
}

const filaBase = {
  conversationId: 'mock-conv-01AAAA',
  mensajeId: 'mock-msg-0001AAAA',
  mensajesIds: ['mock-msg-0001AAAA'],
  idCompany: 1,
  idProcess: 10,
  idSolicitante: 'u-remitente',
  titulo: 'Revisión de contrato',
  descripcion: 'Extracto',
  adjuntosIds: ['mock-adj-1AAAA'],
  etiquetar: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  reiniciarBuzonSimulado();
  db.usuarioDeEmpresa.mockResolvedValue({ id: 'u-remitente', nombre: 'Uno', correo: 'prueba.uno@gsslatam.com', empresas: [1] });
  db.reservarHilo.mockResolvedValue({ idLink: 3 });
  db.vinculoDeHilo.mockResolvedValue(null);
  db.correosRegistrados.mockResolvedValue(new Set());
  db.registrarCorreo.mockResolvedValue(true);
  db.usuariosPorCorreo.mockResolvedValue(new Map([['prueba.uno@gsslatam.com', { id: 'u-remitente', nombre: 'Uno', correo: 'prueba.uno@gsslatam.com', empresas: [1] }]]));
  db.solicitudesDeCorreos.mockResolvedValue(new Map());
  db.vinculosDeHilos.mockResolvedValue(new Map());
  auditDb.emailAudit.findMany.mockResolvedValue([]);
});

describe('Correo · crear solicitudes desde la simulación', () => {
  it('crea con el REMITENTE como solicitante, vincula el hilo, sube adjuntos, etiqueta y audita', async () => {
    const d = deps();
    const r = await crearDesdeFila(d, yo, filaBase, '10.0.0.1');
    expect(r).toMatchObject({ ok: true, idRequest: 500, adjuntosSubidos: 1, etiquetado: true });
    expect(d.crearSolicitud).toHaveBeenCalledWith(expect.objectContaining({ company: 1, process: 10, createdby: 'u-remitente', subject: 'Revisión de contrato' }));
    expect(db.reservarHilo).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ idUser: 'op1', conversationId: 'mock-conv-01AAAA', correos: [expect.objectContaining({ internetMessageId: '<mock-1.01@correo.simulado>' })] }));
    expect(db.activarHilo).toHaveBeenCalledWith(expect.anything(), 3, 500);
    expect(d.notificarNueva).toHaveBeenCalledWith(expect.objectContaining({ requestId: 500, creatorEmail: 'prueba.uno@gsslatam.com' }));
    const prov = new MockMailProvider(yo.email);
    expect((await prov.mensaje('mock-msg-0001AAAA')).categorias).toEqual(['SynerLink #500']);
    expect(db.auditar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'CREAR_SOLICITUD', idRequest: 500, ip: '10.0.0.1' }));
    // La auditoría no guarda el cuerpo del correo.
    const detalles = db.auditar.mock.calls.map((c) => String(c[1].detalle));
    expect(detalles.join(' ')).not.toMatch(/arrendamiento de la bodega/);
  });

  it('duplicado: si el hilo o el correo ya está reservado no crea la solicitud', async () => {
    db.reservarHilo.mockRejectedValue(new CorreoError('Este correo ya fue convertido en una solicitud.', 409, 'DUPLICADO'));
    const d = deps();
    await expect(crearDesdeFila(d, yo, filaBase, null)).rejects.toMatchObject({ status: 409, code: 'DUPLICADO' });
    expect(d.crearSolicitud).not.toHaveBeenCalled();
  });

  it('si falla la creación libera la reserva (se puede reintentar)', async () => {
    const d = deps({ crearSolicitud: vi.fn(async () => { throw new Error('BD caída'); }) });
    await expect(crearDesdeFila(d, yo, filaBase, null)).rejects.toThrow('BD caída');
    expect(db.liberarHilo).toHaveBeenCalledWith(expect.anything(), 3);
    expect(db.activarHilo).not.toHaveBeenCalled();
  });

  it('respeta el alcance por empresa, el proceso de la empresa y el solicitante de la empresa', async () => {
    await expect(crearDesdeFila(deps(), yo, { ...filaBase, idCompany: 3 }, null)).rejects.toMatchObject({ status: 403 });
    await expect(crearDesdeFila(deps(), yo, { ...filaBase, idProcess: 999 }, null)).rejects.toMatchObject({ status: 400 });
    db.usuarioDeEmpresa.mockResolvedValue(null);
    await expect(crearDesdeFila(deps(), yo, filaBase, null)).rejects.toMatchObject({ status: 400 });
  });

  it('el correo debe pertenecer a ESE hilo del buzón propio (no se aceptan ids cruzados)', async () => {
    await expect(crearDesdeFila(deps(), yo, { ...filaBase, mensajeId: 'mock-msg-0003AAAA' }, null)).rejects.toMatchObject({ status: 404 });
    expect(db.reservarHilo).not.toHaveBeenCalled();
  });

  it('solo sube adjuntos que pertenecen a los correos elegidos; errores de OneDrive no tumban la creación', async () => {
    const d = deps({ subirAdjuntos: vi.fn(async () => { throw new Error('sin red'); }) });
    const r = await crearDesdeFila(d, yo, { ...filaBase, adjuntosIds: ['mock-adj-4AAAA', 'mock-adj-1AAAA'] }, null);
    expect(r.ok).toBe(true);
    expect(r.adjuntosFallidos).toEqual(['OneDrive: sin red']);
    const d2 = deps();
    await crearDesdeFila(d2, yo, { ...filaBase, conversationId: 'mock-conv-02AAAA', mensajeId: 'mock-msg-0003AAAA', mensajesIds: [], adjuntosIds: ['mock-adj-1AAAA'] }, null);
    expect(d2.subirAdjuntos).not.toHaveBeenCalled();
  });
});

describe('Correo · simulación', () => {
  it('una fila por hilo, con proceso sugerido, solicitante y alertas; no crea nada', async () => {
    db.solicitudesDeCorreos.mockResolvedValue(new Map([['<mock-5.04@correo.simulado>', 41]]));
    const d = deps();
    const s = await simular(d, yo, { mensajesIds: ['mock-msg-0001AAAA', 'mock-msg-0002AAAA', 'mock-msg-0004AAAA', 'mock-msg-0005AAAA'], idCompany: 1, procesoPredeterminado: null });
    expect(s.filas).toHaveLength(3);
    const [contrato, marca, otrosi] = s.filas;
    expect(contrato).toMatchObject({ idSolicitante: 'u-remitente', idProcess: 10, mensajesIds: ['mock-msg-0001AAAA', 'mock-msg-0002AAAA'], incluir: true });
    expect(marca.alertas).toEqual(expect.arrayContaining(['EXTERNO', 'SIN_USUARIO']));
    expect(otrosi).toMatchObject({ duplicadoDe: 41, incluir: false });
    expect(d.crearSolicitud).not.toHaveBeenCalled();
    // Devuelve el catálogo COMPLETO de la empresa (categorías y procesos), no solo el sugerido.
    expect(s.categorias.map((c) => c.categoria)).toEqual(['Jurídica', 'Tesorería']);
    expect(s.procesos.map((p) => p.id)).toEqual([10, 20, 30]);
    await expect(simular(d, yo, { mensajesIds: ['mock-msg-0001AAAA'], idCompany: 9, procesoPredeterminado: null })).rejects.toMatchObject({ status: 403 });
  });

  it('empresa: cualquiera a la que pertenece (como «Nueva solicitud»), no solo la del buzón', async () => {
    const d = deps();
    const s = await simular(d, yo, { mensajesIds: ['mock-msg-0001AAAA'], idCompany: 2, procesoPredeterminado: null });
    expect(d.kronos.catalogoEmpresa).toHaveBeenCalledWith(2);
    expect(s.filas[0].idCompany).toBe(2);
  });

  it('la palabra clave solo propone: sin coincidencia queda el predeterminado y cualquier proceso del catálogo es válido', async () => {
    const d = deps();
    const s = await simular(d, yo, { mensajesIds: ['mock-msg-0001AAAA', 'mock-msg-0004AAAA'], idCompany: 1, procesoPredeterminado: 30 });
    expect(s.filas[0]).toMatchObject({ idProcess: 10, procesoSugeridoPor: 'palabra-clave' });
    expect(s.filas[1]).toMatchObject({ idProcess: 30, procesoSugeridoPor: 'predeterminado' });
    // Se puede crear en un proceso distinto del sugerido (otra categoría).
    const r = await crearDesdeFila(d, yo, { ...filaBase, idProcess: 30 }, null);
    expect(r.ok).toBe(true);
    expect(d.crearSolicitud).toHaveBeenCalledWith(expect.objectContaining({ process: 30, company: 1 }));
  });
});

describe('Correo · hilo, notas y respuesta', () => {
  it('verHilo: HTML saneado (sin scripts), imágenes remotas bloqueadas y vínculo', async () => {
    db.vinculoDeHilo.mockResolvedValue({ id: 3, conversationId: 'mock-conv-01AAAA', idRequest: 500, asunto: 'x', creadoEn: '2026-10-14T00:00:00Z', origen: 'CREADA', lastSyncedAt: null });
    db.correosRegistrados.mockResolvedValue(new Set(['<mock-1.01@correo.simulado>']));
    const h = await verHilo(deps(), yo, 'mock-conv-01AAAA', { remotas: false });
    expect(h.mensajes).toHaveLength(2);
    expect(h.mensajes[0].enCaso).toBe(true);
    expect(h.mensajes[1].remotasBloqueadas).toBe(1);
    expect(h.pendientes).toBe(1);
    const h2 = await verHilo(deps(), yo, 'mock-conv-02AAAA', { remotas: false });
    expect(h2.mensajes[0].html).not.toMatch(/script/i);
    await expect(verHilo(deps(), yo, 'mock-conv-99AAAA', { remotas: false })).rejects.toMatchObject({ status: 404 });
  });

  it('sincronizarHilo: agrega como nota solo lo nuevo, una vez (idempotente)', async () => {
    db.vinculoDeHilo.mockResolvedValue({ id: 3, conversationId: 'mock-conv-01AAAA', idRequest: 500, asunto: 'x', creadoEn: '', origen: 'CREADA', lastSyncedAt: null });
    db.correosRegistrados.mockResolvedValue(new Set(['<mock-1.01@correo.simulado>']));
    const d = deps();
    expect(await sincronizarHilo(d, yo, 'mock-conv-01AAAA', null)).toEqual({ agregadas: 1, idRequest: 500 });
    expect(d.kronos.insertarNota).toHaveBeenCalledWith(500, expect.stringContaining('cámara de comercio'), 'op1');
    db.registrarCorreo.mockResolvedValue(false);
    const d2 = deps();
    expect((await sincronizarHilo(d2, yo, 'mock-conv-01AAAA', null)).agregadas).toBe(0);
    expect(d2.kronos.insertarNota).not.toHaveBeenCalled();
    db.vinculoDeHilo.mockResolvedValue(null);
    await expect(sincronizarHilo(d, yo, 'mock-conv-01AAAA', null)).rejects.toMatchObject({ status: 404 });
  });

  it('responder: sale del buzón propio, se audita y queda como nota si el hilo está vinculado; la copia propia no se duplica', async () => {
    db.vinculoDeHilo.mockResolvedValue({ id: 3, conversationId: 'mock-conv-01AAAA', idRequest: 500, asunto: 'x', creadoEn: '', origen: 'CREADA', lastSyncedAt: null });
    const d = deps();
    const r = await responder(d, yo, { mensajeId: 'mock-msg-0002AAAA', texto: 'Recibido, lo reviso.', todos: false, adjuntos: [], ip: null });
    expect(r).toEqual({ notaEnSolicitud: 500 });
    expect(enviadosSimulados(yo.email)).toEqual([{ mensajeId: 'mock-msg-0002AAAA', todos: false, texto: 'Recibido, lo reviso.', adjuntos: [] }]);
    expect(d.kronos.insertarNota).toHaveBeenCalledWith(500, expect.stringContaining('Respuesta enviada desde SynerLink'), 'op1');
    expect(db.auditar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'RESPONDER', idRequest: 500 }));
    // La copia enviada aparece en el hilo: con la auditoría reciente se registra como RESPUESTA, sin nota nueva.
    auditDb.emailAudit.findMany.mockResolvedValue([{ created_at: new Date() }]);
    db.correosRegistrados.mockResolvedValue(new Set(['<mock-1.01@correo.simulado>', '<mock-2.01@correo.simulado>']));
    const d2 = deps();
    expect((await sincronizarHilo(d2, yo, 'mock-conv-01AAAA', null)).agregadas).toBe(0);
    expect(db.registrarCorreo).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tipo: 'RESPUESTA' }));
  });

  it('responder valida texto y adjuntos', async () => {
    await expect(responder(deps(), yo, { mensajeId: 'mock-msg-0001AAAA', texto: '  ', todos: false, adjuntos: [], ip: null })).rejects.toThrow(/Escriba/);
    const grande = { nombre: 'g.bin', tipo: 'x', bytes: Buffer.alloc(3 * 1024 * 1024 + 1) };
    await expect(responder(deps(), yo, { mensajeId: 'mock-msg-0001AAAA', texto: 'x', todos: false, adjuntos: [grande], ip: null })).rejects.toThrow(/3 MB/);
    const seis = Array.from({ length: 6 }, () => ({ nombre: 'a', tipo: 'x', bytes: Buffer.from('a') }));
    await expect(responder(deps(), yo, { mensajeId: 'mock-msg-0001AAAA', texto: 'x', todos: false, adjuntos: seis, ip: null })).rejects.toThrow(/Máximo 5/);
  });

  it('vincular a una solicitud existente solo si participa y es de su empresa', async () => {
    db.vincularExistente.mockResolvedValue({ id: 9, conversationId: 'mock-conv-02AAAA', idRequest: 77 });
    expect(await vincularHilo(deps(), yo, 'mock-conv-02AAAA', 77, null)).toMatchObject({ idRequest: 77 });
    await expect(vincularHilo(deps({ kronos: { ...deps().kronos, solicitudVisible: vi.fn(async () => null) } }), yo, 'mock-conv-02AAAA', 77, null)).rejects.toMatchObject({ status: 404 });
    await expect(vincularHilo(deps({ kronos: { ...deps().kronos, solicitudVisible: vi.fn(async () => ({ id: 77, asunto: 'x', idCompany: 3, estado: 1 })) } }), yo, 'mock-conv-02AAAA', 77, null)).rejects.toMatchObject({ status: 403 });
  });
});

describe('Correo · buzón de la sesión con la app de aplicación (modo graph)', () => {
  const cfg = readCorreoConfig(graphEnv);

  it('disponibilidad por inquilino: GSS sí; OLP/Ryan «próximamente»; off en preparación', async () => {
    expect(estadoConexion(deps({ cfg }), yo)).toMatchObject({ modo: 'graph', disponible: true, correo: 'laura@gsslatam.com' });
    const olp = { ...yo, email: 'ana@onelatampharma.com' };
    expect(estadoConexion(deps({ cfg }), olp).disponible).toBe(false);
    await expect(proveedorDe(deps({ cfg }), olp)).rejects.toMatchObject({ status: 403, code: 'NO_DISPONIBLE', message: 'Correo disponible próximamente para su empresa.' });
    await expect(proveedorDe(deps({ cfg: readCorreoConfig({}) }), yo)).rejects.toMatchObject({ status: 503 });
    expect(estadoConexion(deps(), yo)).toMatchObject({ modo: 'mock', disponible: true });
  });

  it('todas las llamadas a Graph van a /users/{correo de la SESIÓN}', async () => {
    limpiarTokensApp();
    const { f, urls } = graphFalso((url) => (url.includes('/mailFolders?') ? { body: { value: [] } } : { body: { value: [] } }));
    const prov = await proveedorDe(deps({ cfg, fetchFn: f }), yo);
    await prov.carpetas();
    await prov.mensajes({ buscar: 'contrato' });
    expect(urls.length).toBe(2);
    expect(urls.every((u) => u.startsWith(`${BASE}/`))).toBe(true);
  });

  it('anti-IDOR: un id de mensaje de OTRO buzón se consulta en el propio y da 404; nada se crea', async () => {
    limpiarTokensApp();
    const { f, urls } = graphFalso(() => ({ status: 404, body: { error: { code: 'ErrorItemNotFound' } } }));
    const d = deps({ cfg, fetchFn: f });
    await expect(crearDesdeFila(d, yo, { ...filaBase, conversationId: 'CONVAJENA123', mensajeId: 'AAMkAJENO123', mensajesIds: [] }, null)).rejects.toMatchObject({ status: 404 });
    await expect(responder(d, yo, { mensajeId: 'AAMkAJENO123', texto: 'x', todos: false, adjuntos: [], ip: null })).rejects.toMatchObject({ status: 404 });
    await expect(verHilo(d, yo, 'CONVAJENA123', { remotas: false })).rejects.toMatchObject({ status: 404 });
    expect(d.crearSolicitud).not.toHaveBeenCalled();
    expect(urls.every((u) => u.startsWith(`${BASE}/`))).toBe(true);
  });

  it('banderas: sin envío no se responde; sin etiqueta no se toca Outlook', async () => {
    const sinEnvio = deps({ cfg: readCorreoConfig({ CORREO_MODO: 'mock', CORREO_ENVIO_HABILITADO: 'false' }) });
    await expect(responder(sinEnvio, yo, { mensajeId: 'mock-msg-0001AAAA', texto: 'x', todos: false, adjuntos: [], ip: null })).rejects.toMatchObject({ status: 403 });
    expect(enviadosSimulados(yo.email)).toEqual([]);
    const sinEtiqueta = deps({ cfg: readCorreoConfig({ CORREO_MODO: 'mock', CORREO_ETIQUETAR_HABILITADO: 'false' }) });
    const r = await crearDesdeFila(sinEtiqueta, yo, filaBase, null);
    expect(r.etiquetado).toBe(false);
    expect((await new MockMailProvider(yo.email).mensaje('mock-msg-0001AAAA')).categorias).toEqual([]);
  });

  it('auditoría de lectura: usuario, buzón de la sesión, acción y mensaje', async () => {
    await auditarLectura(deps(), yo, { accion: 'DESCARGAR_ADJUNTO', mensajeId: 'M1', detalle: 'Adjunto A1' }, '10.0.0.1');
    expect(db.auditar).toHaveBeenCalledWith(expect.anything(), { idUser: 'op1', mailbox: 'laura@gsslatam.com', accion: 'DESCARGAR_ADJUNTO', mensajeId: 'M1', detalle: 'Adjunto A1', ip: '10.0.0.1' });
    await simular(deps(), yo, { mensajesIds: ['mock-msg-0001AAAA'], idCompany: 1, procesoPredeterminado: null, ip: '10.0.0.2' });
    expect(db.auditar).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accion: 'SIMULAR', mailbox: 'laura@gsslatam.com', ip: '10.0.0.2' }));
  });
});

describe('Correo · tarea de fondo (apagada por defecto)', () => {
  it('no hace nada sin CORREO_SYNC_HABILITADO', async () => {
    const r = await sincronizarTodo(deps(), async () => yo);
    expect(r.omitido).toMatch(/CORREO_SYNC_HABILITADO/);
    expect(db.hilosParaSincronizar).not.toHaveBeenCalled();
  });

  it('encendida: recorre los hilos y cuenta errores sin detenerse', async () => {
    db.hilosParaSincronizar.mockResolvedValue([
      { idLink: 3, idUser: 'op1', conversationId: 'mock-conv-01AAAA', idRequest: 500 },
      { idLink: 4, idUser: 'sin-acceso', conversationId: 'x', idRequest: 1 },
    ]);
    db.vinculoDeHilo.mockResolvedValue({ id: 3, conversationId: 'mock-conv-01AAAA', idRequest: 500, asunto: 'x', creadoEn: '', origen: 'CREADA', lastSyncedAt: null });
    const r = await sincronizarTodo(deps({ cfg: readCorreoConfig({ CORREO_MODO: 'mock', CORREO_SYNC_HABILITADO: 'true' }) }), async (id) => (id === 'op1' ? yo : null));
    expect(r).toEqual({ hilos: 2, agregadas: 2, errores: 0 });
  });
});
