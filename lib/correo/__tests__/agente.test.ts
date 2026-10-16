import { beforeEach, describe, expect, it, vi } from 'vitest';

// «Consultar a un agente» con la base (en memoria) y Graph simulados: compartir, tarjetas, anti-IDOR y
// que SOLO la confirmación de la persona ejecuta (un solo envío).
const db = vi.hoisted(() => {
  const names = [
    'usuariosPorCorreo', 'usuarioDeEmpresa', 'vinculosDeHilos', 'solicitudesDeCorreos',
    'reservarHilo', 'activarHilo', 'liberarHilo', 'vincularExistente', 'vinculoDeHilo', 'correosRegistrados', 'registrarCorreo',
    'marcarSincronizado', 'hilosParaSincronizar', 'auditar', 'reservarAcuse', 'liberarAcuse',
  ] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as Record<(typeof names)[number], ReturnType<typeof vi.fn>>;
});
vi.mock('../db', () => db);

import { readCorreoConfig } from '../config';
import { CORREO_AGENTE_MAX_CONTEXTO, CORREO_AGENTE_VIGENCIA_MS } from '../constants';
import { enviadosSimulados, reiniciarBuzonSimulado } from '../mock';
import {
  accionesDeChat,
  compartirConAgente,
  concesionesDeHilo,
  confirmarAccion,
  descartarAccion,
  escaparMd,
  leerPropuesta,
  mensajeContexto,
  nuevoTokenConcesion,
  parseEdicion,
  prepararSolicitud,
  procesoPropuesto,
  revocarConcesion,
  type AgentePort,
} from '../agente';
import type { CorreoDeps } from '../service';
import type { AccesoCorreo } from '../db';
import type { MensajeCompleto } from '../types';

// ---------------------------------------------------------------------------
// Base en memoria con la forma mínima de Prisma que usa lib/correo/agente.ts
// ---------------------------------------------------------------------------

type Fila = Record<string, unknown>;

function coincide(fila: Fila, where: Record<string, unknown> | undefined, tablas: Tablas): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (k === 'share') {
      const s = tablas.shares.find((x) => x.id === fila.id_share);
      return Boolean(s && coincide(s, v as Record<string, unknown>, tablas));
    }
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const o = v as Record<string, unknown>;
      if ('gt' in o) return (fila[k] as Date).getTime() > (o.gt as Date).getTime();
      if ('in' in o) return (o.in as unknown[]).includes(fila[k]);
    }
    return (fila[k] ?? null) === v;
  });
}

interface Tablas {
  shares: Fila[];
  acciones: Fila[];
  chats: Fila[];
  mensajes: Fila[];
  agentes: Fila[];
}

function baseFalsa() {
  const t: Tablas = { shares: [], acciones: [], chats: [], mensajes: [], agentes: [{ id_agent: 7, code: 'horus', display_name: 'Orus' }, { id_agent: 8, code: 'nancy', display_name: 'Nancy' }] };
  const seq = { s: 0, a: 0, c: 100, m: 1000 };
  const tabla = (filas: Fila[], nuevoId: () => number) => ({
    findFirst: async (q: { where?: Record<string, unknown>; include?: unknown }) => {
      const f = filas.filter((x) => coincide(x, q.where, t)).at(-1);
      return f ? conInclude(f, q.include) : null;
    },
    findMany: async (q: { where?: Record<string, unknown>; include?: unknown }) => filas.filter((x) => coincide(x, q.where, t)).map((f) => conInclude(f, q.include)),
    create: async (q: { data: Fila }) => {
      const f = { id: nuevoId(), ...q.data };
      filas.push(f);
      return f;
    },
    update: async (q: { where: { id: number }; data: Fila }) => {
      const f = filas.find((x) => x.id === q.where.id)!;
      Object.assign(f, q.data);
      return f;
    },
    updateMany: async (q: { where?: Record<string, unknown>; data: Fila }) => {
      const fs = filas.filter((x) => coincide(x, q.where, t));
      for (const f of fs) Object.assign(f, q.data);
      return { count: fs.length };
    },
  });
  const conInclude = (f: Fila, include: unknown) => (include && (include as Fila).share ? { ...f, share: t.shares.find((s) => s.id === f.id_share) } : f);
  const prisma = {
    emailAgentShare: tabla(t.shares, () => ++seq.s),
    emailAgentAction: tabla(t.acciones, () => ++seq.a),
    chatConversation: tabla(t.chats, () => ++seq.c),
    chatMessage: tabla(t.mensajes, () => ++seq.m),
    agent: {
      findMany: async (q: { where: { id_agent: { in: number[] } } }) => t.agentes.filter((a) => q.where.id_agent.in.includes(a.id_agent as number)),
      findFirst: async (q: { where: { id_agent: number } }) => t.agentes.find((a) => a.id_agent === q.where.id_agent) ?? null,
    },
    emailAudit: { findMany: vi.fn(async () => []) },
    async $transaction<T>(fn: (tx: unknown) => Promise<T>) {
      return fn(prisma);
    },
  };
  return { t, prisma };
}

const yo: AccesoCorreo = {
  idUser: 'op1',
  nombre: 'Laura',
  email: 'laura@gsslatam.com',
  empresas: [{ idCompany: 1, companyName: 'GSS' }],
  empresasSolicitud: [{ idCompany: 1, companyName: 'GSS' }],
};
const otra: AccesoCorreo = { ...yo, idUser: 'op2', nombre: 'María', email: 'maria@gsslatam.com' };

const catalogo = {
  categorias: [{ id: 5, categoria: 'Jurídica' }],
  procesos: [
    { id: 10, nombre: 'Elaboración y revisión de contratos', idCategoria: 5, categoria: 'Jurídica' },
    { id: 20, nombre: 'Solicitud de poderes', idCategoria: 5, categoria: 'Jurídica' },
  ],
};

let ahora = Date.parse('2026-10-16T15:00:00Z');
let base: ReturnType<typeof baseFalsa>;
let px: AgentePort;

function deps(extra: Partial<CorreoDeps> = {}): CorreoDeps {
  return {
    db: base.prisma as never,
    cfg: readCorreoConfig({ CORREO_MODO: 'mock' }),
    kronos: {
      catalogoEmpresa: vi.fn(async () => catalogo),
      solicitudVisible: vi.fn(async () => ({ id: 77, asunto: 'X', idCompany: 1, estado: 1 })),
      solicitudExiste: vi.fn(async () => true),
      insertarNota: vi.fn(async () => 1),
    },
    crearSolicitud: vi.fn(async () => ({ id_request: 500, processEmail: null, processEmails: [], taskEmails: [] })),
    notificarNueva: vi.fn(),
    subirAdjuntos: vi.fn(async (_id: number, a: unknown[]) => ({ subidos: a.length, fallidos: [] })),
    dominiosGrupo: ['gsslatam.com'],
    now: () => ahora,
    ...extra,
  };
}

const CONV = 'mock-conv-01AAAA';

/** Concesión + propuesta directamente en la base (lo que hace kronos-mcp). */
function sembrarAccion(tipo: 'RESPUESTA' | 'SOLICITUD' | 'NOTA', payload: Fila, p: { idUser?: string; mailbox?: string; vence?: number; revocada?: boolean } = {}) {
  const idShare = base.t.shares.length + 50;
  base.t.shares.push({
    id: idShare,
    token: `cs_${'x'.repeat(20)}${idShare}`,
    id_user: p.idUser ?? 'op1',
    mailbox: p.mailbox ?? 'laura@gsslatam.com',
    conversation_id: CONV,
    asunto: 'Revisión de contrato',
    id_agent: 7,
    id_chat_conversation: 101,
    created_at: new Date(ahora - 1000),
    expires_at: new Date(p.vence ?? ahora + 3600_000),
    revoked_at: p.revocada ? new Date(ahora - 10) : null,
  });
  const id = base.t.acciones.length + 1;
  base.t.acciones.push({ id, id_share: idShare, id_agent: 7, tipo, estado: 'PENDIENTE', payload: JSON.stringify(payload), id_chat_message: 2000 + id, created_at: new Date(ahora), decided_at: null, decided_by: null, resultado: null, id_request: null });
  return id;
}

beforeEach(() => {
  vi.clearAllMocks();
  reiniciarBuzonSimulado();
  ahora = Date.parse('2026-10-16T15:00:00Z');
  base = baseFalsa();
  base.t.chats.push({ id: 101, kind: 'direct', id_user: 'op1', id_agent: 7, archived: false });
  px = {
    db: base.prisma as never,
    agentesDe: vi.fn(async (email: string) =>
      email === 'laura@gsslatam.com' ? [{ idAgent: 7, code: 'horus', displayName: 'Orus', avatarUrl: null, avatarVersion: null, description: null }] : []
    ),
  };
  db.vinculoDeHilo.mockResolvedValue(null);
  db.auditar.mockResolvedValue(undefined);
  db.usuarioDeEmpresa.mockResolvedValue({ id: 'u-remitente', nombre: 'Uno', correo: 'prueba.uno@gsslatam.com', empresas: [1] });
  db.reservarHilo.mockResolvedValue({ idLink: 3 });
  db.usuariosPorCorreo.mockResolvedValue(new Map([['prueba.uno@gsslatam.com', { id: 'u-remitente', nombre: 'Uno', correo: 'prueba.uno@gsslatam.com', empresas: [1] }]]));
  db.solicitudesDeCorreos.mockResolvedValue(new Map());
  db.vinculosDeHilos.mockResolvedValue(new Map());
  db.correosRegistrados.mockResolvedValue(new Set());
  db.reservarAcuse.mockResolvedValue(true);
});

const acciones = () => db.auditar.mock.calls.map((c) => c[1].accion);

describe('mensaje de contexto', () => {
  const m = (n: number, html: string, extra: Partial<MensajeCompleto> = {}): MensajeCompleto => ({
    id: `M${n}AAAAAAAA`,
    conversationId: 'C',
    internetMessageId: `<${n}@x>`,
    asunto: 'Asunto',
    de: { nombre: 'Proveedor *Uno*', correo: 'p@externo.com' },
    fecha: '2026-10-15T14:00:00Z',
    leido: true,
    conAdjuntos: false,
    extracto: '',
    categorias: [],
    para: [{ nombre: 'Laura', correo: 'laura@gsslatam.com' }],
    cc: [],
    html,
    adjuntos: [{ id: 'A1', nombre: 'contrato.pdf', tipo: 'application/pdf', tamano: 20480, enLinea: false }],
    ...extra,
  });

  it('trae asunto, remitentes, fecha, extracto saneado, adjuntos y el share_id; escapa el Markdown', () => {
    const t = mensajeContexto({ asunto: 'Contrato [urgente]', mensajes: [m(1, '<p>Hola ![x](https://rastreo/p.gif) <script>alert(1)</script></p>')], pregunta: 'Prepárame una **respuesta**', token: 'cs_TOKEN', venceEn: new Date('2026-10-17T15:00:00Z') });
    expect(t).toContain('Contrato \\[urgente\\]');
    expect(t).toContain('Proveedor \\*Uno\\* (p@externo.com)');
    expect(t).toContain('Prepárame una \\*\\*respuesta\\*\\*');
    expect(t).toContain('\\!\\[x\\](https://rastreo/p.gif)');
    expect(t).not.toContain('<script');
    expect(t).toContain('contrato.pdf (20 KB)');
    expect(t).toContain('share_id: cs_TOKEN');
    expect(t).toMatch(/nada se envía ni se crea sin mi confirmación/);
  });

  it('cabe en el tope del chat aunque el hilo sea enorme (recorta y omite los más antiguos)', () => {
    const largo = `<p>${'palabra '.repeat(2000)}</p>`;
    const t = mensajeContexto({ asunto: 'X', mensajes: Array.from({ length: 40 }, (_, i) => m(i, largo)), token: 'cs_T', venceEn: new Date() });
    expect(t.length).toBeLessThanOrEqual(CORREO_AGENTE_MAX_CONTEXTO);
    expect(t).toMatch(/Se omiten \d+ mensaje\(s\) anteriores/);
    expect(t).toContain('share_id: cs_T');
  });

  it('token opaco, no adivinable', () => {
    const a = nuevoTokenConcesion();
    expect(a).toMatch(/^cs_[A-Za-z0-9_-]{24}$/);
    expect(nuevoTokenConcesion()).not.toBe(a);
    expect(escaparMd('a_b|c')).toBe('a\\_b\\|c');
  });
});

describe('compartir el hilo con un agente', () => {
  it('solo con un agente de la persona; crea la concesión de 24 h, el mensaje de contexto en SU chat y lo audita', async () => {
    await expect(compartirConAgente(deps(), px, yo, { conversationId: CONV, idAgent: 8, ip: null })).rejects.toMatchObject({ status: 403 });
    const r = await compartirConAgente(deps(), px, yo, { conversationId: CONV, idAgent: 7, pregunta: '¿Qué respondo?', ip: '10.0.0.9' });
    expect(r.idChatConversation).toBe(101); // reutiliza el chat directo existente
    const s = base.t.shares.at(-1)!;
    expect(s).toMatchObject({ id_user: 'op1', mailbox: 'laura@gsslatam.com', conversation_id: CONV, id_agent: 7, id_chat_conversation: 101 });
    expect((s.expires_at as Date).getTime() - (s.created_at as Date).getTime()).toBe(CORREO_AGENTE_VIGENCIA_MS);
    const msg = base.t.mensajes.at(-1)!;
    expect(msg).toMatchObject({ id_conversation: 101, role: 'user', id_user_author: 'op1', client_ip: '10.0.0.9' });
    expect(String(msg.body)).toContain(`share_id: ${s.token}`);
    expect(String(msg.body)).toContain('¿Qué respondo?');
    expect(acciones()).toEqual(['COMPARTIR_AGENTE']);
    // La auditoría no lleva el cuerpo del correo.
    expect(String(db.auditar.mock.calls[0][1].detalle)).not.toMatch(/arrendamiento de la bodega/);
  });

  it('crea el chat directo si no existía; compartir de nuevo reemplaza la concesión vigente', async () => {
    base.t.chats.length = 0;
    const r1 = await compartirConAgente(deps(), px, yo, { conversationId: CONV, idAgent: 7, ip: null });
    expect(base.t.chats).toHaveLength(1);
    await compartirConAgente(deps(), px, yo, { conversationId: CONV, idAgent: 7, ip: null });
    expect(base.t.shares.filter((s) => !s.revoked_at)).toHaveLength(1);
    expect(base.t.shares.find((s) => s.id === r1.idShare)!.revoked_at).toBeInstanceOf(Date);
  });

  it('el hilo debe estar en el buzón de la sesión', async () => {
    await expect(compartirConAgente(deps(), px, yo, { conversationId: 'mock-conv-NOEXISTE', idAgent: 7, ip: null })).rejects.toMatchObject({ status: 404 });
    expect(base.t.shares).toHaveLength(0);
  });

  it('concesiones vigentes del hilo y revocar: solo las propias', async () => {
    const r = await compartirConAgente(deps(), px, yo, { conversationId: CONV, idAgent: 7, ip: null });
    expect((await concesionesDeHilo(deps(), px, yo, CONV)).map((c) => c.agente.displayName)).toEqual(['Orus']);
    expect(await concesionesDeHilo(deps(), px, otra, CONV)).toEqual([]);
    await expect(revocarConcesion(deps(), px, otra, r.idShare, null)).rejects.toMatchObject({ status: 404 });
    expect(await revocarConcesion(deps(), px, yo, r.idShare, null)).toEqual({ revocada: true });
    expect(await concesionesDeHilo(deps(), px, yo, CONV)).toEqual([]);
    expect(acciones()).toContain('REVOCAR_AGENTE');
    // Vencida: ya no aparece.
    await compartirConAgente(deps(), px, yo, { conversationId: CONV, idAgent: 7, ip: null });
    ahora += CORREO_AGENTE_VIGENCIA_MS + 1;
    expect(await concesionesDeHilo(deps(), px, yo, CONV)).toEqual([]);
  });
});

describe('tarjetas: la persona decide', () => {
  const resp = { cuerpo: 'Cordial saludo,\n\nRecibido **con gusto**.', todos: false, para: ['prueba.uno@gsslatam.com'] };

  it('accionesDeChat: solo las de SUS concesiones, con la vista previa saneada', async () => {
    const id = sembrarAccion('RESPUESTA', resp);
    sembrarAccion('RESPUESTA', resp, { idUser: 'op2', mailbox: 'maria@gsslatam.com' });
    const l = await accionesDeChat(deps(), px, yo, 101);
    expect(l.map((a) => a.id)).toEqual([id]);
    expect(l[0]).toMatchObject({ tipo: 'RESPUESTA', estado: 'PENDIENTE', vigente: true, agente: 'Orus', idChatMessage: 2001 });
    expect(l[0].respuesta!.html).toBe('<p>Cordial saludo,</p><p>Recibido <strong>con gusto</strong>.</p>');
  });

  it('CONFIRMAR una respuesta: sale desde el buzón de la sesión UNA sola vez, se audita y se le cuenta al agente', async () => {
    const id = sembrarAccion('RESPUESTA', resp);
    const antes = enviadosSimulados(yo.email).length;
    const [r1, r2] = await Promise.allSettled([confirmarAccion(deps(), px, yo, id, {}, '10.0.0.1'), confirmarAccion(deps(), px, yo, id, {}, '10.0.0.1')]);
    const ok = [r1, r2].filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(1);
    expect([r1, r2].find((r) => r.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    const enviados = enviadosSimulados(yo.email).slice(antes);
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({ mensajeId: 'mock-msg-0002AAAA', todos: false, texto: 'Cordial saludo,\n\nRecibido con gusto.' });
    expect(base.t.acciones[0]).toMatchObject({ estado: 'CONFIRMADA', decided_by: 'op1' });
    expect(acciones()).toEqual(expect.arrayContaining(['RESPONDER', 'AGENTE_CONFIRMAR']));
    expect(base.t.mensajes.at(-1)).toMatchObject({ id_conversation: 101, role: 'user', id_user_author: 'op1' });
    expect(String(base.t.mensajes.at(-1)!.body)).toMatch(/Envié desde mi buzón la respuesta/);
    await expect(confirmarAccion(deps(), px, yo, id, {}, null)).rejects.toMatchObject({ status: 409 });
  });

  it('lo que sale es lo que la persona editó', async () => {
    const id = sembrarAccion('RESPUESTA', resp);
    const antes = enviadosSimulados(yo.email).length;
    await confirmarAccion(deps(), px, yo, id, parseEdicion({ cuerpo: 'Texto MÍO', todos: true }), null);
    expect(enviadosSimulados(yo.email).slice(antes)[0]).toMatchObject({ texto: 'Texto MÍO', todos: true });
    expect(String(db.auditar.mock.calls.find((c) => c[1].accion === 'AGENTE_CONFIRMAR')![1].detalle)).toMatch(/con cambios/);
  });

  it('anti-IDOR: otra persona no ve ni confirma la propuesta (404) y no sale nada', async () => {
    const id = sembrarAccion('RESPUESTA', resp);
    const antes = enviadosSimulados(otra.email).length + enviadosSimulados(yo.email).length;
    await expect(confirmarAccion(deps(), px, otra, id, {}, null)).rejects.toMatchObject({ status: 404 });
    await expect(descartarAccion(deps(), px, otra, id, null)).rejects.toMatchObject({ status: 404 });
    expect(enviadosSimulados(otra.email).length + enviadosSimulados(yo.email).length).toBe(antes);
    expect(base.t.acciones[0].estado).toBe('PENDIENTE');
  });

  it('el buzón de la concesión debe ser el de la sesión (si la persona cambió de correo, 404)', async () => {
    const id = sembrarAccion('RESPUESTA', resp, { mailbox: 'anterior@gsslatam.com' });
    await expect(confirmarAccion(deps(), px, yo, id, {}, null)).rejects.toMatchObject({ status: 404 });
  });

  it('vencida o revocada: no se puede confirmar (410); sí descartar', async () => {
    const v = sembrarAccion('RESPUESTA', resp, { vence: ahora - 1 });
    const r = sembrarAccion('RESPUESTA', resp, { revocada: true });
    const antes = enviadosSimulados(yo.email).length;
    await expect(confirmarAccion(deps(), px, yo, v, {}, null)).rejects.toMatchObject({ status: 410 });
    await expect(confirmarAccion(deps(), px, yo, r, {}, null)).rejects.toMatchObject({ status: 410, message: expect.stringMatching(/revocó/) });
    expect(enviadosSimulados(yo.email).length).toBe(antes);
    expect(await descartarAccion(deps(), px, yo, v, null)).toMatchObject({ estado: 'DESCARTADA' });
  });

  it('DESCARTAR: no envía nada, le avisa al agente y ya no se puede confirmar', async () => {
    const id = sembrarAccion('RESPUESTA', resp);
    const antes = enviadosSimulados(yo.email).length;
    await descartarAccion(deps(), px, yo, id, null);
    expect(enviadosSimulados(yo.email).length).toBe(antes);
    expect(String(base.t.mensajes.at(-1)!.body)).toMatch(/Descarté la respuesta/);
    expect(acciones()).toEqual(['AGENTE_DESCARTAR']);
    await expect(confirmarAccion(deps(), px, yo, id, {}, null)).rejects.toMatchObject({ status: 409 });
  });

  it('si el envío está deshabilitado (error antes de ejecutar) vuelve a PENDIENTE para reintentar', async () => {
    const id = sembrarAccion('RESPUESTA', resp);
    const d = deps({ cfg: readCorreoConfig({ CORREO_MODO: 'mock', CORREO_ENVIO_HABILITADO: 'false' }) });
    await expect(confirmarAccion(d, px, yo, id, {}, null)).rejects.toMatchObject({ status: 403 });
    expect(base.t.acciones[0]).toMatchObject({ estado: 'PENDIENTE', decided_by: null });
    expect(acciones()).toContain('AGENTE_FALLIDO');
  });

  it('NOTA: sin caso vinculado no se agrega; con vínculo, va al caso a nombre de la persona', async () => {
    const id = sembrarAccion('NOTA', { texto: 'El contrato está revisado.', idRequest: 900 });
    await expect(confirmarAccion(deps(), px, yo, id, {}, null)).rejects.toMatchObject({ status: 409, code: 'SIN_VINCULO' });
    expect(base.t.acciones[0].estado).toBe('PENDIENTE');
    db.vinculoDeHilo.mockResolvedValue({ id: 3, idRequest: 900, conversationId: CONV, asunto: 'X', creadoEn: '', origen: 'CREADA', lastSyncedAt: null });
    const d = deps();
    const r = await confirmarAccion(d, px, yo, id, {}, null);
    expect(r).toMatchObject({ estado: 'CONFIRMADA', idRequest: 900 });
    expect(d.kronos.insertarNota).toHaveBeenCalledWith(900, expect.stringMatching(/propuesta por el agente Orus y confirmada por Laura[\s\S]*El contrato está revisado\./), 'op1');
  });

  it('SOLICITUD: se prepara con la simulación del Correo y se crea SOLO al confirmar, por crearDesdeFila', async () => {
    const id = sembrarAccion('SOLICITUD', { proceso: 'elaboracion y revision de contratos', categoria: 'Jurídica', titulo: 'Revisar contrato', descripcion: 'Revisión del contrato de la bodega' });
    const d = deps();
    const p = await prepararSolicitud(d, px, yo, id, null, null);
    expect(p).toMatchObject({ idCompany: 1, idProcess: 10, idSolicitante: 'u-remitente', titulo: 'Revisar contrato' });
    expect(d.crearSolicitud).not.toHaveBeenCalled();
    const r = await confirmarAccion(d, px, yo, id, parseEdicion({ idCompany: 1, idProcess: 10, idSolicitante: 'u-remitente', titulo: 'Revisar contrato', descripcion: 'Revisión del contrato de la bodega', informar: false }), '10.0.0.2');
    expect(r).toMatchObject({ estado: 'CONFIRMADA', idRequest: 500 });
    expect(d.crearSolicitud).toHaveBeenCalledWith(expect.objectContaining({ company: 1, process: 10, createdby: 'u-remitente', subject: 'Revisar contrato' }));
    expect(db.reservarHilo).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ idUser: 'op1', conversationId: CONV }));
    expect(acciones()).toEqual(expect.arrayContaining(['SIMULAR', 'CREAR_SOLICITUD', 'AGENTE_CONFIRMAR']));
  });

  it('SOLICITUD sin proceso válido: error de negocio y queda PENDIENTE', async () => {
    const id = sembrarAccion('SOLICITUD', { proceso: 'x', titulo: 'T', descripcion: 'Desc' });
    await expect(confirmarAccion(deps(), px, yo, id, parseEdicion({ idCompany: 1, idProcess: 999, idSolicitante: 'u-remitente', titulo: 'Título', descripcion: 'Descripción' }), null)).rejects.toMatchObject({ status: 400 });
    expect(base.t.acciones[0].estado).toBe('PENDIENTE');
  });
});

describe('reglas puras', () => {
  it('procesoPropuesto: por id, nombre exacto o parecido (sin tildes)', () => {
    expect(procesoPropuesto(catalogo, '20', null)).toBe(20);
    expect(procesoPropuesto(catalogo, 'Solicitud de PODERES', 'juridica')).toBe(20);
    expect(procesoPropuesto(catalogo, 'revisión de contratos', null)).toBe(10);
    expect(procesoPropuesto(catalogo, 'Nómina', null)).toBeNull();
    expect(procesoPropuesto(catalogo, null, null)).toBeNull();
  });

  it('leerPropuesta no confía en el payload (topes y tipos)', () => {
    expect(leerPropuesta('RESPUESTA', 'no-json')).toMatchObject({ respuesta: { cuerpo: '', todos: false, para: [] } });
    expect(leerPropuesta('NOTA', JSON.stringify({ texto: 'x'.repeat(9000), idRequest: 'abc' })).nota).toMatchObject({ idRequest: null });
    expect(leerPropuesta('NOTA', JSON.stringify({ texto: 'x'.repeat(9000) })).nota!.texto).toHaveLength(4000);
    expect(leerPropuesta('RESPUESTA', JSON.stringify({ cuerpo: '<script>x</script>' })).respuesta!.html).toBe('<p>&lt;script&gt;x&lt;/script&gt;</p>');
  });

  it('parseEdicion: solo campos conocidos', () => {
    expect(parseEdicion({ cuerpo: 'a', todos: true, mailbox: 'otro@x.com', idCompany: '3', informar: true })).toEqual({ cuerpo: 'a', todos: true, idCompany: 3, informar: true });
    expect(() => parseEdicion({ cuerpo: 'x'.repeat(20_001) })).toThrow(/larga/);
  });
});

describe('constancia de lo confirmado', () => {
  it('si la persona edita, la tarjeta muestra lo que salió y el payload conserva lo propuesto', async () => {
    const id = sembrarAccion('RESPUESTA', { cuerpo: 'Propuesta del agente', todos: false, para: [] });
    await confirmarAccion(deps(), px, yo, id, parseEdicion({ cuerpo: 'Lo que yo envié' }), null);
    const p = JSON.parse(String(base.t.acciones[0].payload));
    expect(p).toMatchObject({ cuerpo: 'Propuesta del agente', confirmado: { cuerpo: 'Lo que yo envié', editada: true } });
    const [v] = await accionesDeChat(deps(), px, yo, 101);
    expect(v.respuesta!.cuerpo).toBe('Lo que yo envié');
  });
});
