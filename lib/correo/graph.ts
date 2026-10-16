import { CORREO_PAGE_SIZE, GRAPH_BASE } from './constants';
import type { Inquilino } from './config';
import { CorreoError } from './errors';
import { insertarSobreHistorial } from './plantillas/acuse.html';
import type {
  AdjuntoInfo,
  ArchivoAdjunto,
  Carpeta,
  Direccion,
  FiltrosBandeja,
  MailProvider,
  MensajeCompleto,
  MensajeResumen,
  PaginaMensajes,
  RespuestaEntrada,
} from './types';

/**
 * Proveedor de Microsoft Graph con la app de APLICACIÓN del inquilino (client
 * credentials). Esa app puede leer CUALQUIER buzón del inquilino, así que el
 * control clave vive aquí: la ÚNICA forma de armar una ruta de buzón es
 * `mailboxForSession(correoDeLaSesión)`, y el proveedor rechaza cualquier URL que
 * no cuelgue de ese buzón. Ninguna ruta de la API recibe un buzón, usuario o UPN
 * del navegador; los ids de mensaje, hilo y adjunto siempre se consultan bajo
 * /users/{correo de la sesión}/, así que un id de otro buzón simplemente da 404.
 * (Prueba de «lint»: lib/correo/__tests__/aislamiento.test.ts.)
 */

type FetchFn = typeof fetch;

const CORREO_SESION_RE = /^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,}$/;

/** Buzón de la sesión. Solo lo crea mailboxForSession: el constructor del proveedor no acepta rutas sueltas. */
export interface Mailbox {
  readonly correo: string;
  /** https://graph.microsoft.com/v1.0/users/<correo codificado> */
  readonly base: string;
  readonly __marca: 'mailbox-de-sesion';
}

/**
 * ÚNICO punto que arma la ruta /users/{correo} de Graph. Recibe el correo de la
 * SESIÓN de SynerLink (nunca un dato del navegador) y lo valida estrictamente.
 */
export function mailboxForSession(correoSesion: string): Mailbox {
  const correo = String(correoSesion ?? '').trim().toLowerCase();
  if (!CORREO_SESION_RE.test(correo)) throw new CorreoError('El correo de su usuario no es válido para el módulo Correo.', 400);
  return { correo, base: `${GRAPH_BASE}/users/${encodeURIComponent(correo)}`, __marca: 'mailbox-de-sesion' };
}

/** ¿La URL pertenece al buzón? Compara la ruta DECODIFICADA (Graph puede devolver «@» o «%40»). */
export function urlDelBuzon(url: string, mailbox: Mailbox): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.host !== 'graph.microsoft.com' || u.username || u.password || u.port) return false;
  // Sin barras codificadas ni segmentos «..»: la ruta decodificada no puede escapar del buzón.
  if (/%2f|%5c|%00/i.test(u.pathname)) return false;
  let ruta: string;
  try {
    ruta = decodeURIComponent(u.pathname).toLowerCase();
  } catch {
    return false;
  }
  if (/(^|\/)\.{1,2}(\/|$)|\\/.test(ruta)) return false;
  const prefijo = `/v1.0/users/${mailbox.correo}`;
  return ruta === prefijo || ruta.startsWith(`${prefijo}/`);
}

interface TokenCache {
  token: string;
  expira: number;
  pendiente: Promise<string> | null;
}
const tokens: Map<string, TokenCache> =
  ((globalThis as Record<string, unknown>).__correoTokensApp as never) ??
  ((globalThis as Record<string, unknown>).__correoTokensApp = new Map());

/** Solo pruebas: vacía la caché de tokens. */
export function limpiarTokensApp(): void {
  tokens.clear();
}

/**
 * Token de APLICACIÓN del inquilino, en caché SOLO en la memoria del servidor (nunca
 * en base de datos ni en el navegador); se renueva 5 minutos antes de vencer.
 */
export async function tokenApp(inq: Inquilino, fetchFn: FetchFn = fetch, now = Date.now()): Promise<string> {
  const k = `${inq.tenantId}:${inq.clientId}`;
  const c = tokens.get(k);
  if (c && c.token && now < c.expira - 5 * 60_000) return c.token;
  if (c?.pendiente) return c.pendiente;
  const pendiente = (async () => {
    const res = await fetchFn(`https://login.microsoftonline.com/${encodeURIComponent(inq.tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: inq.clientId, client_secret: inq.clientSecret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || typeof data.access_token !== 'string') {
      const code = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`;
      throw new CorreoError(`No se pudo autenticar el módulo Correo ante Microsoft (${code}). Avise a Tecnología.`, 502);
    }
    tokens.set(k, { token: data.access_token, expira: now + (Number(data.expires_in) || 3600) * 1000, pendiente: null });
    return data.access_token;
  })();
  tokens.set(k, { token: '', expira: 0, pendiente });
  try {
    return await pendiente;
  } catch (e) {
    tokens.delete(k);
    throw e;
  }
}

const SELECT_RESUMEN = 'id,conversationId,internetMessageId,subject,from,receivedDateTime,isRead,hasAttachments,bodyPreview,categories';
const SELECT_COMPLETO = `${SELECT_RESUMEN},toRecipients,ccRecipients,body`;
/** Imágenes incrustadas: tope total por mensaje para pasarlas a data: URI. */
const MAX_CID_TOTAL = 5 * 1024 * 1024;

/** Ids de Graph: base64 con variantes URL. */
const ID_RE = /^[A-Za-z0-9+=_-]{8,512}$/;
export function assertGraphId(id: string, que = 'identificador'): string {
  const v = String(id ?? '').trim();
  if (!ID_RE.test(v)) throw new CorreoError(`El ${que} del correo no es válido.`, 400);
  return v;
}

/** Comilla simple de OData: se duplica. */
function odataString(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const CORREO_RE = /^[^\s@'"<>]{1,64}@[^\s@'"<>]{1,255}$/;

export function normalizarFiltros(f: FiltrosBandeja): FiltrosBandeja {
  const fecha = (v?: string | null) => (v && FECHA_RE.test(v) ? v : null);
  const de = f.de ? String(f.de).trim().toLowerCase() : null;
  const buscar = f.buscar ? String(f.buscar).replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) : null;
  return {
    carpetaId: f.carpetaId ? assertGraphId(f.carpetaId, 'identificador de carpeta') : null,
    desde: fecha(f.desde),
    hasta: fecha(f.hasta),
    de: de && CORREO_RE.test(de) ? de : null,
    noLeidos: Boolean(f.noLeidos),
    conAdjuntos: Boolean(f.conAdjuntos),
    buscar: buscar || null,
  };
}

/** URL de la primera página de la bandeja según los filtros (función pura, probada aparte). */
export function urlBandeja(mailbox: Mailbox, filtros: FiltrosBandeja): string {
  const f = normalizarFiltros(filtros);
  const base = f.carpetaId ? `${mailbox.base}/mailFolders/${encodeURIComponent(f.carpetaId)}/messages` : `${mailbox.base}/mailFolders/inbox/messages`;
  const u = new URL(base);
  u.searchParams.set('$select', SELECT_RESUMEN);
  u.searchParams.set('$top', String(CORREO_PAGE_SIZE));
  if (f.buscar) {
    // $search (KQL) no admite $filter ni $orderby: los demás filtros van como KQL.
    const kql: string[] = [f.buscar];
    if (f.de) kql.push(`from:${f.de}`);
    if (f.desde) kql.push(`received>=${f.desde}`);
    if (f.hasta) kql.push(`received<=${f.hasta}`);
    if (f.conAdjuntos) kql.push('hasattachments:true');
    if (f.noLeidos) kql.push('isread:false');
    u.searchParams.set('$search', `"${kql.join(' ')}"`);
    return u.toString();
  }
  // Graph exige que la propiedad de $orderby aparezca primero en $filter.
  const filtro: string[] = [`receivedDateTime ge ${f.desde ? `${f.desde}T00:00:00Z` : '1900-01-01T00:00:00Z'}`];
  if (f.hasta) filtro.push(`receivedDateTime le ${f.hasta}T23:59:59Z`);
  if (f.de) filtro.push(`from/emailAddress/address eq ${odataString(f.de)}`);
  if (f.noLeidos) filtro.push('isRead eq false');
  if (f.conAdjuntos) filtro.push('hasAttachments eq true');
  u.searchParams.set('$filter', filtro.join(' and '));
  u.searchParams.set('$orderby', 'receivedDateTime desc');
  return u.toString();
}

/**
 * El cursor de la página siguiente solo puede ser un @odata.nextLink del buzón DE LA
 * SESIÓN en graph.microsoft.com (evita leer otro buzón, SSRF y fuga del token).
 */
export function validarCursor(cursor: string, mailbox: Mailbox): string {
  const url = Buffer.from(String(cursor ?? ''), 'base64url').toString('utf8');
  if (!urlDelBuzon(url, mailbox)) throw new CorreoError('Cursor de página inválido.', 400);
  return new URL(url).toString();
}

export function codificarCursor(nextLink: string | undefined | null): string | null {
  return nextLink ? Buffer.from(nextLink, 'utf8').toString('base64url') : null;
}

type GraphAddr = { emailAddress?: { name?: string; address?: string } } | null | undefined;
function dir(a: GraphAddr): Direccion {
  const correo = String(a?.emailAddress?.address ?? '').trim().toLowerCase();
  return { nombre: String(a?.emailAddress?.name ?? '').trim() || correo, correo };
}

type GraphMsg = Record<string, unknown>;
export function aResumen(m: GraphMsg): MensajeResumen {
  return {
    id: String(m.id ?? ''),
    conversationId: String(m.conversationId ?? ''),
    internetMessageId: String(m.internetMessageId ?? ''),
    asunto: String(m.subject ?? ''),
    de: dir(m.from as GraphAddr),
    fecha: String(m.receivedDateTime ?? ''),
    leido: Boolean(m.isRead),
    conAdjuntos: Boolean(m.hasAttachments),
    extracto: String(m.bodyPreview ?? ''),
    categorias: Array.isArray(m.categories) ? (m.categories as unknown[]).map(String) : [],
  };
}

function aCompleto(m: GraphMsg): MensajeCompleto {
  const body = (m.body ?? {}) as { contentType?: string; content?: string };
  const content = String(body.content ?? '');
  const html =
    String(body.contentType ?? '').toLowerCase() === 'html'
      ? content
      : `<p>${content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br>')}</p>`;
  return {
    ...aResumen(m),
    para: Array.isArray(m.toRecipients) ? (m.toRecipients as GraphAddr[]).map(dir) : [],
    cc: Array.isArray(m.ccRecipients) ? (m.ccRecipients as GraphAddr[]).map(dir) : [],
    html,
    adjuntos: [],
  };
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Texto de la respuesta (plano) a HTML seguro con saltos de línea. */
export function textoAHtml(texto: string): string {
  return escHtml(texto).replace(/\r?\n/g, '<br>');
}

export class GraphMailProvider implements MailProvider {
  private readonly me: string;

  constructor(
    private readonly mailbox: Mailbox,
    private readonly token: () => Promise<string>,
    private readonly fetchFn: FetchFn = fetch
  ) {
    if (mailbox?.__marca !== 'mailbox-de-sesion') throw new CorreoError('Buzón no permitido.', 500);
    this.me = mailbox.base;
  }

  private async call(url: string, init: RequestInit = {}, prefer?: string): Promise<Response> {
    // Defensa en profundidad: aunque alguien arme una URL a mano, solo sale hacia el buzón de la sesión.
    if (!urlDelBuzon(url, this.mailbox)) throw new CorreoError('Destino de Graph no permitido.', 500);
    const token = await this.token();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...(init.headers as Record<string, string>) };
    if (prefer) headers.Prefer = prefer;
    const res = await this.fetchFn(url, { ...init, headers });
    if (res.ok) return res;
    if (res.status === 401) throw new CorreoError('Microsoft rechazó la autenticación del módulo Correo. Avise a Tecnología.', 502);
    if (res.status === 403) throw new CorreoError('Microsoft no autorizó la operación (permiso de la app o política del buzón). Avise a Tecnología.', 403);
    if (res.status === 404) throw new CorreoError('No se encontró el correo en su buzón (pudo moverse o borrarse).', 404);
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after')) || 10;
      throw new CorreoError(`Microsoft limitó las consultas. Intente de nuevo en ${ra} s.`, 429);
    }
    throw new CorreoError(`Microsoft respondió con un error (${res.status}).`, 502);
  }

  private async json<T = Record<string, unknown>>(url: string, init?: RequestInit, prefer?: string): Promise<T> {
    const res = await this.call(url, init, prefer);
    return (await res.json()) as T;
  }

  async perfil() {
    return { correo: this.mailbox.correo };
  }

  async carpetas(): Promise<Carpeta[]> {
    const data = await this.json<{ value?: GraphMsg[] }>(
      `${this.me}/mailFolders?$top=100&$select=id,displayName,totalItemCount,unreadItemCount`
    );
    return (data.value ?? []).map((c) => ({
      id: String(c.id),
      nombre: String(c.displayName ?? ''),
      total: Number(c.totalItemCount) || 0,
      noLeidos: Number(c.unreadItemCount) || 0,
    }));
  }

  /** Solo el contador de la Bandeja de entrada (consulta mínima, sin contenido). */
  async noLeidosBandeja(): Promise<number> {
    const data = await this.json<{ unreadItemCount?: number }>(`${this.me}/mailFolders/inbox?$select=unreadItemCount`);
    return Math.max(0, Number(data.unreadItemCount) || 0);
  }

  async mensajes(filtros: FiltrosBandeja, cursor?: string | null): Promise<PaginaMensajes> {
    const url = cursor ? validarCursor(cursor, this.mailbox) : urlBandeja(this.mailbox, filtros);
    const data = await this.json<{ value?: GraphMsg[]; '@odata.nextLink'?: string }>(url);
    return { mensajes: (data.value ?? []).map(aResumen), siguiente: codificarCursor(data['@odata.nextLink']) };
  }

  private async adjuntosDe(m: MensajeCompleto): Promise<MensajeCompleto> {
    if (!m.conAdjuntos && !/\bcid:/i.test(m.html)) return m;
    const base = `${this.me}/messages/${encodeURIComponent(m.id)}/attachments`;
    const conCid = /\bcid:/i.test(m.html);
    // Sin imágenes incrustadas basta la lista liviana (sin bytes).
    const data = await this.json<{ value?: GraphMsg[] }>(conCid ? base : `${base}?$select=id,name,contentType,size,isInline`);
    const adjuntos: AdjuntoInfo[] = [];
    const imagenesCid: Record<string, string> = {};
    let total = 0;
    for (const a of data.value ?? []) {
      const info: AdjuntoInfo = {
        id: String(a.id),
        nombre: String(a.name ?? 'adjunto'),
        tipo: String(a.contentType ?? 'application/octet-stream'),
        tamano: Number(a.size) || 0,
        enLinea: Boolean(a.isInline),
      };
      const cid = typeof a.contentId === 'string' ? a.contentId.replace(/^<|>$/g, '') : '';
      const bytes = typeof a.contentBytes === 'string' ? a.contentBytes : '';
      if (conCid && cid && bytes && /^image\/(png|jpe?g|gif)$/i.test(info.tipo) && total + bytes.length <= MAX_CID_TOTAL) {
        imagenesCid[cid.toLowerCase()] = `data:${info.tipo.toLowerCase()};base64,${bytes}`;
        total += bytes.length;
      }
      if (!info.enLinea) adjuntos.push(info);
    }
    return { ...m, adjuntos, imagenesCid };
  }

  async hilo(conversationId: string): Promise<MensajeCompleto[]> {
    const id = assertGraphId(conversationId, 'identificador del hilo');
    const u = new URL(`${this.me}/messages`);
    u.searchParams.set('$filter', `conversationId eq ${odataString(id)}`);
    u.searchParams.set('$select', SELECT_COMPLETO);
    u.searchParams.set('$top', '50');
    const data = await this.json<{ value?: GraphMsg[] }>(u.toString(), undefined, 'outlook.body-content-type="html"');
    // Graph no admite $orderby con este $filter: se ordena aquí (más antiguo primero).
    const msgs = (data.value ?? []).map(aCompleto).sort((a, b) => a.fecha.localeCompare(b.fecha));
    return Promise.all(msgs.map((m) => this.adjuntosDe(m)));
  }

  async mensaje(id: string): Promise<MensajeCompleto> {
    const mid = assertGraphId(id);
    const m = await this.json<GraphMsg>(
      `${this.me}/messages/${encodeURIComponent(mid)}?$select=${SELECT_COMPLETO}`,
      undefined,
      'outlook.body-content-type="html"'
    );
    return this.adjuntosDe(aCompleto(m));
  }

  async adjunto(mensajeId: string, adjuntoId: string): Promise<ArchivoAdjunto> {
    const base = `${this.me}/messages/${encodeURIComponent(assertGraphId(mensajeId))}/attachments/${encodeURIComponent(assertGraphId(adjuntoId, 'identificador del adjunto'))}`;
    const meta = await this.json<GraphMsg>(`${base}?$select=id,name,contentType,size`);
    if (String(meta['@odata.type'] ?? '#microsoft.graph.fileAttachment') !== '#microsoft.graph.fileAttachment') {
      throw new CorreoError('Este adjunto no es un archivo (es un elemento de Outlook) y no se puede descargar.', 415);
    }
    const res = await this.call(`${base}/$value`);
    return {
      nombre: String(meta.name ?? 'adjunto'),
      tipo: String(meta.contentType ?? 'application/octet-stream'),
      bytes: Buffer.from(await res.arrayBuffer()),
    };
  }

  async responder(mensajeId: string, entrada: RespuestaEntrada): Promise<void> {
    const mid = encodeURIComponent(assertGraphId(mensajeId));
    const json = { 'Content-Type': 'application/json' };
    if (entrada.html) {
      await this.responderConHtml(mid, entrada, entrada.html);
      return;
    }
    const comment = textoAHtml(entrada.texto);
    if (entrada.adjuntos.length === 0) {
      await this.call(`${this.me}/messages/${mid}/${entrada.todos ? 'replyAll' : 'reply'}`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ comment }),
      });
      return;
    }
    // Con adjuntos: borrador de respuesta → adjuntos → enviar.
    const draft = await this.json<{ id?: string }>(`${this.me}/messages/${mid}/${entrada.todos ? 'createReplyAll' : 'createReply'}`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ comment }),
    });
    const draftId = encodeURIComponent(assertGraphId(String(draft.id ?? '')));
    for (const a of entrada.adjuntos) {
      await this.call(`${this.me}/messages/${draftId}/attachments`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: a.nombre,
          contentType: a.tipo,
          contentBytes: a.bytes.toString('base64'),
        }),
      });
    }
    await this.call(`${this.me}/messages/${draftId}/send`, { method: 'POST' });
  }

  /**
   * Respuesta con cuerpo HTML propio (acuse con plantilla): createReply(All) → PATCH del cuerpo con
   * el bloque ENCIMA del historial citado que trae el borrador → adjuntos → send. Si algo falla
   * antes de enviar, el borrador se borra para no dejarlo en Borradores.
   */
  private async responderConHtml(mid: string, entrada: RespuestaEntrada, fragmento: string): Promise<void> {
    const json = { 'Content-Type': 'application/json' };
    const html = 'outlook.body-content-type="html"';
    const draft = await this.json<{ id?: string; body?: { contentType?: string; content?: string } }>(
      `${this.me}/messages/${mid}/${entrada.todos ? 'createReplyAll' : 'createReply'}`,
      { method: 'POST', headers: json, body: JSON.stringify({}) },
      html
    );
    const draftId = encodeURIComponent(assertGraphId(String(draft.id ?? '')));
    const url = `${this.me}/messages/${draftId}`;
    try {
      let cuerpo = draft.body?.content;
      if (cuerpo == null || String(draft.body?.contentType ?? '').toLowerCase() !== 'html') {
        const leido = await this.json<{ body?: { content?: string } }>(`${url}?$select=body`, undefined, html);
        cuerpo = leido.body?.content ?? '';
      }
      await this.call(url, {
        method: 'PATCH',
        headers: json,
        body: JSON.stringify({ body: { contentType: 'HTML', content: insertarSobreHistorial(cuerpo, fragmento) } }),
      });
      for (const a of entrada.adjuntos) {
        await this.call(`${url}/attachments`, {
          method: 'POST',
          headers: json,
          body: JSON.stringify({
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: a.nombre,
            contentType: a.tipo,
            contentBytes: a.bytes.toString('base64'),
          }),
        });
      }
    } catch (e) {
      await this.call(url, { method: 'DELETE' }).catch(() => undefined);
      throw e;
    }
    await this.call(`${url}/send`, { method: 'POST' });
  }

  async categorizar(mensajeId: string, categoria: string): Promise<void> {
    const url = `${this.me}/messages/${encodeURIComponent(assertGraphId(mensajeId))}`;
    const actual = await this.json<{ categories?: string[] }>(`${url}?$select=categories`);
    const cats = Array.isArray(actual.categories) ? actual.categories : [];
    if (cats.includes(categoria)) return;
    await this.call(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categories: [...cats, categoria] }),
    });
  }
}
