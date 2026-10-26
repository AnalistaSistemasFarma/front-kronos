/**
 * Reglas de subida de adjuntos que dependen del DISPOSITIVO y del proxy.
 *
 * Por qué existe (2026-10-16, "adjuntar no funciona en algunos dispositivos"):
 *
 *  1. TIPO DE ARCHIVO. El navegador llena `File.type` según lo que le diga el
 *     sistema operativo o la app que entrega el archivo. En Android (Drive,
 *     WhatsApp, gestores de archivos) y en Windows sin Office instalado llega
 *     vacío (`''`) o como `application/octet-stream` aunque el archivo sea un
 *     .pdf o un .xlsx perfectamente válido. Validar SOLO por MIME rechazaba esos
 *     archivos en el navegador, sin que la petición llegara nunca al servidor.
 *     La regla ahora es: vale si la EXTENSIÓN está permitida o si el MIME lo está.
 *
 *  2. TAMAÑO. IIS (sitio groupsharedservices en serfarma05) corta todo cuerpo
 *     de más de 30.000.000 bytes (requestFiltering, valor por defecto) con un
 *     413 en HTML, antes de que Next lo vea. Las fotos y videos de celular
 *     llegan fácil a ese tamaño. El tope del navegador queda un poco por debajo
 *     (28 MB) para dejar margen al sobre del multipart.
 *
 * Isomórfico: no importa nada de servidor, lo pueden usar componentes y pruebas.
 */

/** Tope que deja pasar IIS por petición (maxAllowedContentLength por defecto). */
export const IIS_MAX_REQUEST_BYTES = 30_000_000;

/** Tope por petición que se valida en el navegador (margen para el multipart). */
export const MAX_UPLOAD_REQUEST_BYTES = 28 * 1024 * 1024;

/** Extensiones permitidas en los adjuntos de solicitudes y tickets. */
export const REQUEST_ATTACHMENT_EXTENSIONS: readonly string[] = [
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'png',
  'jpg',
  'jpeg',
  'txt',
];

/** MIME equivalentes (los que reportan los navegadores cuando sí lo conocen). */
export const REQUEST_ATTACHMENT_MIME_TYPES: readonly string[] = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'text/plain',
];

/**
 * Valor del atributo `accept` del input: extensiones Y MIME. Con solo
 * extensiones, algunos selectores de Android dejan en gris archivos válidos
 * cuando el proveedor los reporta con otro MIME; con ambos se ven todos.
 */
export const REQUEST_ATTACHMENT_ACCEPT = [
  ...REQUEST_ATTACHMENT_EXTENSIONS.map((ext) => `.${ext}`),
  ...REQUEST_ATTACHMENT_MIME_TYPES,
].join(',');

/** Extensión en minúsculas, sin el punto. Cadena vacía si no tiene. */
export function fileExtension(name: string | null | undefined): string {
  const clean = String(name ?? '').trim();
  const dot = clean.lastIndexOf('.');
  if (dot <= 0 || dot === clean.length - 1) return '';
  return clean.slice(dot + 1).toLowerCase();
}

/**
 * ¿El archivo es de un tipo permitido? Basta con que lo sea la extensión o el
 * MIME: un `type` vacío u `octet-stream` no descarta un .pdf.
 */
export function isAllowedRequestAttachment(file: { name: string; type?: string | null }): boolean {
  if (REQUEST_ATTACHMENT_EXTENSIONS.includes(fileExtension(file.name))) return true;
  const mime = String(file.type ?? '').toLowerCase().trim();
  return mime !== '' && REQUEST_ATTACHMENT_MIME_TYPES.includes(mime);
}

/** Tamaño legible (MB con un decimal). */
export function formatUploadMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Mensaje para una respuesta de error que NO trae JSON (la genera IIS/ARR, no
 * la app). Devuelve null si el estado no es de los que conocemos.
 */
export function proxyUploadErrorMessage(status: number): string | null {
  if (status === 413 || status === 404) {
    return `El archivo supera el tamaño que admite el servidor (máx. ${formatUploadMb(
      MAX_UPLOAD_REQUEST_BYTES
    )} por envío).`;
  }
  if (status === 502 || status === 503 || status === 504) {
    return 'El servidor no respondió a tiempo. Intente de nuevo en un momento.';
  }
  return null;
}
