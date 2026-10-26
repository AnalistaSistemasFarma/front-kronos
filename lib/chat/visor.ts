/**
 * VISORES DE ADJUNTOS DEL CHAT — reglas puras (2026-10-22).
 *
 * Pedido de Nicolás Rivera (2026-10-22, 11:09 COT): «evitemos la descarga de
 * archivos y tengamos previsualizadores de archivos xlsx, word, powerpoint,
 * md, etc.». Precisión del mismo día: «ya después de abierto, si decidimos si
 * lo descargamos o no» — al tocar un adjunto SIEMPRE se abre primero el visor,
 * y Descargar vive DENTRO del visor, nunca en la burbuja.
 *
 * Este archivo es isomórfico (lo usan la ruta del servidor y el navegador):
 * decide qué visor le toca a cada archivo, arma la URL de la vista y trae los
 * dos ayudantes de los visores de texto (CSV a tabla y resaltado básico).
 * Nada de HTML: el resaltado devuelve FICHAS que React pinta como texto.
 */

export type TipoVisor =
  | 'imagen'
  | 'pdf'
  /** Word, PowerPoint y Excel viejo: PDF convertido por Microsoft Graph. */
  | 'office'
  /** .xlsx / .xlsm: las hojas como tablas (mismo motor del visor del SGC); PDF de Graph como respaldo. */
  | 'hoja'
  | 'markdown'
  | 'csv'
  | 'texto'
  | 'audio'
  | 'video'
  | 'ninguno';

const IMAGEN = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif']);
const OFFICE = new Set(['doc', 'docx', 'odt', 'rtf', 'ppt', 'pptx', 'pps', 'ppsx', 'odp', 'xls', 'ods']);
const HOJA = new Set(['xlsx', 'xlsm']);
const MARKDOWN = new Set(['md', 'markdown']);
const CSV = new Set(['csv', 'tsv']);

/** Extensión → lenguaje del resaltado (o 'plano'). */
const LENGUAJE: Record<string, Lenguaje> = {
  txt: 'plano',
  log: 'plano',
  ini: 'plano',
  json: 'json',
  sql: 'sql',
  ts: 'codigo',
  tsx: 'codigo',
  js: 'codigo',
  jsx: 'codigo',
  mjs: 'codigo',
  cjs: 'codigo',
  py: 'codigo',
  sh: 'codigo',
  css: 'codigo',
  xml: 'marcado',
  html: 'marcado',
  htm: 'marcado',
  yaml: 'plano',
  yml: 'plano',
};

/** Tipos de audio y video que se sirven EN LÍNEA (el reproductor del navegador). */
export const MEDIO_POR_EXT: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};
const MEDIO_TIPOS = new Set([...Object.values(MEDIO_POR_EXT), 'audio/webm', 'audio/x-m4a', 'audio/x-wav']);

export type Lenguaje = 'plano' | 'json' | 'sql' | 'codigo' | 'marcado';

export function extensionDe(fileName: string | null | undefined): string {
  return (fileName ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
}

function tipoBase(contentType: string | null | undefined): string {
  return (contentType ?? '').split(';')[0].trim().toLowerCase();
}

/**
 * Qué visor le corresponde a un adjunto. Manda la EXTENSIÓN (el tipo que
 * declara el navegador al subir es poco fiable: un .md llega como
 * `application/octet-stream`, un .csv como `application/vnd.ms-excel`), con el
 * tipo declarado como respaldo para lo que no tiene extensión conocida.
 * SVG nunca es imagen: es un documento con scripts (se ve como texto).
 */
export function tipoDeVisor(contentType: string | null | undefined, fileName: string | null | undefined): TipoVisor {
  const ext = extensionDe(fileName);
  const ct = tipoBase(contentType);
  if (IMAGEN.has(ext)) return 'imagen';
  if (ext === 'pdf') return 'pdf';
  if (HOJA.has(ext)) return 'hoja';
  if (OFFICE.has(ext)) return 'office';
  if (MARKDOWN.has(ext)) return 'markdown';
  if (CSV.has(ext)) return 'csv';
  if (ext === 'svg') return 'texto';
  if (ext in LENGUAJE) return 'texto';
  if (ext === 'webm') return ct.startsWith('audio/') ? 'audio' : 'video';
  if (ext in MEDIO_POR_EXT) return MEDIO_POR_EXT[ext].startsWith('audio/') ? 'audio' : 'video';
  // Sin extensión conocida: el tipo declarado.
  if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(ct)) return 'imagen';
  if (ct === 'application/pdf') return 'pdf';
  if (ct === 'text/markdown') return 'markdown';
  if (ct === 'text/csv') return 'csv';
  if (ct === 'application/json' || ct.startsWith('text/')) return 'texto';
  if (MEDIO_TIPOS.has(ct)) return ct.startsWith('audio/') ? 'audio' : 'video';
  return 'ninguno';
}

/** Lenguaje del resaltado de un archivo de texto. */
export function lenguajeDe(fileName: string | null | undefined): Lenguaje {
  const ext = extensionDe(fileName);
  if (ext === 'svg') return 'marcado';
  return LENGUAJE[ext] ?? 'plano';
}

/** Tipo con que se sirve un audio/video en línea, o null si no es un medio reproducible. */
export function tipoMedioEnLinea(contentType: string | null | undefined, fileName: string | null | undefined): string | null {
  const tipo = tipoDeVisor(contentType, fileName);
  if (tipo !== 'audio' && tipo !== 'video') return null;
  const ct = tipoBase(contentType);
  if (MEDIO_TIPOS.has(ct)) return ct;
  const ext = extensionDe(fileName);
  if (ext === 'webm') return tipo === 'audio' ? 'audio/webm' : 'video/webm';
  return MEDIO_POR_EXT[ext] ?? null;
}

/**
 * URL de la VISTA de un adjunto del chat (`/api/chat/attachments/<id>/vista`),
 * o null si la URL de descarga no es la del chat (p. ej. un archivo de
 * proyecto): ese archivo se queda sin vista previa y solo ofrece Descargar.
 */
export function urlVistaAdjunto(downloadUrl: string | null | undefined, como?: 'pdf'): string | null {
  const m = /^\/api\/chat\/attachments\/(\d+)$/.exec(downloadUrl ?? '');
  if (!m) return null;
  return `/api/chat/attachments/${m[1]}/vista${como ? `?como=${como}` : ''}`;
}

/** Tope del texto que se muestra (el resto se avisa como recortado). */
export const MAX_TEXTO_VISOR_BYTES = 2 * 1024 * 1024;
/** Tope de filas de la tabla CSV. */
export const MAX_FILAS_CSV = 2000;

/* ───────────────────────────── CSV a tabla ──────────────────────────── */

/** Separador probable: el que más aparece en la primera línea (fuera de comillas). */
export function separadorCsv(texto: string, fileName?: string | null): string {
  if (extensionDe(fileName) === 'tsv') return '\t';
  const primera = texto.split(/\r?\n/, 1)[0] ?? '';
  let mejor = ',';
  let max = -1;
  for (const s of [',', ';', '\t', '|']) {
    let n = 0;
    let comillas = false;
    for (const ch of primera) {
      if (ch === '"') comillas = !comillas;
      else if (!comillas && ch === s) n++;
    }
    if (n > max) {
      max = n;
      mejor = s;
    }
  }
  return mejor;
}

/**
 * CSV (RFC 4180: comillas dobles, comillas escapadas "" y saltos de línea
 * dentro de comillas) a filas de texto. Se detiene en `maxFilas`.
 */
export function parsearCsv(texto: string, separador = ',', maxFilas = MAX_FILAS_CSV): { filas: string[][]; recortado: boolean } {
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let comillas = false;
  const src = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (comillas) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          celda += '"';
          i++;
        } else comillas = false;
      } else celda += ch;
      continue;
    }
    if (ch === '"' && celda === '') comillas = true;
    else if (ch === separador) {
      fila.push(celda);
      celda = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = '';
      if (filas.length >= maxFilas) return { filas, recortado: i < src.length - 1 };
    } else celda += ch;
  }
  if (celda !== '' || fila.length > 0) {
    fila.push(celda);
    filas.push(fila);
  }
  return { filas, recortado: false };
}

/* ──────────────────────── Resaltado básico ──────────────────────────── */

export type ClaseFicha = 'texto' | 'cadena' | 'numero' | 'comentario' | 'clave' | 'literal' | 'etiqueta';
export interface Ficha {
  clase: ClaseFicha;
  texto: string;
}

const CLAVES_SQL = new Set(
  'select from where and or not in is null as join left right inner outer full cross on group by order having limit top offset insert into values update set delete create alter drop table view index procedure function trigger begin end declare exec execute case when then else distinct union all exists between like with return returns if go use primary key foreign references default identity nvarchar varchar int bigint bit datetime date decimal'.split(
    ' '
  )
);
const CLAVES_CODIGO = new Set(
  'const let var function return if else for while do switch case break continue new class extends implements interface type enum import export from default async await try catch finally throw typeof instanceof in of this super void yield static public private protected readonly as def lambda pass elif self None True False echo fi then esac'.split(
    ' '
  )
);
const LITERALES = new Set(['true', 'false', 'null', 'undefined']);

const esDigito = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';

/** Fin de un número que empieza en `i` (-12, 3.5, 1e-3), o `i` si no hay número. Sin regex. */
function numeroEn(texto: string, i: number): number {
  let j = i;
  if (texto[j] === '-') j++;
  if (!esDigito(texto[j])) return i;
  while (esDigito(texto[j])) j++;
  if (texto[j] === '.' && esDigito(texto[j + 1])) {
    j++;
    while (esDigito(texto[j])) j++;
  }
  if ((texto[j] === 'e' || texto[j] === 'E') && (esDigito(texto[j + 1]) || ((texto[j + 1] === '+' || texto[j + 1] === '-') && esDigito(texto[j + 2])))) {
    j += texto[j + 1] === '+' || texto[j + 1] === '-' ? 2 : 1;
    while (esDigito(texto[j])) j++;
  }
  return j;
}

/**
 * Parte el texto en fichas con su clase para pintarlas con color. Es un
 * resaltado BÁSICO (cadenas, números, comentarios, palabras clave), sin
 * dependencias. Concatenar los `texto` devuelve exactamente la entrada.
 */
export function resaltar(texto: string, lenguaje: Lenguaje): Ficha[] {
  if (lenguaje === 'plano') return [{ clase: 'texto', texto }];
  const fichas: Ficha[] = [];
  const empujar = (clase: ClaseFicha, t: string) => {
    if (!t) return;
    const ultima = fichas[fichas.length - 1];
    if (ultima && ultima.clase === clase) ultima.texto += t;
    else fichas.push({ clase, texto: t });
  };
  const comentarioLinea = lenguaje === 'sql' ? '--' : lenguaje === 'codigo' ? '//' : null;
  let i = 0;
  while (i < texto.length) {
    const resto = texto.slice(i);
    // Comentarios.
    if (lenguaje === 'marcado' && resto.startsWith('<!--')) {
      const fin = texto.indexOf('-->', i + 4);
      const hasta = fin === -1 ? texto.length : fin + 3;
      empujar('comentario', texto.slice(i, hasta));
      i = hasta;
      continue;
    }
    if (lenguaje !== 'json' && lenguaje !== 'marcado' && resto.startsWith('/*')) {
      const fin = texto.indexOf('*/', i + 2);
      const hasta = fin === -1 ? texto.length : fin + 2;
      empujar('comentario', texto.slice(i, hasta));
      i = hasta;
      continue;
    }
    if ((comentarioLinea && resto.startsWith(comentarioLinea)) || (lenguaje === 'codigo' && texto[i] === '#' && (i === 0 || texto[i - 1] === '\n'))) {
      const fin = texto.indexOf('\n', i);
      const hasta = fin === -1 ? texto.length : fin;
      empujar('comentario', texto.slice(i, hasta));
      i = hasta;
      continue;
    }
    if (lenguaje === 'marcado') {
      if (texto[i] === '<') {
        const fin = texto.indexOf('>', i);
        const hasta = fin === -1 ? texto.length : fin + 1;
        empujar('etiqueta', texto.slice(i, hasta));
        i = hasta;
      } else {
        const fin = texto.indexOf('<', i);
        const hasta = fin === -1 ? texto.length : fin;
        empujar('texto', texto.slice(i, hasta));
        i = hasta;
      }
      continue;
    }
    const ch = texto[i];
    // Cadenas.
    if (ch === '"' || ch === "'" || (ch === '`' && lenguaje === 'codigo')) {
      let j = i + 1;
      while (j < texto.length && texto[j] !== ch) {
        if (texto[j] === '\\' && lenguaje !== 'sql') j++;
        else if (texto[j] === '\n' && ch !== '`') break;
        j++;
      }
      const hasta = Math.min(texto.length, j + 1);
      empujar('cadena', texto.slice(i, hasta));
      i = hasta;
      continue;
    }
    // Números.
    const num = numeroEn(texto, i);
    if (num > i && !(i > 0 && /[\w$]/.test(texto[i - 1]))) {
      empujar('numero', texto.slice(i, num));
      i = num;
      continue;
    }
    // Palabras.
    const palabra = /^[A-Za-z_$][\w$]*/.exec(resto);
    if (palabra) {
      const p = palabra[0];
      const baja = p.toLowerCase();
      if (LITERALES.has(baja) && lenguaje !== 'sql') empujar('literal', p);
      else if (lenguaje === 'sql' && CLAVES_SQL.has(baja)) empujar('clave', p);
      else if (lenguaje === 'codigo' && CLAVES_CODIGO.has(p)) empujar('clave', p);
      else empujar('texto', p);
      i += p.length;
      continue;
    }
    empujar('texto', ch);
    i++;
  }
  return fichas;
}
