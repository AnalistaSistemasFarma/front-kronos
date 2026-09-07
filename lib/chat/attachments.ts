/**
 * ADJUNTOS del módulo "Asistentes IA" (chat de agentes).
 *
 * -------------------------------------------------------------------------
 * DÓNDE VIVE EL ARCHIVO
 * -------------------------------------------------------------------------
 * El binario NO se guarda en SQL Server: vive en OneDrive y en la base solo
 * queda la referencia (`chat_attachment.onedrive_item_id`). Es exactamente el
 * mismo criterio de almacenamiento que ya usa el SGD para
 * `DocumentVersion.onedrive_item_id` (ver lib/document-management/newVersion.ts
 * y lib/document-management/storagePath.ts), y se reusa el mismo helper de
 * Graph (lib/onedrive/graphFolderUpload.ts) en vez de duplicar las llamadas.
 *
 * -------------------------------------------------------------------------
 * QUÉ PROTEGE ESTE MÓDULO
 * -------------------------------------------------------------------------
 *   1. TRAVESÍA DE RUTAS (path traversal). El nombre del archivo lo escoge
 *      quien sube: "../../otra-carpeta/evil.txt" o "C:\Windows\system32\x" no
 *      pueden convertirse nunca en una ruta de OneDrive ni en una cabecera de
 *      descarga. `sanitizeChatAttachmentName` se queda SOLO con el último
 *      segmento y elimina separadores, puntos suspensivos y caracteres de
 *      control.
 *   2. EJECUTABLES. Se rechazan por EXTENSIÓN del nombre, en minúsculas. NO se
 *      confía en el `content_type` que manda el cliente: ese campo es texto
 *      libre y se falsifica en una línea de `curl`.
 *   3. TAMAÑO Y CANTIDAD. Topes duros por archivo y por mensaje, validados
 *      SIEMPRE en el servidor (la validación del navegador es solo comodidad).
 *   4. IDOR EN LA DESCARGA. `canAccessChatAttachment` es la regla —pura y con
 *      pruebas— que decide si quien pide puede bajar el adjunto.
 *
 * -------------------------------------------------------------------------
 * ISOMÓRFICO A PROPÓSITO
 * -------------------------------------------------------------------------
 * Aquí NO se importa nada de servidor (ni prisma, ni el token de Graph): este
 * módulo lo comparten la API y el compositor del navegador, para que el
 * mensaje que ve el usuario antes de enviar sea LITERALMENTE el mismo que
 * devolvería el servidor. Las funciones que sí hablan con Microsoft Graph
 * viven aparte, en lib/chat/attachmentStorage.ts.
 *
 * Que el navegador valide es comodidad, no seguridad: quien quiera saltarse esa
 * comprobación solo tiene que llamar la API con `curl`. La validación que
 * MANDA es la del servidor, y por eso es la misma función.
 */
import { sanitizeOneDriveName } from '../onedriveName';

/* ─────────────────────────────── Topes ────────────────────────────────── */

/** Tope por archivo: 25 MB. */
export const MAX_CHAT_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Cuántos archivos admite UN mensaje. */
export const MAX_CHAT_ATTACHMENTS_PER_MESSAGE = 5;

/** Tope de longitud del nombre guardado (la columna es NVARCHAR(400)). */
export const MAX_CHAT_ATTACHMENT_NAME_CHARS = 200;

/** Raíz en OneDrive, al estilo de DOCUMENT_MANAGEMENT_ROOT del SGD. */
export const CHAT_ATTACHMENTS_ROOT = 'CHAT-AGENTES';

/**
 * Extensiones BLOQUEADAS: ejecutables, instaladores y guiones de todo tipo.
 *
 * Es una lista de negación a propósito y no una de permisos: el chat es de uso
 * general y una lista blanca dejaría por fuera formatos legítimos de trabajo
 * todos los días. Lo que se corta es lo que un usuario podría abrir por
 * descuido y ejecutar.
 */
export const BLOCKED_ATTACHMENT_EXTENSIONS: readonly string[] = [
  // Ejecutables e instaladores
  'exe', 'com', 'scr', 'msi', 'msp', 'msix', 'appx', 'dll', 'sys', 'drv',
  'cpl', 'ocx', 'pif', 'gadget', 'app', 'pkg', 'dmg', 'deb', 'rpm', 'apk',
  // Procesos por lotes y accesos directos de Windows
  'bat', 'cmd', 'lnk', 'url', 'reg', 'inf', 'scf',
  // Guiones (scripts)
  'ps1', 'psm1', 'psd1', 'vbs', 'vbe', 'js', 'jse', 'mjs', 'cjs', 'wsf',
  'wsh', 'hta', 'sh', 'bash', 'zsh', 'ksh', 'csh', 'py', 'pyc', 'pl', 'rb',
  'php', 'jar', 'class', 'ws', 'ahk',
  // Macros de Office (el formato con "m" final es el que las lleva)
  'docm', 'xlsm', 'xlsb', 'pptm', 'dotm', 'xltm', 'potm', 'xlam', 'ppam',
];

const BLOCKED_SET = new Set(BLOCKED_ATTACHMENT_EXTENSIONS);

/* ───────────────────────── Nombre del archivo ─────────────────────────── */

/**
 * Deja el nombre de archivo en algo seguro de guardar y de devolver en una
 * cabecera `Content-Disposition`.
 *
 * Orden de la limpieza (importa):
 *   1. Se normalizan las barras y se toma SOLO el último segmento -> muere
 *      cualquier "../..", "/etc/passwd" o "C:\ruta\archivo".
 *   2. Se eliminan caracteres de control (incluidos CR/LF, que permitirían
 *      inyectar una cabecera en la respuesta de descarga) y los dos puntos.
 *   3. Se aplica `sanitizeOneDriveName` (el mismo saneador del SGD), que quita
 *      los caracteres que OneDrive/SharePoint rechazan.
 *   4. Se recorta la longitud conservando la extensión.
 *
 * Nunca devuelve cadena vacía: si no queda nada utilizable, devuelve "archivo".
 */
export function sanitizeChatAttachmentName(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : '';

  // 1. Solo el último segmento de la ruta.
  const lastSegment = text.replace(/\\/g, '/').split('/').pop() ?? '';

  // 2. Fuera controles, dos puntos y puntos suspensivos de travesía.
  //    (el rango \u0000-\u001f cubre CR, LF y TAB)
  // eslint-disable-next-line no-control-regex
  const withoutControls = lastSegment.replace(/[\u0000-\u001f\u007f:]/g, '').replace(/\.{2,}/g, '.');

  // 3. Saneador común de OneDrive/SharePoint.
  const cleaned = sanitizeOneDriveName(withoutControls);
  if (!cleaned) return 'archivo';

  // 4. Recorte conservando la extensión.
  if (cleaned.length <= MAX_CHAT_ATTACHMENT_NAME_CHARS) return cleaned;

  const dot = cleaned.lastIndexOf('.');
  const ext = dot > 0 && cleaned.length - dot <= 12 ? cleaned.slice(dot) : '';
  const base = ext ? cleaned.slice(0, dot) : cleaned;
  const trimmed = base.slice(0, Math.max(1, MAX_CHAT_ATTACHMENT_NAME_CHARS - ext.length));
  return `${trimmed}${ext}`;
}

/** Extensión en minúsculas y sin el punto. Cadena vacía si no tiene. */
export function attachmentExtension(fileName: string): string {
  const clean = sanitizeChatAttachmentName(fileName);
  const dot = clean.lastIndexOf('.');
  if (dot <= 0 || dot === clean.length - 1) return '';
  return clean.slice(dot + 1).toLowerCase();
}

/** ¿La extensión está en la lista de bloqueados? */
export function isBlockedAttachmentExtension(fileName: string): boolean {
  const ext = attachmentExtension(fileName);
  return ext !== '' && BLOCKED_SET.has(ext);
}

/**
 * Valida UN candidato a adjunto. Devuelve el mensaje de error (en español,
 * listo para mostrarse) o `null` si es válido.
 *
 * Es la MISMA función que usan el servidor y el navegador: así el mensaje que
 * ve el usuario antes de enviar coincide con el que devolvería la API. La del
 * servidor es la que manda; la del cliente solo evita el viaje.
 */
export function getChatAttachmentError(file: { name: string; size: number }): string | null {
  const name = sanitizeChatAttachmentName(file.name);

  if (name === 'archivo' && !file.name?.trim()) {
    return 'El archivo no tiene nombre.';
  }
  if (isBlockedAttachmentExtension(name)) {
    return `No se permiten archivos ".${attachmentExtension(name)}" (ejecutables y guiones).`;
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return `El archivo "${name}" está vacío.`;
  }
  if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
    return `El archivo "${name}" pesa ${formatBytes(file.size)} y el máximo son ${formatBytes(
      MAX_CHAT_ATTACHMENT_BYTES
    )}.`;
  }
  return null;
}

/** Tamaño legible para los mensajes de error y la interfaz. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ────────────────────── Ruta de carpetas en OneDrive ──────────────────── */

/**
 * Segmentos de carpeta de los adjuntos de una conversación:
 *
 *   CHAT-AGENTES/<id_conversation>/<YYYY-MM>
 *
 * El periodo evita que un hilo viejo y muy usado termine con miles de archivos
 * en una sola carpeta (OneDrive se vuelve lento de listar mucho antes de su
 * límite duro), y de paso hace trivial archivar o purgar por mes.
 */
export function buildChatAttachmentFolderSegments(
  conversationId: number,
  at: Date = new Date()
): string[] {
  const year = at.getFullYear();
  const month = `${at.getMonth() + 1}`.padStart(2, '0');
  return [CHAT_ATTACHMENTS_ROOT, String(conversationId), `${year}-${month}`];
}

/**
 * Nombre con el que el archivo queda GUARDADO en OneDrive.
 *
 * Se le antepone un token corto y único porque `PUT items/{id}:/{nombre}:/content`
 * REEMPLAZA el archivo si ya existe uno con ese nombre en la carpeta: dos
 * personas subiendo "informe.pdf" al mismo hilo en el mismo mes se pisarían el
 * archivo, y el segundo adjunto le cambiaría el contenido al primero. El nombre
 * bonito (el que ve el usuario) es el que va en la base y en la descarga.
 */
export function buildStoredAttachmentName(fileName: string, token?: string): string {
  const safe = sanitizeChatAttachmentName(fileName);
  const unique = (token ?? globalThis.crypto.randomUUID()).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'adjunto';
  return `${unique}-${safe}`;
}

/* ────────────────────────── Lectura del formulario ────────────────────── */

/** Un adjunto candidato, ya extraído del `multipart/form-data`. */
export interface ChatAttachmentCandidate {
  fileName: string;
  contentType: string | null;
  size: number;
  blob: Blob;
}

/**
 * Extrae y VALIDA los archivos del campo `files` de un formulario.
 *
 * Devuelve el error listo para un 400 en cuanto uno falla: si un archivo no
 * pasa, no se sube ninguno. Un envío a medias sería peor que un rechazo.
 */
export function collectChatAttachments(
  form: FormData,
  field = 'files'
): { ok: true; files: ChatAttachmentCandidate[] } | { ok: false; error: string } {
  const raw = form.getAll(field).filter((entry): entry is File => entry instanceof File);

  if (raw.length > MAX_CHAT_ATTACHMENTS_PER_MESSAGE) {
    return {
      ok: false,
      error: `Puede adjuntar máximo ${MAX_CHAT_ATTACHMENTS_PER_MESSAGE} archivos por mensaje (envió ${raw.length}).`,
    };
  }

  const files: ChatAttachmentCandidate[] = [];
  for (const file of raw) {
    const error = getChatAttachmentError({ name: file.name, size: file.size });
    if (error) return { ok: false, error };

    files.push({
      fileName: sanitizeChatAttachmentName(file.name),
      // Se guarda lo que dice el cliente solo como PISTA para la interfaz; la
      // validación nunca depende de este campo (ver el encabezado del módulo).
      contentType: file.type ? file.type.slice(0, 200) : null,
      size: file.size,
      blob: file,
    });
  }

  return { ok: true, files };
}

/* ─────────────────────── Autorización de la descarga ──────────────────── */

/** Quién está pidiendo el archivo. */
export type ChatAttachmentRequester =
  | { kind: 'user'; userId: string }
  | { kind: 'agent'; idAgent: number };

/** Datos de la conversación dueña del adjunto (los únicos que importan aquí). */
export interface ChatAttachmentOwner {
  conversationUserId: string;
  conversationAgentId: number;
}

/**
 * ¿Puede este solicitante bajar este adjunto?
 *
 * Es la regla anti-IDOR del módulo, aislada a propósito en una función pura
 * para poder probarla sin base de datos:
 *
 *   - USUARIO: solo los adjuntos de conversaciones cuyo `id_user` sea el suyo.
 *   - AGENTE:  solo los de conversaciones cuyo `id_agent` corresponda a la
 *              llave presentada (el agente sale de la llave, nunca del
 *              payload — ver lib/chat/agent-auth.ts).
 *
 * Cualquier otro caso es `false`, y la ruta responde 404 —no 403—: un 403 le
 * confirmaría a quien va cambiando el número de la URL que ese adjunto existe.
 */
export function canAccessChatAttachment(
  owner: ChatAttachmentOwner,
  requester: ChatAttachmentRequester
): boolean {
  if (requester.kind === 'user') {
    return Boolean(requester.userId) && owner.conversationUserId === requester.userId;
  }
  return Number.isInteger(requester.idAgent) && owner.conversationAgentId === requester.idAgent;
}

/* ─────────────────── Cabeceras seguras de la descarga ─────────────────── */

/**
 * Tipos que se devuelven tal cual. Cualquier otro se sirve como
 * `application/octet-stream`.
 *
 * El `content_type` guardado lo escogió el cliente que subió el archivo, así
 * que devolverlo sin filtrar sería dejar que un tercero decida cómo interpreta
 * el navegador la respuesta. Con `Content-Disposition: attachment` y
 * `X-Content-Type-Options: nosniff` el riesgo ya es bajo; esta lista lo cierra.
 */
const SAFE_DOWNLOAD_CONTENT_TYPES = new Set([
  'application/pdf',
  'application/json',
  'application/zip',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'text/plain',
  'text/csv',
  'text/markdown',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'video/mp4',
  'video/webm',
]);

export function safeDownloadContentType(stored: string | null | undefined): string {
  const value = (stored ?? '').split(';')[0].trim().toLowerCase();
  return SAFE_DOWNLOAD_CONTENT_TYPES.has(value) ? value : 'application/octet-stream';
}

/**
 * Cabecera `Content-Disposition` de la descarga, con el nombre YA saneado.
 *
 * Se manda dos veces a propósito (RFC 6266): `filename=` en ASCII para los
 * clientes viejos y `filename*=UTF-8''…` para conservar tildes y eñes. Las
 * comillas y las barras del ASCII se quitan para que nadie pueda cerrar el
 * valor y agregar parámetros propios.
 */
export function buildContentDisposition(fileName: string): string {
  const safe = sanitizeChatAttachmentName(fileName);
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
