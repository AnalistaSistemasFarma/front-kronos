/**
 * «COMPARTIR EN SYNERLINK» — reglas comunes (2026-10-22).
 *
 * Pedido de Nicolás: que SynerLink aparezca en el menú Compartir del celular
 * «para que pueda compartir archivos a Orus desde otras apps», como Telegram.
 *
 * Cómo funciona en Android (Chrome/Edge con la PWA instalada):
 *
 *   1. El manifiesto declara `share_target` (app/manifest.ts) con `action`
 *      = SHARE_TARGET_ACTION, POST multipart.
 *   2. El service worker (public/sw.js) intercepta ese POST ANTES de que salga
 *      a la red, guarda los archivos en IndexedDB del propio celular y
 *      redirige a la pantalla SHARE_PAGE_PATH?lote=<id>.
 *   3. La pantalla exige sesión (middleware de /process/*), muestra la vista
 *      previa, deja elegir la conversación y envía con la MISMA ruta del chat
 *      (POST /api/chat/conversations/<id>/messages), que vuelve a validar
 *      permisos, tipos y tamaños. Nada llega al servidor hasta que la persona
 *      confirma.
 *   4. Si el service worker no alcanzó a interceptar (no registrado aún), el
 *      POST cae en app/api/chat/compartir/route.ts, que exige sesión, valida y
 *      redirige a la pantalla con lo que se pueda rescatar (texto y enlace).
 *
 * Módulo ISOMÓRFICO: lo usan el manifiesto, la ruta, la pantalla y las
 * pruebas. Las constantes de IndexedDB están repetidas en public/sw.js (que no
 * puede importar TypeScript); una prueba verifica que coincidan.
 */
import type { MetadataRoute } from 'next';
import { getChatAttachmentError, MAX_CHAT_ATTACHMENTS_PER_MESSAGE } from './attachments';
import { MAX_USER_MESSAGE_CHARS } from './constants';

/** Donde cae el POST del menú Compartir. La intercepta el service worker. */
export const SHARE_TARGET_ACTION = '/api/chat/compartir';

/** Pantalla «Compartir en SynerLink». */
export const SHARE_PAGE_PATH = '/process/chat/compartir';

/** IndexedDB del service worker. ⚠️ Mismos valores en public/sw.js. */
export const SHARE_IDB_NAME = 'synerlink-compartir';
export const SHARE_IDB_STORE = 'lotes';
export const SHARE_IDB_VERSION = 1;

/** Un lote compartido vive como máximo esto en el celular si nadie lo envía. */
export const SHARE_LOTE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Cuántos archivos se GUARDAN de un solo compartir. El chat admite
 * MAX_CHAT_ATTACHMENTS_PER_MESSAGE por mensaje; se guardan algunos más para
 * que la persona vea cuáles sobran y quite los que no quiere, en vez de
 * perderlos en silencio. ⚠️ Mismo valor en public/sw.js.
 */
export const SHARE_MAX_FILES_STORED = 10;

/** Topes de los campos de texto que manda el sistema operativo. */
export const SHARE_MAX_TITLE_CHARS = 300;
export const SHARE_MAX_TEXT_CHARS = 4000;
export const SHARE_MAX_URL_CHARS = 2000;

/**
 * Tipos que se anuncian al sistema operativo para que SynerLink aparezca en el
 * menú Compartir. Es una lista de lo que el chat admite y muestra (imágenes,
 * video, audio, PDF, Office, texto, zip). La validación que MANDA sigue siendo
 * la del servidor (lista de negación de lib/chat/attachments.ts).
 */
export const SHARE_ACCEPT_TYPES: readonly string[] = [
  'image/*',
  'video/*',
  'audio/*',
  'application/pdf',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/zip',
  'application/json',
  'text/plain',
  'text/csv',
  'text/markdown',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.csv',
  '.txt',
  '.zip',
  '.heic',
  '.heif',
];

/** El bloque `share_target` del manifiesto. */
export function shareTargetManifest(): NonNullable<MetadataRoute.Manifest['share_target']> {
  return {
    action: SHARE_TARGET_ACTION,
    method: 'POST',
    enctype: 'multipart/form-data',
    params: {
      title: 'title',
      text: 'text',
      url: 'url',
      files: [{ name: 'files', accept: [...SHARE_ACCEPT_TYPES] }],
    },
  };
}

/* ───────────────────────── Texto que acompaña ─────────────────────────── */

function recortar(valor: unknown, max: number): string {
  if (typeof valor !== 'string') return '';
  return valor.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
}

export interface TextoCompartido {
  title: string;
  text: string;
  url: string;
}

/** Limpia y recorta lo que llega del sistema operativo. */
export function normalizarTextoCompartido(raw: {
  title?: unknown;
  text?: unknown;
  url?: unknown;
}): TextoCompartido {
  const url = recortar(raw.url, SHARE_MAX_URL_CHARS);
  return {
    title: recortar(raw.title, SHARE_MAX_TITLE_CHARS),
    text: recortar(raw.text, SHARE_MAX_TEXT_CHARS),
    // Solo enlaces web: un `javascript:` en el comentario sería ruido peligroso.
    url: /^https?:\/\//i.test(url) ? url : '',
  };
}

/**
 * Comentario inicial del mensaje a partir de title/text/url. Muchas apps
 * repiten el enlace dentro de `text` (Chrome manda la URL en `text`); no se
 * duplica.
 */
export function armarComentarioInicial(t: TextoCompartido): string {
  const partes: string[] = [];
  if (t.title && !t.text.includes(t.title)) partes.push(t.title);
  if (t.text) partes.push(t.text);
  if (t.url && !partes.some((p) => p.includes(t.url))) partes.push(t.url);
  return partes.join('\n').slice(0, MAX_USER_MESSAGE_CHARS);
}

/* ───────────────────────── Validación de archivos ─────────────────────── */

export interface ArchivoCompartidoMeta {
  name: string;
  size: number;
}

export interface ValidacionCompartido {
  /** Error por archivo (mismo índice), o null si ese archivo está bien. */
  errores: (string | null)[];
  /** Error del conjunto (p. ej. demasiados archivos), o null. */
  errorGeneral: string | null;
  ok: boolean;
}

/**
 * Valida lo que se va a enviar con LAS MISMAS reglas del chat
 * (getChatAttachmentError + tope por mensaje). El servidor vuelve a validar.
 */
export function validarCompartido(
  archivos: readonly ArchivoCompartidoMeta[],
  comentario: string
): ValidacionCompartido {
  const errores = archivos.map((a) => getChatAttachmentError(a));
  let errorGeneral: string | null = null;
  if (archivos.length > MAX_CHAT_ATTACHMENTS_PER_MESSAGE) {
    errorGeneral = `Puede enviar máximo ${MAX_CHAT_ATTACHMENTS_PER_MESSAGE} archivos por mensaje. Quite ${
      archivos.length - MAX_CHAT_ATTACHMENTS_PER_MESSAGE
    }.`;
  } else if (archivos.length === 0 && comentario.trim() === '') {
    errorGeneral = 'No hay nada que enviar.';
  } else if (comentario.length > MAX_USER_MESSAGE_CHARS) {
    errorGeneral = `El comentario supera ${MAX_USER_MESSAGE_CHARS} caracteres.`;
  }
  return { errores, errorGeneral, ok: errorGeneral === null && errores.every((e) => e === null) };
}

/* ────────────────────────────── Destinos ──────────────────────────────── */

export type TipoDestino = 'agente' | 'grupo' | 'persona' | 'proyecto';

export interface DestinoCompartir {
  /** `agent:<idAgent>` o `conv:<idConversation>`: estable para recordarlo. */
  key: string;
  tipo: TipoDestino;
  nombre: string;
  detalle: string | null;
  avatarCode: string;
  avatarUrl: string | null;
  avatarVersion?: number | null;
  /** null = agente con el que aún no hay hilo (se abre al enviar). */
  idConversation: number | null;
  idAgent?: number;
  agentCode?: string;
  idProject?: number;
  lastMessageAt: string | null;
}

/**
 * Agentes que van PRIMERO (pedido de Nicolás: «compartir a Orus» de un toque).
 * Se compara con el `code` normalizado.
 */
export const AGENTES_PREFERIDOS_COMPARTIR: readonly string[] = ['orus', 'horus'];

function esPreferido(d: DestinoCompartir): boolean {
  return d.tipo === 'agente' && AGENTES_PREFERIDOS_COMPARTIR.includes((d.agentCode ?? '').toLowerCase());
}

function porActividad(a: DestinoCompartir, b: DestinoCompartir): number {
  const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
  const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
  if (tb !== ta) return tb - ta;
  return a.nombre.localeCompare(b.nombre, 'es');
}

/**
 * Orden de la pantalla: AGENTES primero (Orus arriba si lo tiene), luego
 * grupos, personas y proyectos; dentro de cada bloque, por actividad.
 */
export function ordenarDestinos(destinos: readonly DestinoCompartir[]): DestinoCompartir[] {
  const peso: Record<TipoDestino, number> = { agente: 0, grupo: 1, persona: 2, proyecto: 3 };
  return [...destinos].sort((a, b) => {
    if (peso[a.tipo] !== peso[b.tipo]) return peso[a.tipo] - peso[b.tipo];
    const pa = esPreferido(a) ? 0 : 1;
    const pb = esPreferido(b) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return porActividad(a, b);
  });
}

/**
 * Destino que viene SELECCIONADO al abrir: el último usado (si sigue
 * disponible); si no, Orus; si no, el primero de la lista.
 */
export function destinoInicial(
  destinos: readonly DestinoCompartir[],
  ultimaKey: string | null
): DestinoCompartir | null {
  if (ultimaKey) {
    const ultimo = destinos.find((d) => d.key === ultimaKey);
    if (ultimo) return ultimo;
  }
  return destinos.find(esPreferido) ?? destinos[0] ?? null;
}

/** Filtro del buscador (sin tildes, sin mayúsculas). */
export function filtrarDestinos(destinos: readonly DestinoCompartir[], q: string): DestinoCompartir[] {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const n = norm(q.trim());
  if (!n) return [...destinos];
  return destinos.filter((d) => norm(`${d.nombre} ${d.detalle ?? ''}`).includes(n));
}

/** A dónde se va después de enviar. */
export function hrefDestino(d: DestinoCompartir, idConversation: number): string {
  if (d.tipo === 'agente') return `/process/chat/${encodeURIComponent(d.agentCode ?? '')}`;
  if (d.tipo === 'persona') return `/process/chat/persona/${idConversation}`;
  if (d.tipo === 'grupo') return `/process/chat/grupo/${idConversation}`;
  return `/process/proyectos/${d.idProject}?conversacion=${idConversation}`;
}

/** localStorage: último destino usado, por persona (solo comodidad). */
export function claveUltimoDestino(userId: string): string {
  return `synerlink:compartir:ultimo:${userId}`;
}

/** Mensajes de la pantalla para los códigos que manda la ruta o el SW. */
export function mensajeDeAviso(codigo: string | null): string | null {
  switch (codigo) {
    case 'sin-sw':
      return 'SynerLink no alcanzó a recibir los archivos en este celular. Abra SynerLink una vez desde el ícono instalado y vuelva a compartir.';
    case 'recepcion':
      return 'No se pudo recibir lo compartido. Intente de nuevo.';
    case 'lote-vencido':
      return 'Lo compartido ya no está disponible (se guarda máximo 24 horas). Vuelva a compartir.';
    default:
      return null;
  }
}
