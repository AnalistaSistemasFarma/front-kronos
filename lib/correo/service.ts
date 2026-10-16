import type { CorreoConfig } from './config';
import { inquilinoDeCorreo } from './config';
import {
  CORREO_LOTE_MARCAR_CARPETA,
  CORREO_MAX_ADJUNTO_BYTES,
  CORREO_MAX_MARCAR_SELECCION,
  CORREO_MAX_ADJUNTO_RESPUESTA_BYTES,
  CORREO_MAX_ADJUNTOS_RESPUESTA,
  CORREO_MAX_NOTA,
  CORREO_MAX_RESPUESTA_CHARS,
  CORREO_MAX_TOTAL_RESPUESTA_BYTES,
  correoCategoria,
} from './constants';
import * as data from './db';
import type { AccesoCorreo, CorreoDb } from './db';
import { CorreoError, NO_DISPONIBLE } from './errors';
import { assertGraphId, GraphMailProvider, idsDesplegados, mailboxForSession, tokenApp } from './graph';
import { actualizarMensajeEnCache, hiloConCache, invalidarHilo, marcarLeidoEnCache } from './cacheHilo';
import { MockMailProvider } from './mock';
import { agruparPorHilo, filaDesdeHilo, notaDesdeCorreo, notaDesdeRespuesta, type FilaCrear, type ProcesoOpcion } from './rules';
import { sanitizeEmailHtml } from './sanitize';
import { markdownAHtml, markdownATexto } from './markdown';
import { claveAcuse, enlaceSolicitud, textoAcuse, type OpcionesAcuse } from './acuse';
import { fragmentoAcuse, logoAcuseUrl } from './plantillas/acuse.html';
import type { SolicitudVisible } from './kronos';
import type { ArchivoAdjunto, Direccion, FilaSimulacion, MailProvider, MensajeCompleto, ResultadoAcuse, ResultadoCreacion, VinculoHilo } from './types';

/**
 * Orquestación del módulo Correo. Las dependencias se inyectan (base, Graph,
 * creación de solicitudes, OneDrive, notificaciones) para probar cada caso sin
 * red ni base. Regla de oro: el buzón SIEMPRE es el del usuario de la sesión.
 */

export interface KronosPort {
  /** Categorías y procesos de «Nueva solicitud» en la empresa (misma regla de la pantalla normal). */
  catalogoEmpresa(idCompany: number): Promise<CatalogoCorreo>;
  solicitudVisible(idUser: string, idRequest: number): Promise<SolicitudVisible | null>;
  /** ¿La solicitud sigue existiendo? (un vínculo a una solicitud borrada es huérfano y no bloquea). */
  solicitudExiste(idRequest: number): Promise<boolean>;
  insertarNota(idRequest: number, nota: string, idUser: string): Promise<number>;
}

export type ProcesoCorreo = ProcesoOpcion & { idCategoria?: number; categoria?: string; responsables?: string[] };
export interface CatalogoCorreo {
  categorias: Array<{ id: number; categoria: string }>;
  procesos: ProcesoCorreo[];
}

/**
 * ¿Puede crear (o vincular) solicitudes de esa empresa desde el Correo? Las mismas
 * empresas que «Nueva solicitud»: aquellas a las que pertenece (company_user), no
 * solo la del buzón. El acceso al módulo sigue dependiendo del subproceso «Correo».
 */
export function puedeUsarEmpresa(acceso: AccesoCorreo, idCompany: number): boolean {
  return acceso.empresasSolicitud.some((e) => e.idCompany === idCompany);
}

export interface CrearSolicitudPort {
  (p: { company: number; subject: string; descripcion: string; process: number; createdby: string; url: null; formValues: [] }): Promise<{
    id_request: number;
    processEmail: string | null;
    processEmails: string[];
    taskEmails: string[];
  }>;
}

export interface CorreoDeps {
  db: CorreoDb;
  cfg: CorreoConfig;
  kronos: KronosPort;
  crearSolicitud: CrearSolicitudPort;
  /** Avisos de solicitud nueva (mismos de create-request). No debe lanzar. */
  notificarNueva: (p: { requestId: number; subject: string; processEmail: string | null; processEmails: string[]; taskEmails: string[]; creatorEmail: string | null }) => void;
  /** Sube adjuntos a OneDrive en la carpeta de la solicitud. */
  subirAdjuntos: (idRequest: number, archivos: ArchivoAdjunto[]) => Promise<{ subidos: number; fallidos: string[] }>;
  dominiosGrupo: string[];
  /** Base absoluta de SynerLink en el ambiente (enlace del acuse), p. ej. NEXTAUTH_URL. */
  appBaseUrl?: string;
  fetchFn?: typeof fetch;
  now?: () => number;
  /** Proveedor a la medida (pruebas). */
  proveedor?: (acceso: AccesoCorreo) => Promise<MailProvider>;
}

const now = (d: CorreoDeps) => (d.now ? d.now() : Date.now());

/** Ejecuta un paso secundario sin dejar que su fallo cambie el resultado. */
async function sinFallar(f: () => unknown): Promise<void> {
  try {
    await f();
  } catch {
    /* secundario */
  }
}

// ---------------------------------------------------------------------------
// Buzón de la sesión
// ---------------------------------------------------------------------------

export interface EstadoConexion {
  modo: CorreoConfig['modo'];
  /** ¿El correo de la persona es de un inquilino habilitado? */
  disponible: boolean;
  /** Buzón que verá (siempre el de su usuario). */
  correo: string;
  envioHabilitado: boolean;
  etiquetarHabilitado: boolean;
  sincronizacionAutomatica: boolean;
}

export function estadoConexion(d: CorreoDeps, acceso: AccesoCorreo): EstadoConexion {
  const disponible = d.cfg.modo === 'mock' || (d.cfg.modo === 'graph' && inquilinoDeCorreo(d.cfg, acceso.email) !== null);
  return {
    modo: d.cfg.modo,
    disponible,
    correo: acceso.email.toLowerCase(),
    envioHabilitado: d.cfg.envioHabilitado,
    etiquetarHabilitado: d.cfg.etiquetarHabilitado,
    sincronizacionAutomatica: d.cfg.syncHabilitado,
  };
}

/**
 * Proveedor del buzón PROPIO: el buzón sale del correo de la SESIÓN (acceso.email),
 * nunca de un dato del navegador. Correos de inquilinos sin app habilitada → 403
 * «Correo disponible próximamente para su empresa».
 */
export async function proveedorDe(d: CorreoDeps, acceso: AccesoCorreo): Promise<MailProvider> {
  if (d.proveedor) return d.proveedor(acceso);
  if (d.cfg.modo === 'mock') return new MockMailProvider(acceso.email);
  if (d.cfg.modo === 'off') throw new CorreoError('El módulo Correo aún no está habilitado en este ambiente.', 503);
  const inq = inquilinoDeCorreo(d.cfg, acceso.email);
  if (!inq) throw new CorreoError('Correo disponible próximamente para su empresa.', 403, NO_DISPONIBLE);
  const fetchFn = d.fetchFn ?? fetch;
  return new GraphMailProvider(mailboxForSession(acceso.email), () => tokenApp(inq, fetchFn, now(d)), fetchFn);
}

function buzon(acceso: AccesoCorreo): string {
  return acceso.email.toLowerCase();
}

/** Registro de CADA lectura del buzón (sin contenido). No interrumpe la consulta si falla. */
export async function auditarLectura(
  d: CorreoDeps,
  acceso: AccesoCorreo,
  e: { accion: 'LEER_CARPETAS' | 'LEER_BANDEJA' | 'LEER_HILO' | 'DESCARGAR_ADJUNTO' | 'SIMULAR'; mensajeId?: string | null; conversationId?: string | null; detalle?: string | null },
  ip: string | null
): Promise<void> {
  await data.auditar(d.db, { idUser: acceso.idUser, mailbox: buzon(acceso), ip, ...e });
}

// ---------------------------------------------------------------------------
// Hilo
// ---------------------------------------------------------------------------

export interface MensajeVista {
  id: string;
  internetMessageId: string;
  asunto: string;
  de: Direccion;
  para: Direccion[];
  cc: Direccion[];
  fecha: string;
  leido: boolean;
  html: string;
  remotasBloqueadas: number;
  adjuntos: MensajeCompleto['adjuntos'];
  /** Ya está en el caso vinculado (origen, nota o respuesta). */
  enCaso: boolean;
  /** «Abrir en Outlook»: solo si Graph lo trae y es de Outlook en la web (https). */
  enlaceOutlook: string | null;
  /** Imágenes incrustadas aún sin descargar: el navegador las pide al desplegar el mensaje. */
  imagenesPendientes: boolean;
}

const HOSTS_OUTLOOK = new Set(['outlook.office.com', 'outlook.office365.com', 'outlook.live.com']);
/** Solo enlaces https de Outlook en la web: nada de otro dominio ni de otro esquema llega a un `href`. */
export function enlaceOutlookSeguro(webLink: string | undefined): string | null {
  if (!webLink) return null;
  try {
    const u = new URL(webLink);
    return u.protocol === 'https:' && HOSTS_OUTLOOK.has(u.hostname.toLowerCase()) ? u.toString() : null;
  } catch {
    return null;
  }
}

export interface HiloVista {
  conversationId: string;
  asunto: string;
  mensajes: MensajeVista[];
  vinculo: (VinculoHilo & { lastSyncedAt: string | null }) | null;
  /** Correos del hilo que aún no están en el caso vinculado. */
  pendientes: number;
}

const VENTANA_RESPUESTA_MS = 10 * 60_000;

/**
 * Correos del hilo que faltan en el caso. Los enviados por la persona justo
 * después de responder desde SynerLink ya quedaron como nota de la respuesta:
 * se registran sin duplicar la nota.
 */
async function clasificarPendientes(d: CorreoDeps, acceso: AccesoCorreo, mensajes: MensajeCompleto[], propio: string): Promise<{ nuevos: MensajeCompleto[]; registrados: Set<string>; respuestasPropias: MensajeCompleto[] }> {
  const registrados = await data.correosRegistrados(d.db, mensajes.map((m) => m.internetMessageId));
  const sinRegistrar = mensajes.filter((m) => m.internetMessageId && !registrados.has(m.internetMessageId));
  const respuestas = await d.db.emailAudit.findMany({
    where: { id_user: acceso.idUser, accion: { in: ['RESPONDER', 'ACUSE_HILO'] }, conversation_id: mensajes[0]?.conversationId ?? '' },
    select: { created_at: true },
  });
  const tiempos = respuestas.map((r) => r.created_at.getTime());
  const respuestasPropias: MensajeCompleto[] = [];
  const nuevos: MensajeCompleto[] = [];
  for (const m of sinRegistrar) {
    const t = Date.parse(m.fecha);
    if (m.de.correo === propio && tiempos.some((x) => t >= x - 60_000 && t <= x + VENTANA_RESPUESTA_MS)) respuestasPropias.push(m);
    else nuevos.push(m);
  }
  return { nuevos, registrados, respuestasPropias };
}

/**
 * Imágenes cid de los mensajes que se ven desplegados y aún no las tienen (p. ej. el hilo quedó en caché
 * desde el marcado como leído, que no las pide). Se guardan en la caché para no volver a pedirlas.
 */
async function completarImagenes(prov: MailProvider, acceso: AccesoCorreo, conversationId: string, mensajes: MensajeCompleto[], ids: Set<string>): Promise<MensajeCompleto[]> {
  if (!prov.imagenesCid) return mensajes;
  return Promise.all(
    mensajes.map(async (m) => {
      if (!m.imagenesPendientes || !ids.has(m.id)) return m;
      const completo = { ...m, imagenesCid: await prov.imagenesCid!(m.id), imagenesPendientes: false };
      actualizarMensajeEnCache(acceso.idUser, assertGraphId(conversationId, 'identificador del hilo'), completo);
      return completo;
    })
  );
}

/** Hilo del buzón PROPIO con la caché corta por persona (una consulta aunque se pida varias veces a la vez). */
async function hiloDeSesion(d: CorreoDeps, acceso: AccesoCorreo, prov: MailProvider, conversationId: string, opciones: { imagenes?: 'desplegados' | 'ninguna'; fresco?: boolean } = {}): Promise<MensajeCompleto[]> {
  const id = assertGraphId(conversationId, 'identificador del hilo');
  return hiloConCache(acceso.idUser, id, () => prov.hilo(id, { imagenes: opciones.imagenes ?? 'ninguna' }), { fresco: opciones.fresco, ahora: now(d) });
}

function aVista(m: MensajeCompleto, remotas: boolean, registrados: Set<string>): MensajeVista {
  const s = sanitizeEmailHtml(m.html, { remotas, cid: m.imagenesCid });
  return {
    id: m.id,
    internetMessageId: m.internetMessageId,
    asunto: m.asunto,
    de: m.de,
    para: m.para,
    cc: m.cc,
    fecha: m.fecha,
    leido: m.leido,
    html: s.html,
    remotasBloqueadas: s.remotasBloqueadas,
    adjuntos: m.adjuntos,
    enCaso: registrados.has(m.internetMessageId),
    enlaceOutlook: enlaceOutlookSeguro(m.webLink),
    imagenesPendientes: Boolean(m.imagenesPendientes),
  };
}

export async function verHilo(d: CorreoDeps, acceso: AccesoCorreo, conversationId: string, opciones: { remotas: boolean; fresco?: boolean }): Promise<HiloVista> {
  const prov = await proveedorDe(d, acceso);
  const enCache = await hiloDeSesion(d, acceso, prov, conversationId, { imagenes: 'desplegados', fresco: opciones.fresco });
  if (enCache.length === 0) throw new CorreoError('No se encontró el hilo en su buzón.', 404);
  const mensajes = await completarImagenes(prov, acceso, conversationId, enCache, idsDesplegados(enCache));
  const vinculo = await data.vinculoDeHilo(d.db, acceso.idUser, conversationId);
  let registrados = new Set<string>();
  let pendientes = 0;
  if (vinculo) {
    const c = await clasificarPendientes(d, acceso, mensajes, buzon(acceso));
    registrados = c.registrados;
    pendientes = c.nuevos.length;
  }
  return {
    conversationId,
    asunto: mensajes[0].asunto,
    vinculo,
    pendientes,
    mensajes: mensajes.map((m) => aVista(m, opciones.remotas, registrados)),
  };
}

/**
 * Al DESPLEGAR un mensaje con imágenes cid pendientes: una consulta para ese mensaje. El mensaje se busca
 * dentro del hilo del buzón PROPIO (caché o Graph): un id que no sea de ese hilo da 404.
 */
export async function imagenesMensajeHilo(d: CorreoDeps, acceso: AccesoCorreo, conversationId: string, mensajeId: string, opciones: { remotas: boolean }): Promise<MensajeVista> {
  const prov = await proveedorDe(d, acceso);
  const mensajes = await hiloDeSesion(d, acceso, prov, conversationId);
  const id = assertGraphId(mensajeId);
  const m = mensajes.find((x) => x.id === id);
  if (!m) throw new CorreoError('No se encontró el correo en este hilo.', 404);
  const [completo] = await completarImagenes(prov, acceso, conversationId, [m], new Set([id]));
  const vinculo = await data.vinculoDeHilo(d.db, acceso.idUser, conversationId);
  const registrados = vinculo ? await data.correosRegistrados(d.db, [completo.internetMessageId]) : new Set<string>();
  return aVista(completo, opciones.remotas, registrados);
}

/** Leído / no leído escribe en el buzón (Mail.ReadWrite): lo controla el mismo interruptor que las categorías. */
function exigirEscrituraBuzon(d: CorreoDeps): void {
  if (!d.cfg.etiquetarHabilitado) throw new CorreoError('Marcar correos como leídos o no leídos no está habilitado en este ambiente.', 403);
}

async function auditarLeido(d: CorreoDeps, acceso: AccesoCorreo, leido: boolean, e: { conversationId?: string | null; mensajeId?: string | null; detalle: string }, ip: string | null) {
  await data.auditar(d.db, { idUser: acceso.idUser, mailbox: buzon(acceso), accion: leido ? 'MARCAR_LEIDO' : 'MARCAR_NO_LEIDO', ip, ...e });
}

/**
 * «Marcar como leído / no leído» del hilo (barra del hilo y al abrirlo, como Gmail). Los ids salen del hilo leído
 * del buzón PROPIO (nunca del navegador): solo se tocan los mensajes cuyo estado cambia. Queda en la auditoría.
 */
export async function marcarLeidoHilo(d: CorreoDeps, acceso: AccesoCorreo, conversationId: string, leido: boolean, ip: string | null): Promise<{ cambiados: number }> {
  exigirEscrituraBuzon(d);
  const prov = await proveedorDe(d, acceso);
  // Al abrir el hilo ya quedó en la caché: marcarlo no vuelve a leerlo de Graph (solo el `$batch`).
  const mensajes = await hiloDeSesion(d, acceso, prov, conversationId);
  if (mensajes.length === 0) throw new CorreoError('No se encontró el hilo en su buzón.', 404);
  // Como Gmail: «no leído» deja sin leer el último mensaje; «leído» marca todos.
  const objetivo = leido ? mensajes.filter((m) => !m.leido) : mensajes.slice(-1).filter((m) => m.leido);
  const r = objetivo.length ? await prov.marcarLeido(objetivo.map((m) => m.id), leido) : { cambiados: 0, fallidos: 0 };
  if (r.fallidos) invalidarHilo(acceso.idUser, assertGraphId(conversationId, 'identificador del hilo'));
  else if (objetivo.length) marcarLeidoEnCache(acceso.idUser, assertGraphId(conversationId, 'identificador del hilo'), objetivo.map((m) => m.id), leido);
  if (r.fallidos) throw new CorreoError('Microsoft no pudo marcar todos los correos del hilo. Intente de nuevo.', 502);
  await auditarLeido(d, acceso, leido, { conversationId, mensajeId: objetivo[0]?.id ?? null, detalle: `Hilo: ${r.cambiados} mensaje(s)` }, ip);
  return { cambiados: r.cambiados };
}

/**
 * Correos SELECCIONADOS en la lista. Los ids vienen del navegador, pero cada PATCH va a
 * /users/{buzón de la sesión}/messages/{id}: un id de otro buzón no existe ahí (Graph: 404 → «fallido»).
 */
export async function marcarLeidoMensajes(d: CorreoDeps, acceso: AccesoCorreo, ids: string[], leido: boolean, ip: string | null): Promise<{ cambiados: number; fallidos: number }> {
  exigirEscrituraBuzon(d);
  const unicos = [...new Set(ids.map((x) => String(x ?? '').trim()))];
  if (unicos.length === 0) throw new CorreoError('Seleccione al menos un correo.', 400);
  if (unicos.length > CORREO_MAX_MARCAR_SELECCION) throw new CorreoError(`Máximo ${CORREO_MAX_MARCAR_SELECCION} correos por vez.`, 400);
  const prov = await proveedorDe(d, acceso);
  const r = await prov.marcarLeido(unicos, leido);
  invalidarHilo(acceso.idUser);
  await auditarLeido(d, acceso, leido, { mensajeId: unicos[0], detalle: `Selección: ${r.cambiados} de ${unicos.length} mensaje(s)` }, ip);
  return r;
}

/**
 * «Marcar todo como leído» / toda la carpeta seleccionada: un LOTE por petición (el navegador repite y muestra el
 * avance). Los ids se consultan en el servidor (estado contrario) y se marcan por `$batch`; `restantes` sale del
 * contador de la carpeta para la barra de progreso.
 */
export async function marcarLeidoCarpeta(
  d: CorreoDeps,
  acceso: AccesoCorreo,
  carpetaId: string | null,
  leido: boolean,
  ip: string | null
): Promise<{ cambiados: number; fallidos: number; restantes: number }> {
  exigirEscrituraBuzon(d);
  const carpeta = carpetaId ? assertGraphId(carpetaId, 'identificador de carpeta') : null;
  const prov = await proveedorDe(d, acceso);
  const ids = await prov.idsPorLeido(carpeta, leido, CORREO_LOTE_MARCAR_CARPETA);
  const r = ids.length ? await prov.marcarLeido(ids, leido) : { cambiados: 0, fallidos: 0 };
  if (ids.length) invalidarHilo(acceso.idUser);
  const c = await prov.contadoresCarpeta(carpeta);
  const restantes = leido ? c.noLeidos : Math.max(0, c.total - c.noLeidos);
  if (ids.length) await auditarLeido(d, acceso, leido, { detalle: `Carpeta ${carpeta ?? 'Bandeja de entrada'}: ${r.cambiados} mensaje(s) en este lote` }, ip);
  return { ...r, restantes };
}

/** Pasa a notas del caso los correos nuevos de un hilo vinculado (a pedido o por la tarea de fondo). */
export async function sincronizarHilo(
  d: CorreoDeps,
  acceso: AccesoCorreo,
  conversationId: string,
  ip: string | null,
  prov?: MailProvider
): Promise<{ agregadas: number; idRequest: number }> {
  const vinculo = await data.vinculoDeHilo(d.db, acceso.idUser, conversationId);
  if (!vinculo) throw new CorreoError('Este hilo no está vinculado a ninguna solicitud.', 404);
  const p = prov ?? (await proveedorDe(d, acceso));
  const mensajes = await p.hilo(conversationId);
  const { nuevos, respuestasPropias } = await clasificarPendientes(d, acceso, mensajes, buzon(acceso));
  for (const m of respuestasPropias) {
    await data.registrarCorreo(d.db, { idLink: vinculo.id, internetMessageId: m.internetMessageId, tipo: 'RESPUESTA', recibido: m.fecha });
  }
  let agregadas = 0;
  for (const m of nuevos) {
    // Primero se registra (único global): si otro proceso ya lo tomó, no se duplica la nota.
    const nuevo = await data.registrarCorreo(d.db, { idLink: vinculo.id, internetMessageId: m.internetMessageId, tipo: 'NOTA', recibido: m.fecha });
    if (!nuevo) continue;
    await d.kronos.insertarNota(vinculo.idRequest, notaDesdeCorreo(m, CORREO_MAX_NOTA), acceso.idUser);
    agregadas++;
  }
  await data.marcarSincronizado(d.db, vinculo.id);
  if (agregadas > 0) {
    await data.auditar(d.db, { idUser: acceso.idUser, accion: 'NOTA_HILO', conversationId, idRequest: vinculo.idRequest, detalle: `${agregadas} correo(s) del hilo agregados como notas`, ip });
  }
  return { agregadas, idRequest: vinculo.idRequest };
}

/** Vincula el hilo a una solicitud existente en la que la persona participa. */
export async function vincularHilo(
  d: CorreoDeps,
  acceso: AccesoCorreo,
  conversationId: string,
  idRequest: number,
  ip: string | null,
  acuse?: OpcionesAcuse
): Promise<VinculoHilo & { acuse?: ResultadoAcuse }> {
  const sol = await d.kronos.solicitudVisible(acceso.idUser, idRequest);
  if (!sol) throw new CorreoError('No encontró la solicitud o no participa en ella.', 404);
  if (!puedeUsarEmpresa(acceso, sol.idCompany)) throw new CorreoError('La solicitud es de una empresa a la que usted no pertenece.', 403);
  const prov = await proveedorDe(d, acceso);
  const mensajes = await prov.hilo(conversationId);
  if (mensajes.length === 0) throw new CorreoError('No se encontró el hilo en su buzón.', 404);
  const v = await data.vincularExistente(d.db, { idUser: acceso.idUser, mailbox: buzon(acceso), conversationId, idRequest, asunto: sol.asunto });
  await data.auditar(d.db, { idUser: acceso.idUser, accion: 'VINCULAR', conversationId, idRequest, detalle: 'Hilo vinculado a una solicitud existente', ip });
  if (!acuse?.enviar) return v;
  const r = await enviarAcuse(d, acceso, { conversationId, ...acuse, ip, prov, titulo: sol.asunto, idCompany: sol.idCompany, hilo: mensajes });
  return { ...v, acuse: r };
}

// ---------------------------------------------------------------------------
// Responder
// ---------------------------------------------------------------------------

export async function responder(
  d: CorreoDeps,
  acceso: AccesoCorreo,
  p: { mensajeId: string; texto: string; todos: boolean; adjuntos: ArchivoAdjunto[]; ip: string | null }
): Promise<{ notaEnSolicitud: number | null }> {
  const texto = String(p.texto ?? '').trim();
  if (texto.length === 0) throw new CorreoError('Escriba la respuesta.', 400);
  if (texto.length > CORREO_MAX_RESPUESTA_CHARS) throw new CorreoError('La respuesta es demasiado larga.', 400);
  if (p.adjuntos.length > CORREO_MAX_ADJUNTOS_RESPUESTA) throw new CorreoError(`Máximo ${CORREO_MAX_ADJUNTOS_RESPUESTA} adjuntos por respuesta.`, 400);
  const total = p.adjuntos.reduce((s, a) => s + a.bytes.length, 0);
  if (p.adjuntos.some((a) => a.bytes.length > CORREO_MAX_ADJUNTO_RESPUESTA_BYTES)) throw new CorreoError('Cada adjunto de la respuesta puede pesar máximo 3 MB.', 400);
  if (total > CORREO_MAX_TOTAL_RESPUESTA_BYTES) throw new CorreoError('Los adjuntos de la respuesta suman más de 10 MB.', 400);
  if (!d.cfg.envioHabilitado) throw new CorreoError('Responder desde SynerLink no está habilitado en este ambiente.', 403);
  const prov = await proveedorDe(d, acceso);
  // Se lee el mensaje del buzón PROPIO: si el id no es de su buzón, Graph responde 404.
  const original = await prov.mensaje(p.mensajeId);
  // La respuesta admite Markdown sencillo (negrita, cursiva, listas, enlaces): sale como HTML saneado.
  const comentarioHtml = markdownAHtml(texto);
  await prov.responder(original.id, { texto: markdownATexto(texto), todos: p.todos, adjuntos: p.adjuntos, ...(comentarioHtml ? { comentarioHtml } : {}) });
  invalidarHilo(acceso.idUser, original.conversationId);
  const vinculo = original.conversationId ? await data.vinculoDeHilo(d.db, acceso.idUser, original.conversationId) : null;
  const para = p.todos ? [original.de, ...original.para, ...original.cc].map((x) => x.correo).filter((c) => c && c !== acceso.email.toLowerCase()) : [original.de.correo];
  await data.auditar(d.db, {
    idUser: acceso.idUser,
    mailbox: buzon(acceso),
    accion: 'RESPONDER',
    mensajeId: original.id,
    conversationId: original.conversationId,
    internetMessageId: original.internetMessageId,
    idRequest: vinculo?.idRequest ?? null,
    detalle: `Respuesta${p.todos ? ' a todos' : ''} enviada (${p.adjuntos.length} adjunto(s))`,
    ip: p.ip,
  });
  if (!vinculo) return { notaEnSolicitud: null };
  await d.kronos.insertarNota(
    vinculo.idRequest,
    notaDesdeRespuesta({ operador: acceso.nombre, para: [...new Set(para)], texto: markdownATexto(texto), adjuntos: p.adjuntos.map((a) => a.nombre), todos: p.todos }, CORREO_MAX_NOTA),
    acceso.idUser
  );
  return { notaEnSolicitud: vinculo.idRequest };
}

// ---------------------------------------------------------------------------
// Simulación y creación
// ---------------------------------------------------------------------------

export interface Simulacion extends CatalogoCorreo {
  filas: FilaSimulacion[];
}

export async function simular(
  d: CorreoDeps,
  acceso: AccesoCorreo,
  p: { mensajesIds: string[]; idCompany: number; procesoPredeterminado: number | null; ip?: string | null }
): Promise<Simulacion> {
  if (!puedeUsarEmpresa(acceso, p.idCompany)) throw new CorreoError('Usted no pertenece a esa empresa.', 403);
  const prov = await proveedorDe(d, acceso);
  const mensajes: MensajeCompleto[] = [];
  for (const id of p.mensajesIds) mensajes.push(await prov.mensaje(id));
  const grupos = agruparPorHilo(mensajes);
  const [catalogo, usuarios, porCorreo, vinculos] = await Promise.all([
    d.kronos.catalogoEmpresa(p.idCompany),
    data.usuariosPorCorreo(d.db, mensajes.map((m) => m.de.correo)),
    data.solicitudesDeCorreos(d.db, mensajes.map((m) => m.internetMessageId)),
    data.vinculosDeHilos(d.db, acceso.idUser, grupos.map((g) => g[0].conversationId)),
  ]);
  // Solo bloquean las solicitudes que siguen existiendo (un vínculo huérfano se limpia al crear).
  const candidatas = [...new Set([...porCorreo.values(), ...[...vinculos.values()].map((v) => v.idRequest)].filter(Boolean))];
  const vigentes = new Set<number>();
  for (const id of candidatas) if (await d.kronos.solicitudExiste(id)) vigentes.add(id);
  const duplicados = new Map<string, number>([...porCorreo].filter(([, id]) => vigentes.has(id)));
  for (const [conv, v] of vinculos) if (vigentes.has(v.idRequest)) duplicados.set(conv, v.idRequest);
  await auditarLectura(d, acceso, { accion: 'SIMULAR', detalle: `${mensajes.length} correo(s) leídos para simular` }, p.ip ?? null);
  const filas = grupos.map((g) =>
    filaDesdeHilo(g, {
      idOperador: acceso.idUser,
      idCompany: p.idCompany,
      procesos: catalogo.procesos,
      procesoPredeterminado: p.procesoPredeterminado,
      usuarios,
      duplicados,
      dominiosGrupo: d.dominiosGrupo,
    })
  );
  return { filas, categorias: catalogo.categorias, procesos: catalogo.procesos };
}

/**
 * Crea UNA solicitud desde una fila de la simulación. Del navegador solo se
 * aceptan los campos editables; el correo, el hilo y los adjuntos se releen del
 * buzón de la persona. Idempotente: el hilo se reserva antes de crear.
 */
export async function crearDesdeFila(
  d: CorreoDeps,
  acceso: AccesoCorreo,
  fila: FilaCrear & { mensajesIds: string[]; acuse?: OpcionesAcuse },
  ip: string | null
): Promise<ResultadoCreacion> {
  if (!puedeUsarEmpresa(acceso, fila.idCompany)) throw new CorreoError('Usted no pertenece a esa empresa.', 403);
  const { procesos } = await d.kronos.catalogoEmpresa(fila.idCompany);
  if (!procesos.some((x) => x.id === fila.idProcess)) throw new CorreoError('El proceso no está activo en la empresa elegida.', 400);
  const solicitante = await data.usuarioDeEmpresa(d.db, fila.idSolicitante, fila.idCompany);
  if (!solicitante) throw new CorreoError('El solicitante no es un usuario activo de la empresa elegida.', 400);

  const prov = await proveedorDe(d, acceso);
  const hilo = await prov.hilo(fila.conversationId);
  const ids = new Set([fila.mensajeId, ...fila.mensajesIds]);
  const elegidos = hilo.filter((m) => ids.has(m.id));
  if (!elegidos.some((m) => m.id === fila.mensajeId)) throw new CorreoError('El correo no pertenece a ese hilo de su buzón.', 404);

  const reserva = await data.reservarHilo(d.db, {
    idUser: acceso.idUser,
    mailbox: buzon(acceso),
    conversationId: fila.conversationId,
    asunto: fila.titulo,
    correos: elegidos.map((m) => ({ internetMessageId: m.internetMessageId, recibido: m.fecha })),
    solicitudExiste: (id) => d.kronos.solicitudExiste(id),
  });
  if (reserva.limpiados?.length) {
    await data.auditar(d.db, {
      idUser: acceso.idUser,
      accion: 'VINCULO_HUERFANO',
      conversationId: fila.conversationId,
      detalle: `Vínculo(s) huérfano(s) limpiado(s) antes de crear: ${reserva.limpiados.join(', ')}`,
      ip,
    });
  }

  let idRequest: number;
  try {
    const r = await d.crearSolicitud({
      company: fila.idCompany,
      subject: fila.titulo,
      descripcion: fila.descripcion,
      process: fila.idProcess,
      createdby: solicitante.id,
      url: null,
      formValues: [],
    });
    idRequest = r.id_request;
    await data.activarHilo(d.db, reserva.idLink, idRequest);
    d.notificarNueva({
      requestId: idRequest,
      subject: fila.titulo,
      processEmail: r.processEmail,
      processEmails: r.processEmails,
      taskEmails: r.taskEmails,
      creatorEmail: solicitante.correo,
    });
  } catch (e) {
    try {
      await data.liberarHilo(d.db, reserva.idLink);
    } catch {
      /* la reserva queda en CREANDO; el error original es el que importa */
    }
    throw e;
  }

  // Adjuntos (no bloquean: la solicitud ya existe).
  const permitidos = new Map(elegidos.flatMap((m) => m.adjuntos.filter((a) => !a.enLinea).map((a) => [a.id, { m, a }] as const)));
  const archivos: ArchivoAdjunto[] = [];
  const fallidos: string[] = [];
  for (const idAdj of fila.adjuntosIds) {
    const x = permitidos.get(idAdj);
    if (!x) continue;
    if (x.a.tamano > CORREO_MAX_ADJUNTO_BYTES) {
      fallidos.push(`${x.a.nombre}: supera 25 MB`);
      continue;
    }
    try {
      archivos.push(await prov.adjunto(x.m.id, idAdj));
    } catch (e) {
      fallidos.push(`${x.a.nombre}: ${e instanceof Error ? e.message : 'no se pudo leer'}`);
    }
  }
  let subidos = 0;
  if (archivos.length) {
    try {
      const up = await d.subirAdjuntos(idRequest, archivos);
      subidos = up.subidos;
      fallidos.push(...up.fallidos);
    } catch (e) {
      fallidos.push(`OneDrive: ${e instanceof Error ? e.message : 'error'}`);
    }
  }

  let etiquetado = false;
  if (fila.etiquetar && d.cfg.etiquetarHabilitado) {
    try {
      for (const m of elegidos) await prov.categorizar(m.id, correoCategoria(idRequest));
      etiquetado = true;
      await data.auditar(d.db, { idUser: acceso.idUser, accion: 'ETIQUETAR', conversationId: fila.conversationId, idRequest, detalle: correoCategoria(idRequest), ip });
    } catch {
      etiquetado = false;
    }
  }

  await data.auditar(d.db, {
    idUser: acceso.idUser,
    mailbox: buzon(acceso),
    accion: 'CREAR_SOLICITUD',
    mensajeId: fila.mensajeId,
    conversationId: fila.conversationId,
    internetMessageId: elegidos[0].internetMessageId,
    idRequest,
    detalle: `Empresa ${fila.idCompany}, proceso ${fila.idProcess}, solicitante ${solicitante.id}, ${elegidos.length} correo(s), adjuntos ${subidos}/${fila.adjuntosIds.length}`,
    ip,
  });
  // Acuse en el hilo: SOLO después de crear la solicitud; nunca la deshace ni lanza.
  const acuse = fila.acuse?.enviar
    ? await enviarAcuse(d, acceso, { conversationId: fila.conversationId, ...fila.acuse, ip, prov, titulo: fila.titulo, idCompany: fila.idCompany, hilo })
    : undefined;
  return { conversationId: fila.conversationId, ok: true, idRequest, adjuntosSubidos: subidos, adjuntosFallidos: fallidos, etiquetado, ...(acuse ? { acuse } : {}) };
}

// ---------------------------------------------------------------------------
// Acuse automático en el hilo
// ---------------------------------------------------------------------------

/**
 * Mensaje del hilo al que se responde: el más reciente del remitente de origen (para que el
 * acuse le llegue a quien pidió); si no hay, el más reciente que no sea de la persona.
 */
export function mensajeParaAcuse(hilo: MensajeCompleto[], propio: string): MensajeCompleto | null {
  const recibidos = [...hilo].sort((a, b) => a.fecha.localeCompare(b.fecha)).filter((m) => m.de.correo.toLowerCase() !== propio);
  if (recibidos.length === 0) return null;
  const origen = recibidos[0].de.correo.toLowerCase();
  return [...recibidos].reverse().find((m) => m.de.correo.toLowerCase() === origen) ?? recibidos[recibidos.length - 1];
}

/** Destinatarios de la respuesta (como los arma Outlook): el remitente, o todos sin la persona. */
export function destinatariosAcuse(m: MensajeCompleto, propio: string, todos: boolean): string[] {
  const base = todos ? [m.de, ...m.para, ...m.cc] : [m.de];
  return [...new Set(base.map((x) => x.correo.trim().toLowerCase()).filter((c) => c && c !== propio))];
}

/**
 * Responde en el hilo que la solicitud quedó creada. Reglas (Nicolás, 2026-10-15):
 * respeta CORREO_ENVIO_HABILITADO; idempotente por solicitud + hilo (reserva en
 * email_thread_message ANTES de enviar; si el envío falla, se libera para reintentar);
 * no va a destinatarios externos sin confirmación explícita; queda en la auditoría y
 * como nota del caso. NUNCA lanza: la solicitud ya existe y el resultado va al resumen.
 */
export async function enviarAcuse(
  d: CorreoDeps,
  acceso: AccesoCorreo,
  p: {
    conversationId: string;
    todos: boolean;
    confirmarExterno: boolean;
    ip: string | null;
    prov?: MailProvider;
    titulo?: string | null;
    idCompany?: number | null;
    hilo?: MensajeCompleto[];
  }
): Promise<ResultadoAcuse> {
  if (!d.cfg.envioHabilitado) return { estado: 'DESHABILITADO', mensaje: 'Responder desde SynerLink no está habilitado en este ambiente.' };
  let reservado: { idLink: number; clave: string } | null = null;
  let idRequest: number | undefined;
  try {
    const vinculo = await data.vinculoDeHilo(d.db, acceso.idUser, p.conversationId);
    if (!vinculo || !vinculo.idRequest) return { estado: 'OMITIDO', codigo: 'SIN_VINCULO', mensaje: 'El hilo no está vinculado a una solicitud.' };
    idRequest = vinculo.idRequest;
    const propio = buzon(acceso);
    const prov = p.prov ?? (await proveedorDe(d, acceso));
    const hilo = p.hilo ?? (await prov.hilo(p.conversationId));
    const destino = mensajeParaAcuse(hilo, propio);
    if (!destino) return { estado: 'OMITIDO', idRequest, mensaje: 'El hilo no tiene correos recibidos a los cuales responder.' };
    const para = destinatariosAcuse(destino, propio, p.todos);
    if (para.length === 0) return { estado: 'OMITIDO', idRequest, mensaje: 'No hay destinatarios para la respuesta.' };
    const externos = para.filter((c) => !d.dominiosGrupo.includes(c.split('@')[1] ?? ''));
    if (externos.length > 0 && !p.confirmarExterno) {
      return {
        estado: 'OMITIDO',
        codigo: 'EXTERNO_SIN_CONFIRMAR',
        idRequest,
        para: externos,
        mensaje: `No se respondió: hay destinatarios externos al grupo (${externos.join(', ')}). Confírmelo para enviar.`,
      };
    }

    const clave = claveAcuse(vinculo.idRequest, vinculo.id);
    if (!(await data.reservarAcuse(d.db, vinculo.id, clave))) {
      return { estado: 'YA_ENVIADO', idRequest, mensaje: 'La respuesta automática ya se había enviado en este hilo.' };
    }
    reservado = { idLink: vinculo.id, clave };

    // Datos de la tarjeta (empresa, proceso, fecha, responsable): si la consulta falla, el acuse
    // sale igual con lo que se sepa.
    let sol: SolicitudVisible | null = null;
    try {
      sol = await d.kronos.solicitudVisible(acceso.idUser, vinculo.idRequest);
    } catch {
      sol = null;
    }
    const idCompany = p.idCompany ?? sol?.idCompany ?? null;
    const titulo = p.titulo || vinculo.asunto || sol?.asunto || '';
    const enlace = enlaceSolicitud(d.appBaseUrl ?? '', vinculo.idRequest);
    const texto = textoAcuse({ id: vinculo.idRequest, titulo, enlace, firma: acceso.nombre, idCompany });
    const html = fragmentoAcuse({
      id: vinculo.idRequest,
      titulo,
      enlace,
      firma: acceso.nombre,
      empresa: sol?.empresa ?? acceso.empresas.find((e) => e.idCompany === idCompany)?.companyName ?? null,
      categoria: sol?.categoria ?? null,
      proceso: sol?.proceso ?? null,
      creada: sol?.creada ?? null,
      responsable: sol?.responsable ?? null,
      logoUrl: logoAcuseUrl(d.appBaseUrl),
    });
    await prov.responder(destino.id, { texto, html, todos: p.todos, adjuntos: [] });
    invalidarHilo(acceso.idUser, p.conversationId);
    // Ya salió: la reserva queda como constancia. Lo que sigue no debe invitar a reenviarlo.
    reservado = null;

    await sinFallar(() =>
      data.auditar(d.db, {
        idUser: acceso.idUser,
        mailbox: propio,
        accion: 'ACUSE_HILO',
        mensajeId: destino.id,
        conversationId: p.conversationId,
        internetMessageId: destino.internetMessageId,
        idRequest: vinculo.idRequest,
        detalle: `Acuse automático${p.todos ? ' a todos' : ''} enviado (${para.length} destinatario(s))`,
        ip: p.ip,
      })
    );
    await sinFallar(() =>
      d.kronos.insertarNota(vinculo.idRequest, notaDesdeRespuesta({ operador: acceso.nombre, para, texto, adjuntos: [], todos: p.todos, automatica: true }, CORREO_MAX_NOTA), acceso.idUser)
    );
    return { estado: 'ENVIADO', idRequest, para };
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : 'No se pudo enviar la respuesta.';
    const r = reservado;
    if (r) await sinFallar(() => data.liberarAcuse(d.db, r.idLink, r.clave));
    await sinFallar(() =>
      data.auditar(d.db, { idUser: acceso.idUser, mailbox: buzon(acceso), accion: 'ACUSE_HILO_FALLIDO', conversationId: p.conversationId, idRequest: idRequest ?? null, detalle: mensaje, ip: p.ip })
    );
    return { estado: 'ERROR', idRequest, mensaje };
  }
}

/** Tarea de fondo (APAGADA por defecto): pasa a notas los correos nuevos de los hilos vinculados. */
export async function sincronizarTodo(
  d: CorreoDeps,
  accesoDe: (idUser: string) => Promise<AccesoCorreo | null>,
  limite = 50
): Promise<{ hilos: number; agregadas: number; errores: number; omitido?: string }> {
  if (!d.cfg.syncHabilitado) return { hilos: 0, agregadas: 0, errores: 0, omitido: 'CORREO_SYNC_HABILITADO no está activo' };
  if (d.cfg.modo === 'off') return { hilos: 0, agregadas: 0, errores: 0, omitido: 'CORREO_MODO=off' };
  // Con la app de aplicación no hace falta offline_access: la tarea lee el buzón del dueño de cada
  // vínculo (siempre por mailboxForSession con SU correo), solo si aún tiene el permiso del módulo.
  const hilos = await data.hilosParaSincronizar(d.db, limite);
  let agregadas = 0;
  let errores = 0;
  for (const h of hilos) {
    try {
      const acceso = await accesoDe(h.idUser);
      if (!acceso) continue;
      agregadas += (await sincronizarHilo(d, acceso, h.conversationId, null)).agregadas;
    } catch {
      errores++;
    }
  }
  return { hilos: hilos.length, agregadas, errores };
}
