import { CORREO_PAGE_SIZE, GRAPH_BASE, GRAPH_BATCH_MAX } from './constants';
import type { Inquilino } from './config';
import { esDestinatarioValido } from './destinatarios';
import { CorreoError } from './errors';
import { conReintentos, esReintentable, esperaReintento, leerRetryAfter, limitadorBuzones, POLITICA_GRAPH, type LimitadorConcurrencia, type PoliticaReintento } from './graphResiliencia';
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
  NuevoCorreoEntrada,
  PaginaMensajes,
  RespuestaEntrada,
  UbicacionMensaje,
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
const SELECT_COMPLETO = `${SELECT_RESUMEN},toRecipients,ccRecipients,body,webLink`;
/**
 * Metadatos de TODOS los adjuntos en la MISMA consulta del hilo (sin bytes). contentId solo existe en
 * fileAttachment, de ahí el «cast» (probado contra Graph v1.0 el 2026-10-16).
 */
export const EXPAND_ADJUNTOS = 'attachments($select=id,name,contentType,size,isInline,microsoft.graph.fileAttachment/contentId)';
/** Imágenes que se pueden incrustar como data: URI. */
const IMAGEN_CID_RE = /^image\/(png|jpe?g|gif)$/i;
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

/** Sub-petición de `$batch` (ruta RELATIVA de rutaMensaje, siempre del buzón de la sesión). */
interface SubPeticionLote {
  id: string;
  method: 'GET' | 'PATCH' | 'POST';
  url: string;
  body?: unknown;
}
interface RespuestaLote {
  status: number;
  retryAfter: number;
  body: GraphMsg | null;
}
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
  // Adjuntos que vinieron en la misma consulta ($expand=attachments, sin bytes): los visibles van a la
  // lista; las imágenes incrustadas (cid) quedan PENDIENTES y se piden solo para los mensajes desplegados.
  const expandidos = Array.isArray(m.attachments) ? (m.attachments as GraphMsg[]) : [];
  const adjuntos: AdjuntoInfo[] = [];
  let conImagenCid = false;
  for (const a of expandidos) {
    const tipo = String(a.contentType ?? 'application/octet-stream');
    if (typeof a.contentId === 'string' && a.contentId && IMAGEN_CID_RE.test(tipo)) conImagenCid = true;
    if (a.isInline) continue;
    adjuntos.push({ id: String(a.id), nombre: String(a.name ?? 'adjunto'), tipo, tamano: Number(a.size) || 0, enLinea: false });
  }
  return {
    ...aResumen(m),
    para: Array.isArray(m.toRecipients) ? (m.toRecipients as GraphAddr[]).map(dir) : [],
    cc: Array.isArray(m.ccRecipients) ? (m.ccRecipients as GraphAddr[]).map(dir) : [],
    html,
    adjuntos,
    imagenesPendientes: conImagenCid && /\bcid:/i.test(html),
    ...(typeof m.webLink === 'string' && m.webLink ? { webLink: m.webLink } : {}),
  };
}

/** Mensajes que se ven DESPLEGADOS al abrir el hilo (como Gmail): el último y los no leídos. */
export function idsDesplegados(mensajes: Array<{ id: string; leido: boolean }>): Set<string> {
  const ids = new Set(mensajes.filter((m) => !m.leido).map((m) => m.id));
  const ultimo = mensajes[mensajes.length - 1];
  if (ultimo) ids.add(ultimo.id);
  return ids;
}

/** Opciones del hilo: qué imágenes incrustadas (cid) se descargan en la misma apertura. */
export interface OpcionesHilo {
  /** 'desplegados' = el último y los no leídos (vista del hilo); 'ninguna' = solo metadatos (marcar, vincular, acuse…). */
  imagenes?: 'desplegados' | 'ninguna';
}

export interface OpcionesProveedorGraph {
  /** Pruebas: espera entre reintentos (por defecto, setTimeout real). */
  dormir?: (ms: number) => Promise<void>;
  politica?: PoliticaReintento;
  limitador?: LimitadorConcurrencia;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Texto de la respuesta (plano) a HTML seguro con saltos de línea. */
export function textoAHtml(texto: string): string {
  return escHtml(texto).replace(/\r?\n/g, '<br>');
}

/**
 * Directorio de la organización (autocompletado de «Redactar», 2026-10-19). Es la ÚNICA ruta de Graph fuera de
 * /users/{buzón} además de `$batch`: la colección `/v1.0/users`, SOLO con GET, solo `displayName`, `mail` y
 * `userType`, y solo miembros con la cuenta activa. No lee buzones ni perfiles: nombre y correo, nada más.
 */
const DIRECTORIO_URL = `${GRAPH_BASE}/users`;
/** Búsqueda admitida: letras, números, espacio, punto, guion, guion bajo, «@» y apóstrofo (nombres como O'Neil). */
const BUSQUEDA_RE = /^[\p{L}\p{N} .@_'-]{2,60}$/u;

export function normalizarBusquedaDirectorio(q: string): string | null {
  const v = String(q ?? '').replace(/\s+/g, ' ').trim();
  return BUSQUEDA_RE.test(v) ? v : null;
}

/** URL de la búsqueda en el directorio (función pura, probada aparte). */
export function urlDirectorio(q: string, max: number): string {
  const v = normalizarBusquedaDirectorio(q);
  if (!v) throw new CorreoError('Búsqueda de destinatarios inválida.', 400);
  const t = odataString(v);
  const u = new URL(DIRECTORIO_URL);
  u.searchParams.set(
    '$filter',
    `accountEnabled eq true and userType eq 'Member' and (startswith(displayName,${t}) or startswith(mail,${t}) or startswith(givenName,${t}) or startswith(surname,${t}))`
  );
  u.searchParams.set('$select', 'displayName,mail,userType');
  u.searchParams.set('$top', String(Math.min(Math.max(1, max * 2), 25)));
  u.searchParams.set('$count', 'true');
  return u.toString();
}

/** ¿La URL es EXACTAMENTE la colección del directorio? (sin /users/{alguien}, sin otra ruta). */
export function esUrlDirectorio(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && u.host === 'graph.microsoft.com' && !u.username && !u.password && !u.port && u.pathname === '/v1.0/users';
}

function destinatarios(lista: string[]): Array<{ emailAddress: { address: string } }> {
  return lista.map((address) => ({ emailAddress: { address } }));
}

/** 429 que sigue después de los reintentos automáticos: mensaje para la persona con la espera sugerida. */
function errorLimitado(res: Response): CorreoError {
  const ms = leerRetryAfter(res.headers.get('retry-after'));
  const s = ms == null ? 10 : Math.max(1, Math.ceil(ms / 1000));
  return new CorreoError(`Microsoft limitó las consultas a su buzón. Intente de nuevo en ${s} s.`, 429, 'LIMITADO');
}

export class GraphMailProvider implements MailProvider {
  private readonly me: string;

  constructor(
    private readonly mailbox: Mailbox,
    private readonly token: () => Promise<string>,
    private readonly fetchFn: FetchFn = fetch,
    private readonly opciones: OpcionesProveedorGraph = {}
  ) {
    if (mailbox?.__marca !== 'mailbox-de-sesion') throw new CorreoError('Buzón no permitido.', 500);
    this.me = mailbox.base;
  }

  /**
   * Toda salida a Graph pasa por aquí: máximo 3 llamadas simultáneas por buzón (cola en memoria) y
   * reintento automático de 429/503 respetando Retry-After. La espera NO ocupa cupo de la cola.
   */
  private async enviar(url: string, init: RequestInit, idempotente: boolean): Promise<Response> {
    const limitador = this.opciones.limitador ?? limitadorBuzones;
    return conReintentos(() => limitador.correr(this.mailbox.correo, () => this.fetchFn(url, init)), {
      idempotente,
      politica: this.opciones.politica,
      dormir: this.opciones.dormir,
      // Sin buzón ni contenido: solo la señal para diagnosticar el throttling en el registro de PM2.
      alReintentar: (i) => console.warn(`[correo/graph] Microsoft respondió ${i.status}; reintento ${i.intento} en ${i.esperaMs} ms`),
    });
  }

  private async call(url: string, init: RequestInit = {}, prefer?: string): Promise<Response> {
    // Defensa en profundidad: aunque alguien arme una URL a mano, solo sale hacia el buzón de la sesión.
    if (!urlDelBuzon(url, this.mailbox)) throw new CorreoError('Destino de Graph no permitido.', 500);
    const token = await this.token();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...(init.headers as Record<string, string>) };
    if (prefer) headers.Prefer = prefer;
    const metodo = String(init.method ?? 'GET').toUpperCase();
    const res = await this.enviar(url, { ...init, headers }, metodo === 'GET' || metodo === 'PATCH' || metodo === 'DELETE');
    if (res.ok) return res;
    if (res.status === 401) throw new CorreoError('Microsoft rechazó la autenticación del módulo Correo. Avise a Tecnología.', 502);
    if (res.status === 403) throw new CorreoError('Microsoft no autorizó la operación (permiso de la app o política del buzón). Avise a Tecnología.', 403);
    if (res.status === 404) throw new CorreoError('No se encontró el correo en su buzón (pudo moverse o borrarse).', 404);
    if (res.status === 429) throw errorLimitado(res);
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

  /**
   * Imágenes incrustadas (cid) de UN mensaje como data: URI: una sola consulta, solo de los adjuntos en
   * línea (antes se bajaban los bytes de TODOS los adjuntos, PDF incluidos). Tope total MAX_CID_TOTAL.
   */
  async imagenesCid(mensajeId: string): Promise<Record<string, string>> {
    const url = `${this.me}/messages/${encodeURIComponent(assertGraphId(mensajeId))}/attachments?$filter=${encodeURIComponent('isInline eq true')}`;
    const data = await this.json<{ value?: GraphMsg[] }>(url);
    const imagenes: Record<string, string> = {};
    let total = 0;
    for (const a of data.value ?? []) {
      const tipo = String(a.contentType ?? '');
      const cid = typeof a.contentId === 'string' ? a.contentId.replace(/^<|>$/g, '') : '';
      const bytes = typeof a.contentBytes === 'string' ? a.contentBytes : '';
      if (cid && bytes && IMAGEN_CID_RE.test(tipo) && total + bytes.length <= MAX_CID_TOTAL) {
        imagenes[cid.toLowerCase()] = `data:${tipo.toLowerCase()};base64,${bytes}`;
        total += bytes.length;
      }
    }
    return imagenes;
  }

  /**
   * Hilo en UNA consulta: mensajes con cuerpo y metadatos de adjuntos ($expand, sin bytes), ordenados en
   * Graph (el más reciente primero, para que $top conserve los 50 últimos) y devueltos del más antiguo al
   * más reciente. Las imágenes cid solo se piden para los mensajes desplegados (una consulta por mensaje);
   * las de los demás, al desplegarlos (imagenesPendientes).
   */
  async hilo(conversationId: string, opciones: OpcionesHilo = {}): Promise<MensajeCompleto[]> {
    const id = assertGraphId(conversationId, 'identificador del hilo');
    const u = new URL(`${this.me}/messages`);
    // Graph exige que la propiedad de $orderby esté primero en $filter (si no: InefficientFilter).
    u.searchParams.set('$filter', `receivedDateTime ge 1900-01-01T00:00:00Z and conversationId eq ${odataString(id)}`);
    u.searchParams.set('$orderby', 'receivedDateTime desc');
    u.searchParams.set('$select', SELECT_COMPLETO);
    u.searchParams.set('$expand', EXPAND_ADJUNTOS);
    u.searchParams.set('$top', '50');
    const data = await this.json<{ value?: GraphMsg[] }>(u.toString(), undefined, 'outlook.body-content-type="html"');
    const msgs = (data.value ?? []).map(aCompleto).sort((a, b) => a.fecha.localeCompare(b.fecha));
    if (opciones.imagenes !== 'desplegados') return msgs;
    const desplegados = idsDesplegados(msgs);
    return Promise.all(
      msgs.map(async (m) => (m.imagenesPendientes && desplegados.has(m.id) ? { ...m, imagenesCid: await this.imagenesCid(m.id), imagenesPendientes: false } : m))
    );
  }

  async mensaje(id: string): Promise<MensajeCompleto> {
    const mid = assertGraphId(id);
    const m = await this.json<GraphMsg>(
      `${this.me}/messages/${encodeURIComponent(mid)}?$select=${SELECT_COMPLETO}&$expand=${encodeURIComponent(EXPAND_ADJUNTOS)}`,
      undefined,
      'outlook.body-content-type="html"'
    );
    return aCompleto(m);
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
    const comment = entrada.comentarioHtml || textoAHtml(entrada.texto);
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

  /** Ruta RELATIVA (para `$batch`) de un mensaje del buzón de la sesión; se valida igual que una URL completa. */
  private rutaMensaje(mensajeId: string): string {
    const abs = `${this.me}/messages/${encodeURIComponent(assertGraphId(mensajeId))}`;
    if (!urlDelBuzon(abs, this.mailbox)) throw new CorreoError('Destino de Graph no permitido.', 500);
    return abs.slice(GRAPH_BASE.length);
  }

  /**
   * Graph `$batch` (POST /v1.0/$batch). Es la ÚNICA llamada fuera de /users/{buzón}: por eso solo acepta
   * sub-peticiones armadas con rutaMensaje (todas del buzón de la sesión) y vuelve a validarlas aquí.
   * `idempotente`: un lote de GET o PATCH se puede repetir ante un 503; uno de `move` (POST) no.
   */
  private async lote(peticiones: SubPeticionLote[], idempotente: boolean): Promise<Map<string, RespuestaLote>> {
    if (peticiones.length === 0 || peticiones.length > GRAPH_BATCH_MAX) throw new CorreoError('Lote de Graph inválido.', 500);
    for (const p of peticiones) if (!urlDelBuzon(`${GRAPH_BASE}${p.url}`, this.mailbox)) throw new CorreoError('Destino de Graph no permitido.', 500);
    const token = await this.token();
    const res = await this.enviar(
      `${GRAPH_BASE}/$batch`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: peticiones.map((p) => (p.body === undefined ? { id: p.id, method: p.method, url: p.url } : { ...p, headers: { 'Content-Type': 'application/json' } })),
        }),
      },
      idempotente
    );
    if (res.status === 401) throw new CorreoError('Microsoft rechazó la autenticación del módulo Correo. Avise a Tecnología.', 502);
    if (res.status === 403) throw new CorreoError('Microsoft no autorizó la operación (permiso de la app o política del buzón). Avise a Tecnología.', 403);
    if (res.status === 429) throw errorLimitado(res);
    if (!res.ok) throw new CorreoError(`Microsoft respondió con un error (${res.status}).`, 502);
    const data = (await res.json()) as { responses?: Array<{ id?: string; status?: number; headers?: Record<string, string>; body?: unknown }> };
    const out = new Map<string, RespuestaLote>();
    for (const r of data.responses ?? []) {
      const ra = Number(r.headers?.['Retry-After'] ?? r.headers?.['retry-after']) || 0;
      out.set(String(r.id), { status: Number(r.status) || 0, retryAfter: ra, body: r.body && typeof r.body === 'object' ? (r.body as GraphMsg) : null });
    }
    return out;
  }

  /**
   * Sub-peticiones en lotes de 20; las limitadas (429, y 503 si es idempotente; Exchange admite 4 simultáneas por
   * buzón) se reintentan con la misma política que el resto (hasta 3 veces, respetando Retry-After con retroceso y
   * jitter). Devuelve la respuesta FINAL de cada sub-petición por su id.
   */
  private async lotes(peticiones: SubPeticionLote[], idempotente: boolean): Promise<Map<string, RespuestaLote>> {
    const politica = this.opciones.politica ?? POLITICA_GRAPH;
    const dormir = this.opciones.dormir ?? ((ms: number) => new Promise<void>((x) => setTimeout(x, ms)));
    const finales = new Map<string, RespuestaLote>();
    for (let i = 0; i < peticiones.length; i += GRAPH_BATCH_MAX) {
      let pendientes = peticiones.slice(i, i + GRAPH_BATCH_MAX);
      for (let intento = 0; pendientes.length; intento++) {
        const ultimo = intento >= politica.reintentos;
        const r = await this.lote(pendientes, idempotente);
        const limitadas = ultimo ? [] : pendientes.filter((p) => esReintentable(r.get(p.id)?.status ?? 0, idempotente));
        for (const p of pendientes) if (!limitadas.includes(p)) finales.set(p.id, r.get(p.id) ?? { status: 0, retryAfter: 0, body: null });
        if (!limitadas.length) break;
        const ra = Math.max(0, ...limitadas.map((p) => r.get(p.id)?.retryAfter ?? 0));
        await dormir(Math.min(politica.maxEsperaMs, esperaReintento(intento, ra ? ra * 1000 : null, politica)));
        pendientes = limitadas;
      }
    }
    return finales;
  }

  async marcarLeido(mensajesIds: string[], leido: boolean): Promise<{ cambiados: number; fallidos: number }> {
    const subs = [...new Set(mensajesIds)].map((id, j) => ({ id: String(j + 1), method: 'PATCH' as const, url: this.rutaMensaje(id), body: { isRead: leido } }));
    const r = await this.lotes(subs, true);
    let cambiados = 0;
    for (const p of subs) {
      const st = r.get(p.id)?.status ?? 0;
      if (st >= 200 && st < 300) cambiados++;
    }
    return { cambiados, fallidos: subs.length - cambiados };
  }

  /**
   * Eliminar · pertenencia: cada id se consulta en /users/{buzón de la sesión}/messages/{id} (por `$batch`). Un id
   * de otro buzón no existe ahí (404 → null): nunca se mueve un correo que no sea de la persona.
   */
  async ubicarMensajes(mensajesIds: string[]): Promise<Map<string, UbicacionMensaje | null>> {
    const unicos = [...new Set(mensajesIds)];
    const subs = unicos.map((id, j) => ({ id: String(j + 1), method: 'GET' as const, url: `${this.rutaMensaje(id)}?$select=id,parentFolderId,conversationId,internetMessageId,isRead` }));
    const r = await this.lotes(subs, true);
    const out = new Map<string, UbicacionMensaje | null>();
    unicos.forEach((id, j) => {
      const res = r.get(String(j + 1));
      const b = res?.body;
      const ok = res && res.status >= 200 && res.status < 300 && b && typeof b.parentFolderId === 'string' && String(b.id ?? id) === id;
      out.set(
        id,
        ok
          ? { carpetaId: String(b.parentFolderId), conversationId: String(b.conversationId ?? ''), internetMessageId: String(b.internetMessageId ?? ''), leido: Boolean(b.isRead) }
          : null
      );
    });
    return out;
  }

  async idCarpetaEliminados(): Promise<string> {
    const c = await this.json<{ id?: string }>(`${this.me}/mailFolders/deleteditems?$select=id`);
    return assertGraphId(String(c.id ?? ''), 'identificador de carpeta');
  }

  /**
   * Graph `POST /messages/{id}/move` por `$batch`: el destino es una carpeta DEL MISMO BUZÓN (`deleteditems` o el
   * id de la carpeta de origen al deshacer). No se reintenta un 503 (podría haberse movido ya); un 429 sí (no se
   * procesó). Graph responde el mensaje movido con su id NUEVO.
   */
  async moverMensajes(mensajesIds: string[], destinoId: string): Promise<Map<string, string | null>> {
    const destino = destinoId === 'deleteditems' ? destinoId : assertGraphId(destinoId, 'identificador de carpeta');
    const unicos = [...new Set(mensajesIds)];
    const subs = unicos.map((id, j) => ({ id: String(j + 1), method: 'POST' as const, url: `${this.rutaMensaje(id)}/move`, body: { destinationId: destino } }));
    const r = await this.lotes(subs, false);
    const out = new Map<string, string | null>();
    unicos.forEach((id, j) => {
      const res = r.get(String(j + 1));
      const nuevo = res && res.status >= 200 && res.status < 300 && typeof res.body?.id === 'string' ? res.body.id : null;
      out.set(id, nuevo && ID_RE.test(nuevo) ? nuevo : null);
    });
    return out;
  }

  private urlCarpeta(carpetaId: string | null): string {
    return carpetaId ? `${this.me}/mailFolders/${encodeURIComponent(assertGraphId(carpetaId, 'identificador de carpeta'))}` : `${this.me}/mailFolders/inbox`;
  }

  async idsPorLeido(carpetaId: string | null, leido: boolean, max: number): Promise<string[]> {
    const u = new URL(`${this.urlCarpeta(carpetaId)}/messages`);
    // Los que NO están en el estado pedido (para «leído», los no leídos).
    u.searchParams.set('$filter', `isRead eq ${leido ? 'false' : 'true'}`);
    u.searchParams.set('$select', 'id');
    u.searchParams.set('$top', String(Math.min(Math.max(1, max), 100)));
    const ids: string[] = [];
    let url: string | undefined = u.toString();
    while (url && ids.length < max) {
      const data: { value?: GraphMsg[]; '@odata.nextLink'?: string } = await this.json(url);
      for (const m of data.value ?? []) if (ids.length < max && m.id) ids.push(String(m.id));
      // El nextLink se valida en call() (urlDelBuzon) antes de seguirlo.
      url = data['@odata.nextLink'];
    }
    return ids;
  }

  async contadoresCarpeta(carpetaId: string | null): Promise<{ total: number; noLeidos: number }> {
    const c = await this.json<{ totalItemCount?: number; unreadItemCount?: number }>(`${this.urlCarpeta(carpetaId)}?$select=totalItemCount,unreadItemCount`);
    return { total: Math.max(0, Number(c.totalItemCount) || 0), noLeidos: Math.max(0, Number(c.unreadItemCount) || 0) };
  }

  /**
   * Redactar (2026-10-19). Sin adjuntos: `POST /users/{buzón de la sesión}/sendMail` (queda en Enviados). Con
   * adjuntos: borrador (`POST /messages`) → un `POST /attachments` por archivo (≤ 3 MB c/u, el tope de la llamada
   * simple) → `send`; si algo falla antes de enviar, el borrador se borra para no dejarlo en Borradores. Ninguno de
   * los dos pasos se reintenta solo ante un 503 (podría haberse enviado ya).
   */
  async enviarNuevo(entrada: NuevoCorreoEntrada): Promise<void> {
    const json = { 'Content-Type': 'application/json' };
    const message = {
      subject: entrada.asunto,
      body: { contentType: 'HTML', content: entrada.html },
      toRecipients: destinatarios(entrada.para),
      ccRecipients: destinatarios(entrada.cc),
      bccRecipients: destinatarios(entrada.cco),
    };
    if (entrada.adjuntos.length === 0) {
      await this.call(`${this.me}/sendMail`, { method: 'POST', headers: json, body: JSON.stringify({ message, saveToSentItems: true }) });
      return;
    }
    const draft = await this.json<{ id?: string }>(`${this.me}/messages`, { method: 'POST', headers: json, body: JSON.stringify(message) });
    const url = `${this.me}/messages/${encodeURIComponent(assertGraphId(String(draft.id ?? '')))}`;
    try {
      for (const a of entrada.adjuntos) {
        await this.call(`${url}/attachments`, {
          method: 'POST',
          headers: json,
          body: JSON.stringify({ '@odata.type': '#microsoft.graph.fileAttachment', name: a.nombre, contentType: a.tipo, contentBytes: a.bytes.toString('base64') }),
        });
      }
    } catch (e) {
      await this.call(url, { method: 'DELETE' }).catch(() => undefined);
      throw e;
    }
    await this.call(`${url}/send`, { method: 'POST' });
  }

  /** Destinatarios de los últimos correos ENVIADOS del buzón propio (solo direcciones; sin asunto ni cuerpo). */
  async contactosRecientes(max: number): Promise<Direccion[]> {
    const u = new URL(`${this.me}/mailFolders/sentitems/messages`);
    u.searchParams.set('$select', 'toRecipients,ccRecipients,sentDateTime');
    u.searchParams.set('$orderby', 'sentDateTime desc');
    u.searchParams.set('$top', String(Math.min(Math.max(1, max), 100)));
    const data = await this.json<{ value?: GraphMsg[] }>(u.toString());
    const vistos = new Map<string, Direccion>();
    for (const m of data.value ?? []) {
      for (const lista of [m.toRecipients, m.ccRecipients]) {
        if (!Array.isArray(lista)) continue;
        for (const a of lista as GraphAddr[]) {
          const d = dir(a);
          if (d.correo && d.correo !== this.mailbox.correo && !vistos.has(d.correo)) vistos.set(d.correo, d);
        }
      }
    }
    return [...vistos.values()];
  }

  /**
   * Directorio: GET a la colección /v1.0/users (consulta avanzada: ConsistencyLevel eventual). Solo miembros
   * activos con correo de los dominios del inquilino; devuelve nombre y correo. Se valida la URL exacta antes de salir.
   */
  async buscarDirectorio(q: string, dominios: string[], max: number): Promise<Direccion[]> {
    const url = urlDirectorio(q, max);
    if (!esUrlDirectorio(url)) throw new CorreoError('Destino de Graph no permitido.', 500);
    const token = await this.token();
    const res = await this.enviar(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: 'eventual' } }, true);
    if (res.status === 401) throw new CorreoError('Microsoft rechazó la autenticación del módulo Correo. Avise a Tecnología.', 502);
    if (res.status === 403) throw new CorreoError('Microsoft no autorizó la consulta del directorio (permiso de la app). Avise a Tecnología.', 403);
    if (res.status === 429) throw errorLimitado(res);
    if (!res.ok) throw new CorreoError(`Microsoft respondió con un error (${res.status}).`, 502);
    const data = (await res.json()) as { value?: GraphMsg[] };
    const permitidos = new Set(dominios.map((d) => d.toLowerCase()));
    const out: Direccion[] = [];
    for (const u of data.value ?? []) {
      const correo = String(u.mail ?? '').trim().toLowerCase();
      if (!correo || String(u.userType ?? 'Member') !== 'Member' || !esDestinatarioValido(correo)) continue;
      if (!permitidos.has(correo.split('@')[1] ?? '')) continue;
      if (out.some((x) => x.correo === correo)) continue;
      out.push({ nombre: String(u.displayName ?? '').trim() || correo, correo });
      if (out.length >= max) break;
    }
    return out;
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
