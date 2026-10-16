/**
 * Lectura de Microsoft Graph para «Consultar a un agente» (kronos-mcp).
 *
 * SOLO LECTURA (GET) de UN buzón: el de la CONCESIÓN (email_agent_share.mailbox), que a su vez
 * salió de la sesión de la persona cuando compartió el hilo. El agente nunca pasa un buzón: la
 * ÚNICA forma de armar la ruta /users/{buzón} es `buzonDeConcesion(fila.mailbox)`, y cada URL se
 * vuelve a validar contra ese buzón antes de salir (mismo control que lib/correo/graph.ts del front).
 *
 * Usa la misma app de APLICACIÓN del inquilino que el módulo Correo (variables CORREO_*; en los
 * servidores serve.mjs las toma del .env del front si mcp/.env no las trae). Este módulo no tiene
 * ningún método de escritura: enviar, responder o crear lo hace SOLO el front, con el clic y la
 * sesión de la persona.
 */

export type CorreoModo = 'off' | 'mock' | 'graph';

export interface InquilinoCorreo {
  clave: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  dominios: string[];
}

export interface CorreoMcpConfig {
  modo: CorreoModo;
  inquilinos: InquilinoCorreo[];
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const lista = (v: string | undefined) =>
  String(v ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/** Mismas variables que lib/correo/config.ts del front (nunca se registran ni se devuelven). */
export function readCorreoMcpConfig(env: NodeJS.ProcessEnv = process.env): CorreoMcpConfig {
  const raw = String(env.CORREO_MODO ?? 'off').trim().toLowerCase();
  const modo: CorreoModo = raw === 'mock' || raw === 'graph' ? raw : 'off';
  const inquilinos: InquilinoCorreo[] = [];
  for (const clave of lista(env.CORREO_INQUILINOS).filter((c) => /^[a-z0-9]{2,20}$/.test(c))) {
    const K = clave.toUpperCase();
    const i = {
      clave,
      tenantId: String(env[`CORREO_${K}_TENANT_ID`] ?? '').trim(),
      clientId: String(env[`CORREO_${K}_CLIENT_ID`] ?? '').trim(),
      clientSecret: String(env[`CORREO_${K}_CLIENT_SECRET`] ?? '').trim(),
      dominios: lista(env[`CORREO_${K}_DOMINIOS`]).map((d) => d.replace(/^@/, '')),
    };
    if (GUID_RE.test(i.tenantId) && GUID_RE.test(i.clientId) && i.clientSecret && i.dominios.length) inquilinos.push(i);
  }
  return { modo, inquilinos };
}

export function inquilinoDe(cfg: CorreoMcpConfig, correo: string): InquilinoCorreo | null {
  const dominio = String(correo ?? '').toLowerCase().split('@')[1] ?? '';
  return cfg.inquilinos.find((i) => i.dominios.includes(dominio)) ?? null;
}

const GRAPH = 'https://graph.microsoft.com/v1.0';
const CORREO_RE = /^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,}$/;
const ID_RE = /^[A-Za-z0-9+=_-]{8,512}$/;

export class CorreoMcpError extends Error {}

/** Buzón de la CONCESIÓN. Único lugar que arma /users/{buzón}. */
export interface BuzonConcesion {
  readonly correo: string;
  readonly base: string;
  readonly __marca: 'buzon-de-concesion';
}

export function buzonDeConcesion(mailbox: string): BuzonConcesion {
  const correo = String(mailbox ?? '').trim().toLowerCase();
  if (!CORREO_RE.test(correo)) throw new CorreoMcpError('El buzón de la concesión no es válido.');
  return { correo, base: `${GRAPH}/users/${encodeURIComponent(correo)}`, __marca: 'buzon-de-concesion' };
}

/** ¿La URL cuelga del buzón? (ruta decodificada, sin «..» ni barras codificadas). */
export function urlDeBuzon(url: string, b: BuzonConcesion): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.host !== 'graph.microsoft.com' || u.username || u.password || u.port) return false;
  if (/%2f|%5c|%00/i.test(u.pathname)) return false;
  let ruta: string;
  try {
    ruta = decodeURIComponent(u.pathname).toLowerCase();
  } catch {
    return false;
  }
  if (/(^|\/)\.{1,2}(\/|$)|\\/.test(ruta)) return false;
  const prefijo = `/v1.0/users/${b.correo}`;
  return ruta === prefijo || ruta.startsWith(`${prefijo}/`);
}

export function assertGraphId(id: string, que = 'identificador'): string {
  const v = String(id ?? '').trim();
  if (!ID_RE.test(v)) throw new CorreoMcpError(`El ${que} no es válido.`);
  return v;
}

export interface Direccion {
  nombre: string;
  correo: string;
}

export interface AdjuntoMeta {
  id: string;
  nombre: string;
  tipo: string;
  tamano: number;
  enLinea: boolean;
}

export interface MensajeTexto {
  id: string;
  conversationId: string;
  asunto: string;
  de: Direccion;
  para: Direccion[];
  cc: Direccion[];
  fecha: string;
  /** Cuerpo en TEXTO (Graph lo convierte con Prefer: outlook.body-content-type="text"). */
  texto: string;
  conAdjuntos: boolean;
  adjuntos: AdjuntoMeta[];
}

export interface ArchivoAdjunto {
  nombre: string;
  tipo: string;
  bytes: Buffer;
}

/** Proveedor de SOLO LECTURA de un buzón de concesión. */
export interface LectorCorreo {
  hilo(conversationId: string): Promise<MensajeTexto[]>;
  /** Mensaje (sin cuerpo) para comprobar a qué hilo pertenece. */
  conversacionDe(mensajeId: string): Promise<string>;
  adjuntoMeta(mensajeId: string, adjuntoId: string): Promise<AdjuntoMeta & { esArchivo: boolean }>;
  adjunto(mensajeId: string, adjuntoId: string): Promise<ArchivoAdjunto>;
}

type FetchFn = typeof fetch;
type G = Record<string, unknown>;

const tokens = new Map<string, { token: string; expira: number }>();

async function tokenApp(i: InquilinoCorreo, fetchFn: FetchFn): Promise<string> {
  const k = `${i.tenantId}:${i.clientId}`;
  const c = tokens.get(k);
  if (c && Date.now() < c.expira - 5 * 60_000) return c.token;
  const res = await fetchFn(`https://login.microsoftonline.com/${encodeURIComponent(i.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: i.clientId, client_secret: i.clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
  });
  const d = (await res.json().catch(() => ({}))) as G;
  if (!res.ok || typeof d.access_token !== 'string') throw new CorreoMcpError(`No se pudo autenticar ante Microsoft (${typeof d.error === 'string' ? d.error : `HTTP ${res.status}`}).`);
  tokens.set(k, { token: d.access_token, expira: Date.now() + (Number(d.expires_in) || 3600) * 1000 });
  return d.access_token;
}

const dir = (x: unknown): Direccion => {
  const e = ((x as G | undefined)?.emailAddress ?? {}) as G;
  return { nombre: String(e.name ?? ''), correo: String(e.address ?? '').toLowerCase() };
};

const SELECT = 'id,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,hasAttachments,body';

export class GraphLectorCorreo implements LectorCorreo {
  constructor(
    private readonly buzon: BuzonConcesion,
    private readonly token: () => Promise<string>,
    private readonly fetchFn: FetchFn = fetch
  ) {
    if (buzon?.__marca !== 'buzon-de-concesion') throw new CorreoMcpError('Buzón no permitido.');
  }

  private async get(url: string, prefer?: string): Promise<Response> {
    if (!urlDeBuzon(url, this.buzon)) throw new CorreoMcpError('Destino de Graph no permitido.');
    const headers: Record<string, string> = { Authorization: `Bearer ${await this.token()}` };
    if (prefer) headers.Prefer = prefer;
    const res = await this.fetchFn(url, { method: 'GET', headers });
    if (res.ok) return res;
    if (res.status === 404) throw new CorreoMcpError('No se encontró el correo en el buzón (pudo moverse o borrarse).');
    if (res.status === 429) throw new CorreoMcpError('Microsoft limitó las consultas. Intente de nuevo en unos segundos.');
    throw new CorreoMcpError(`Microsoft respondió con un error (${res.status}).`);
  }

  async hilo(conversationId: string): Promise<MensajeTexto[]> {
    const id = assertGraphId(conversationId, 'identificador del hilo');
    const u = new URL(`${this.buzon.base}/messages`);
    u.searchParams.set('$filter', `conversationId eq '${id.replace(/'/g, "''")}'`);
    u.searchParams.set('$select', SELECT);
    u.searchParams.set('$top', '50');
    const d = (await (await this.get(u.toString(), 'outlook.body-content-type="text"')).json()) as { value?: G[] };
    const msgs = (d.value ?? []).map((m) => ({
      id: String(m.id),
      conversationId: String(m.conversationId ?? ''),
      asunto: String(m.subject ?? ''),
      de: dir(m.from),
      para: ((m.toRecipients as unknown[]) ?? []).map(dir),
      cc: ((m.ccRecipients as unknown[]) ?? []).map(dir),
      fecha: String(m.receivedDateTime ?? ''),
      texto: String(((m.body as G | undefined)?.content as string) ?? ''),
      conAdjuntos: Boolean(m.hasAttachments),
      adjuntos: [] as AdjuntoMeta[],
    }));
    msgs.sort((a, b) => a.fecha.localeCompare(b.fecha));
    for (const m of msgs) {
      if (!m.conAdjuntos) continue;
      const a = (await (await this.get(`${this.buzon.base}/messages/${encodeURIComponent(m.id)}/attachments?$select=id,name,contentType,size,isInline`)).json()) as { value?: G[] };
      m.adjuntos = (a.value ?? [])
        .map((x) => ({ id: String(x.id), nombre: String(x.name ?? 'adjunto'), tipo: String(x.contentType ?? 'application/octet-stream'), tamano: Number(x.size) || 0, enLinea: Boolean(x.isInline) }))
        .filter((x) => !x.enLinea);
    }
    return msgs;
  }

  async conversacionDe(mensajeId: string): Promise<string> {
    const m = (await (await this.get(`${this.buzon.base}/messages/${encodeURIComponent(assertGraphId(mensajeId))}?$select=id,conversationId`)).json()) as G;
    return String(m.conversationId ?? '');
  }

  private baseAdjunto(mensajeId: string, adjuntoId: string): string {
    return `${this.buzon.base}/messages/${encodeURIComponent(assertGraphId(mensajeId))}/attachments/${encodeURIComponent(assertGraphId(adjuntoId, 'identificador del adjunto'))}`;
  }

  async adjuntoMeta(mensajeId: string, adjuntoId: string) {
    const m = (await (await this.get(`${this.baseAdjunto(mensajeId, adjuntoId)}?$select=id,name,contentType,size,isInline`)).json()) as G;
    return {
      id: String(m.id),
      nombre: String(m.name ?? 'adjunto'),
      tipo: String(m.contentType ?? 'application/octet-stream'),
      tamano: Number(m.size) || 0,
      enLinea: Boolean(m.isInline),
      esArchivo: String(m['@odata.type'] ?? '#microsoft.graph.fileAttachment') === '#microsoft.graph.fileAttachment',
    };
  }

  async adjunto(mensajeId: string, adjuntoId: string): Promise<ArchivoAdjunto> {
    const meta = await this.adjuntoMeta(mensajeId, adjuntoId);
    const res = await this.get(`${this.baseAdjunto(mensajeId, adjuntoId)}/$value`);
    return { nombre: meta.nombre, tipo: meta.tipo, bytes: Buffer.from(await res.arrayBuffer()) };
  }
}

/** Buzón simulado (CORREO_MODO=mock: pruebas y CI). Mismo hilo para cualquier conversación. */
export class MockLectorCorreo implements LectorCorreo {
  constructor(private readonly buzon: BuzonConcesion) {}
  async hilo(conversationId: string): Promise<MensajeTexto[]> {
    return [
      {
        id: 'MOCK-MSG-0001',
        conversationId,
        asunto: 'Revisión de contrato de arrendamiento',
        de: { nombre: 'Usuario Uno', correo: 'uno@gsslatam.com' },
        para: [{ nombre: '', correo: this.buzon.correo }],
        cc: [],
        fecha: '2026-10-15T14:00:00Z',
        texto: 'Buen día. Adjunto el contrato para revisión.\n\nGracias.',
        conAdjuntos: true,
        adjuntos: [{ id: 'MOCK-ADJ-0001', nombre: 'contrato.txt', tipo: 'text/plain', tamano: 42, enLinea: false }],
      },
    ];
  }
  async conversacionDe(): Promise<string> {
    return 'MOCK-CONV';
  }
  async adjuntoMeta(_m: string, adjuntoId: string) {
    return { id: adjuntoId, nombre: 'contrato.txt', tipo: 'text/plain', tamano: 42, enLinea: false, esArchivo: true };
  }
  async adjunto(): Promise<ArchivoAdjunto> {
    return { nombre: 'contrato.txt', tipo: 'text/plain', bytes: Buffer.from('CONTRATO DE ARRENDAMIENTO (simulado)\n') };
  }
}

/** Lector del buzón de la concesión según la configuración (o null si el Correo no está habilitado aquí). */
export function lectorDeConcesion(mailbox: string, cfg: CorreoMcpConfig = readCorreoMcpConfig(), fetchFn: FetchFn = fetch): LectorCorreo {
  const b = buzonDeConcesion(mailbox);
  if (cfg.modo === 'mock') return new MockLectorCorreo(b);
  if (cfg.modo !== 'graph') throw new CorreoMcpError('El módulo Correo no está habilitado en este servidor MCP (CORREO_MODO).');
  const i = inquilinoDe(cfg, b.correo);
  if (!i) throw new CorreoMcpError('El buzón de la concesión no pertenece a un inquilino habilitado para el Correo.');
  return new GraphLectorCorreo(b, () => tokenApp(i, fetchFn), fetchFn);
}

/** Texto del correo sin el historial citado (Outlook, Gmail, Apple), con topes. */
export function limpiarTexto(t: string, max: number): { texto: string; recortado: boolean } {
  let s = String(t ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  const cortes = [
    /\n_{8,}\s*\n(De|From):/,
    /\n-----\s*(Original Message|Mensaje original)\s*-----/i,
    /\n(De|From):\s.+\n(Enviado|Sent|Fecha|Date):\s/,
    /\n(El|On)\s.{5,200}(escribió|wrote):/,
  ];
  for (const re of cortes) {
    const i = s.search(re);
    if (i > 0) s = s.slice(0, i);
  }
  s = s
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s.length > max ? { texto: `${s.slice(0, max - 1)}…`, recortado: true } : { texto: s, recortado: false };
}

/** attachment_id opaco para el agente: mensaje + adjunto (se valida contra el hilo al descargar). */
export function codificarAdjunto(mensajeId: string, adjuntoId: string): string {
  return Buffer.from(`${mensajeId}\n${adjuntoId}`, 'utf8').toString('base64url');
}

export function decodificarAdjunto(v: string): { mensajeId: string; adjuntoId: string } {
  let raw = '';
  try {
    raw = Buffer.from(String(v ?? ''), 'base64url').toString('utf8');
  } catch {
    raw = '';
  }
  const [mensajeId = '', adjuntoId = '', ...resto] = raw.split('\n');
  if (resto.length || !ID_RE.test(mensajeId) || !ID_RE.test(adjuntoId)) throw new CorreoMcpError('El attachment_id no es válido.');
  return { mensajeId, adjuntoId };
}
