/**
 * «Consultar a un agente» (Correo, 2026-10-16): herramientas correo_* del MCP.
 * Alcance por CONCESIÓN + agente de la llave, anti-IDOR, buzón desde la concesión, y que las
 * herramientas de escritura solo PROPONEN (nada sale ni se crea). Prisma y Graph simulados.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PrismaClient } from '../../app/generated/prisma/index.js';
import { setPrisma } from '../src/db.js';
import type { AuthScope } from '../src/auth.js';
import { registerCorreoAgenteTools, RECHAZO_CONCESION, codigoAgente, destinatarios, MAX_PENDIENTES_POR_CONCESION } from '../src/tools/correoAgente.js';
import {
  buzonDeConcesion,
  codificarAdjunto,
  decodificarAdjunto,
  GraphLectorCorreo,
  limpiarTexto,
  readCorreoMcpConfig,
  urlDeBuzon,
  type LectorCorreo,
  type MensajeTexto,
} from '../src/correo/graph.js';
import { callJson, connectClient, createMockPrisma, type CapturedRawQuery, type MockPrisma } from './helpers.js';

const TOKEN = 'cs_AbCdEfGhIjKlMnOpQrStUvWx';
const ORUS: AuthScope = { agent: 'horus', role: 'admin', allCompanies: true, companyIds: [] };

interface Estado {
  agentes: Array<{ id_agent: number; code: string; display_name: string; id_subprocess: number | null }>;
  shares: Array<Record<string, unknown>>;
  permiso: number;
  chat: boolean;
  vinculo: number | null;
  pendientes: number;
}

let mock: MockPrisma;
let estado: Estado;
let lecturas: string[];

const hilo: MensajeTexto[] = [
  {
    id: 'MSG-AAAA-0001',
    conversationId: 'CONV-AAAA-0001',
    asunto: 'Contrato de arrendamiento',
    de: { nombre: 'Proveedor', correo: 'proveedor@externo.com' },
    para: [{ nombre: 'Laura', correo: 'laura@gsslatam.com' }],
    cc: [{ nombre: 'Jurídica', correo: 'juridica@gsslatam.com' }],
    fecha: '2026-10-15T14:00:00Z',
    texto: 'Buen día, adjunto el contrato.\n\nDe: Otro <otro@x.com>\nEnviado: ayer\nHistorial viejo',
    conAdjuntos: true,
    adjuntos: [{ id: 'ADJ-AAAA-0001', nombre: 'contrato.txt', tipo: 'text/plain', tamano: 30, enLinea: false }],
  },
];

function lector(mailbox: string): LectorCorreo {
  lecturas.push(mailbox);
  return {
    hilo: async (c) => hilo.map((m) => ({ ...m, conversationId: c })),
    conversacionDe: async (id) => (id === 'MSG-AAAA-0001' ? 'CONV-AAAA-0001' : 'OTRO-HILO-0001'),
    adjuntoMeta: async (_m, a) => ({ id: a, nombre: 'contrato.txt', tipo: 'text/plain', tamano: 30, enLinea: false, esArchivo: true }),
    adjunto: async () => ({ nombre: 'contrato.txt', tipo: 'text/plain', bytes: Buffer.from('CLÁUSULA PRIMERA. Objeto.') }),
  };
}

const norm = (q: CapturedRawQuery) => q.text.replace(/\s+/g, ' ');

function preparar(parcial: Partial<Estado> = {}) {
  estado = {
    agentes: [{ id_agent: 7, code: 'horus', display_name: 'Orus', id_subprocess: 70 }],
    shares: [
      {
        id: 11,
        token: TOKEN,
        id_user: 'u-laura',
        mailbox: 'laura@gsslatam.com',
        conversation_id: 'CONV-AAAA-0001',
        asunto: 'Contrato de arrendamiento',
        id_agent: 7,
        id_chat_conversation: 501,
        expires_at: new Date(Date.now() + 3600_000),
        vigente: 1,
        email: 'laura@gsslatam.com',
        name: 'Laura Ayala',
        isActive: true,
      },
    ],
    permiso: 1,
    chat: true,
    vinculo: null,
    pendientes: 0,
    ...parcial,
  };
  mock = createMockPrisma();
  mock.rawResolvers = [
    (q) => {
      const t = norm(q);
      if (/FROM agent a WHERE LOWER\(a\.code\)/.test(t)) return estado.agentes.filter((a) => a.code === q.values[0]);
      if (/FROM email_agent_share s INNER JOIN \[user\]/.test(t)) return estado.shares.filter((s) => s.token === q.values[0]);
      if (/FROM subprocess_user_company suc/.test(t)) return [{ n: estado.permiso }];
      if (/FROM chat_conversation c/.test(t)) return estado.chat ? [{ id: 501 }] : [];
      if (/FROM email_agent_action WHERE id_share/.test(t)) return [{ n: estado.pendientes }];
      if (/FROM email_thread_link l/.test(t)) return estado.vinculo ? [{ id_request: estado.vinculo }] : [];
      if (/INSERT INTO email_agent_action/.test(t)) return [{ id: 900 }];
      if (/INSERT INTO chat_message/.test(t)) return [{ id: 9100 }];
      return undefined;
    },
  ];
  setPrisma(mock as unknown as PrismaClient);
  lecturas = [];
}

async function cliente(scope: AuthScope = ORUS) {
  const server = new McpServer({ name: 't', version: '1' });
  registerCorreoAgenteTools(server, { scope, audit: { log: async () => {} }, lector });
  return connectClient(server);
}

const auditorias = () => mock.capturedWrite.filter((w) => /INSERT INTO email_audit/.test(w.text)).map((w) => String(w.values[2]));
const escrituras = () => [...mock.capturedWrite, ...mock.capturedRaw].map((w) => norm(w));

beforeEach(() => preparar());

describe('correo_hilo_compartido — alcance por concesión', () => {
  it('con una concesión vigente de ESTE agente devuelve el hilo saneado y lo audita', async () => {
    const c = await cliente();
    const r = await callJson(c, 'correo_hilo_compartido', { share_id: TOKEN });
    expect(r.isError).toBeFalsy();
    const d = r.data as { mensajes: Array<{ texto: string; adjuntos: Array<{ attachment_id: string }> }>; asunto: string };
    expect(d.asunto).toBe('Contrato de arrendamiento');
    // Sin el historial citado.
    expect(d.mensajes[0]!.texto).toBe('Buen día, adjunto el contrato.');
    expect(decodificarAdjunto(d.mensajes[0]!.adjuntos[0]!.attachment_id)).toEqual({ mensajeId: 'MSG-AAAA-0001', adjuntoId: 'ADJ-AAAA-0001' });
    // El buzón sale de la CONCESIÓN.
    expect(lecturas).toEqual(['laura@gsslatam.com']);
    expect(auditorias()).toEqual(['AGENTE_LEER_HILO']);
  });

  it('sin concesión (token desconocido o mal formado) se rechaza sin tocar Graph', async () => {
    const c = await cliente();
    for (const share_id of ['cs_NoExisteNoExisteNoExiste', 'CONV-AAAA-0001-otra-cosa', "cs_x' OR 1=1 --aaaaaaaa"]) {
      const r = await callJson(c, 'correo_hilo_compartido', { share_id });
      expect(r.isError).toBe(true);
      expect(String(r.data)).toContain('Rechazado');
    }
    expect(lecturas).toEqual([]);
    // El token raro viajó como VALOR (o ni siquiera llegó a la base).
    expect(mock.capturedRaw.every((q) => !q.text.includes('OR 1=1'))).toBe(true);
  });

  it('vencida o revocada → mismo rechazo, queda AGENTE_DENEGADO y no se lee el buzón', async () => {
    estado.shares[0]!.vigente = 0;
    const r = await callJson(await cliente(), 'correo_hilo_compartido', { share_id: TOKEN });
    expect(r.isError).toBe(true);
    expect(String(r.data)).toContain(RECHAZO_CONCESION);
    expect(lecturas).toEqual([]);
    expect(auditorias()).toEqual(['AGENTE_DENEGADO']);
  });

  it('la concesión de OTRO agente no sirve (aunque se conozca el share_id)', async () => {
    estado.agentes.push({ id_agent: 8, code: 'nancy', display_name: 'Nancy', id_subprocess: 80 });
    const r = await callJson(await cliente({ agent: 'nancy', role: 'admin', allCompanies: true, companyIds: [] }), 'correo_hilo_compartido', { share_id: TOKEN });
    expect(r.isError).toBe(true);
    expect(String(r.data)).toContain(RECHAZO_CONCESION);
    expect(lecturas).toEqual([]);
    expect(auditorias()).toEqual(['AGENTE_DENEGADO']);
  });

  it('si la persona perdió el agente, está inactiva o el chat ya no existe → rechazo', async () => {
    for (const cambio of [() => (estado.permiso = 0), () => (estado.shares[0]!.isActive = false), () => (estado.chat = false), () => (estado.shares[0]!.email = 'otra@gsslatam.com')]) {
      preparar();
      cambio();
      const r = await callJson(await cliente(), 'correo_hilo_compartido', { share_id: TOKEN });
      expect(r.isError).toBe(true);
      expect(lecturas).toEqual([]);
    }
  });

  it('una llave que no identifica a un agente activo no lee nada', async () => {
    const r = await callJson(await cliente({ agent: 'test-local', role: 'admin', allCompanies: true, companyIds: [] }), 'correo_hilo_compartido', { share_id: TOKEN });
    expect(r.isError).toBe(true);
    expect(String(r.data)).toMatch(/no identifica a un agente/);
    expect(lecturas).toEqual([]);
  });

  it('agentCode de la llave manda sobre el nombre', () => {
    expect(codigoAgente({ agent: 'galileo-key', agentCode: 'Galileo', role: 'agent', allCompanies: false, companyIds: [3] })).toBe('galileo');
    expect(codigoAgente(ORUS)).toBe('horus');
  });
});

describe('correo_adjunto_compartido', () => {
  it('descarga un adjunto del hilo compartido como texto y lo audita', async () => {
    const r = await callJson(await cliente(), 'correo_adjunto_compartido', { share_id: TOKEN, attachment_id: codificarAdjunto('MSG-AAAA-0001', 'ADJ-AAAA-0001') });
    expect(r.isError).toBeFalsy();
    expect((r.data as { contenido: string }).contenido).toContain('CLÁUSULA PRIMERA');
    expect(auditorias()).toEqual(['AGENTE_LEER_ADJUNTO']);
  });

  it('un adjunto de OTRO hilo del mismo buzón se rechaza (anti-IDOR)', async () => {
    const r = await callJson(await cliente(), 'correo_adjunto_compartido', { share_id: TOKEN, attachment_id: codificarAdjunto('MSG-BBBB-0009', 'ADJ-BBBB-0009') });
    expect(r.isError).toBe(true);
    expect(String(r.data)).toMatch(/no pertenece al hilo/);
    expect(auditorias()).toEqual([]);
  });

  it('attachment_id manipulado → rechazo', async () => {
    const r = await callJson(await cliente(), 'correo_adjunto_compartido', { share_id: TOKEN, attachment_id: Buffer.from('../../x\ny\nz').toString('base64url') });
    expect(r.isError).toBe(true);
  });
});

describe('propuestas: el agente PROPONE, la persona decide', () => {
  it('correo_proponer_respuesta deja una acción PENDIENTE + tarjeta en el chat; no envía nada', async () => {
    const r = await callJson(await cliente(), 'correo_proponer_respuesta', { share_id: TOKEN, cuerpo_markdown: 'Cordial saludo,\n\nRecibido. **Gracias**.', responder_a_todos: true });
    expect(r.isError).toBeFalsy();
    expect(r.data).toMatchObject({ propuesta_id: 900, estado: 'PENDIENTE', para: ['proveedor@externo.com', 'juridica@gsslatam.com'] });
    const accion = mock.capturedRaw.find((q) => /INSERT INTO email_agent_action/.test(q.text))!;
    expect(accion.values).toContain('RESPUESTA');
    expect(accion.values).toContain('PENDIENTE');
    expect(JSON.parse(String(accion.values.find((v) => typeof v === 'string' && v.startsWith('{'))))).toMatchObject({ todos: true, cuerpo: 'Cordial saludo,\n\nRecibido. **Gracias**.' });
    const chat = mock.capturedRaw.find((q) => /INSERT INTO chat_message/.test(q.text))!;
    expect(chat.values).toContain(501);
    expect(chat.values).toContain('agent');
    expect(auditorias()).toEqual(['AGENTE_PROPONER']);
    // Ninguna escritura fuera de la acción, el chat, last_message_at y la auditoría.
    const tablas = escrituras().filter((t) => /^\s*(INSERT|UPDATE|DELETE|MERGE)/i.test(t)).map((t) => t.match(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+(\[?\w+\]?)/i)?.[1]);
    expect([...new Set(tablas)].sort()).toEqual(['chat_conversation', 'chat_message', 'email_agent_action', 'email_audit']);
  });

  it('con la concesión vencida no se puede proponer', async () => {
    estado.shares[0]!.vigente = 0;
    const r = await callJson(await cliente(), 'correo_proponer_respuesta', { share_id: TOKEN, cuerpo_markdown: 'Hola', responder_a_todos: false });
    expect(r.isError).toBe(true);
    expect(mock.capturedRaw.some((q) => /INSERT INTO email_agent_action/.test(q.text))).toBe(false);
  });

  it(`tope de ${MAX_PENDIENTES_POR_CONCESION} propuestas pendientes por concesión`, async () => {
    estado.pendientes = MAX_PENDIENTES_POR_CONCESION;
    const r = await callJson(await cliente(), 'correo_agregar_nota', { share_id: TOKEN, texto: 'nota' });
    expect(r.isError).toBe(true);
    expect(String(r.data)).toMatch(/pendientes/);
  });

  it('correo_crear_solicitud_desde_hilo: propone; si el hilo ya está vinculado, rechaza', async () => {
    const ok = await callJson(await cliente(), 'correo_crear_solicitud_desde_hilo', { share_id: TOKEN, proceso: 'Elaboración y revisión de contratos', categoria: 'Jurídica', titulo: 'Revisión contrato', descripcion: 'Revisar el contrato adjunto' });
    expect(ok.data).toMatchObject({ estado: 'PENDIENTE' });
    preparar({ vinculo: 4321 });
    const no = await callJson(await cliente(), 'correo_crear_solicitud_desde_hilo', { share_id: TOKEN, proceso: 10, titulo: 'Otra', descripcion: 'Otra cosa' });
    expect(no.isError).toBe(true);
    expect(String(no.data)).toMatch(/#4321/);
  });

  it('correo_agregar_nota: solo con el hilo vinculado; guarda la solicitud del vínculo', async () => {
    const no = await callJson(await cliente(), 'correo_agregar_nota', { share_id: TOKEN, texto: 'Se revisó el contrato' });
    expect(no.isError).toBe(true);
    preparar({ vinculo: 4321 });
    const ok = await callJson(await cliente(), 'correo_agregar_nota', { share_id: TOKEN, texto: 'Se revisó el contrato' });
    expect(ok.data).toMatchObject({ estado: 'PENDIENTE', id_solicitud: 4321 });
  });

  it('las descripciones de las 5 herramientas están en español y dicen qué NO hacen', async () => {
    const { tools } = await (await cliente()).listTools();
    const porNombre = new Map(tools.map((t) => [t.name, t.description ?? '']));
    expect([...porNombre.keys()].sort()).toEqual(['correo_adjunto_compartido', 'correo_agregar_nota', 'correo_crear_solicitud_desde_hilo', 'correo_hilo_compartido', 'correo_proponer_respuesta']);
    expect(porNombre.get('correo_proponer_respuesta')).toMatch(/NO envía/);
    expect(porNombre.get('correo_crear_solicitud_desde_hilo')).toMatch(/NO crea/);
    expect(porNombre.get('correo_agregar_nota')).toMatch(/NO escribe/);
    expect(porNombre.get('correo_hilo_compartido')).toMatch(/SOLO LECTURA/);
  });
});

describe('lector de Graph: solo GET y solo el buzón de la concesión', () => {
  it('buzonDeConcesion valida y urlDeBuzon no deja escapar a otro buzón', () => {
    const b = buzonDeConcesion('Laura@GssLatam.com');
    expect(b.base).toBe('https://graph.microsoft.com/v1.0/users/laura%40gsslatam.com');
    expect(urlDeBuzon(`${b.base}/messages/x`, b)).toBe(true);
    expect(urlDeBuzon('https://graph.microsoft.com/v1.0/users/otra%40gsslatam.com/messages', b)).toBe(false);
    expect(urlDeBuzon(`${b.base}/../otra@gsslatam.com/messages`, b)).toBe(false);
    expect(urlDeBuzon(`${b.base}%2f..%2fotra`, b)).toBe(false);
    expect(() => buzonDeConcesion('no es un correo')).toThrow();
  });

  it('GraphLectorCorreo hace solo GET bajo /users/{buzón} y pide el cuerpo en texto', async () => {
    const llamadas: Array<{ url: string; method: string; prefer?: string }> = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      llamadas.push({ url: String(url), method: String(init?.method ?? 'GET'), prefer: h.Prefer });
      if (String(url).includes('/attachments')) return new Response(JSON.stringify({ value: [{ id: 'A1', name: 'x.pdf', contentType: 'application/pdf', size: 10, isInline: false }] }));
      return new Response(JSON.stringify({ value: [{ id: 'M1', conversationId: 'C1', subject: 'S', from: { emailAddress: { name: 'X', address: 'X@Y.COM' } }, receivedDateTime: '2026-10-15T10:00:00Z', hasAttachments: true, body: { content: 'hola' } }] }));
    }) as unknown as typeof fetch;
    const l = new GraphLectorCorreo(buzonDeConcesion('laura@gsslatam.com'), async () => 'tok', fetchFn);
    const h = await l.hilo('CONV-AAAA-0001');
    expect(h[0]).toMatchObject({ texto: 'hola', de: { correo: 'x@y.com' }, adjuntos: [{ id: 'A1' }] });
    expect(llamadas.every((c) => c.method === 'GET' && c.url.startsWith('https://graph.microsoft.com/v1.0/users/laura%40gsslatam.com/'))).toBe(true);
    expect(llamadas[0]!.prefer).toBe('outlook.body-content-type="text"');
    await expect(l.hilo("x' or 1 eq 1")).rejects.toThrow();
  });

  it('sin CORREO_* completos no hay inquilino (el MCP no inventa credenciales)', () => {
    expect(readCorreoMcpConfig({ CORREO_MODO: 'graph', CORREO_INQUILINOS: 'gss', CORREO_GSS_TENANT_ID: 'x' }).inquilinos).toEqual([]);
    expect(readCorreoMcpConfig({}).modo).toBe('off');
  });

  it('limpiarTexto quita el historial citado y recorta', () => {
    expect(limpiarTexto('Hola\n\nEl lun, 13 oct 2026 a las 9:00, Pedro escribió:\n> viejo', 100).texto).toBe('Hola');
    expect(limpiarTexto('x'.repeat(50), 10)).toEqual({ texto: `${'x'.repeat(9)}…`, recortado: true });
  });

  it('destinatarios: a todos sin la persona; solo remitente si no', () => {
    expect(destinatarios(hilo[0]!, 'laura@gsslatam.com', true)).toEqual(['proveedor@externo.com', 'juridica@gsslatam.com']);
    expect(destinatarios(hilo[0]!, 'laura@gsslatam.com', false)).toEqual(['proveedor@externo.com']);
  });
});
