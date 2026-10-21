/**
 * ADJUNTOS SALIENTES del puente de hilos (2026-10-21).
 *
 * La sesión del hilo no tiene herramienta para subir archivos: escribe el
 * archivo en ./trabajo (donde SIEMPRE tiene Write, en cualquier turno y para
 * cualquier usuario, con o sin código, con o sin sandbox) y lo pide en su
 * respuesta final con una línea sola:
 *
 *     MEDIA:trabajo/informe.csv
 *
 * El puente saca esas líneas del texto, valida cada archivo y lo sube con la
 * respuesta (POST /api/chat/agent/messages en multipart, el mismo camino del
 * conector del canal y de los puentes de openclaw). La sesión nunca ve la
 * llave del puente.
 *
 * CONTROLES (todos fallan cerrado; un archivo rechazado se dice en el hilo):
 *  - Solo dentro de <carpeta de la conversación>/trabajo. Sin segmentos `..`,
 *    sin URLs, sin rutas absolutas fuera de esa carpeta.
 *  - Sin enlaces simbólicos: la ruta real debe ser EXACTAMENTE la pedida; se
 *    abre con O_NOFOLLOW y se revalida con fstat sobre el mismo descriptor.
 *  - Sin archivos ni carpetas ocultas, y nunca el archivo de propuestas.
 *  - Extensión en la lista permitida y fuera de la que bloquea el servidor.
 *  - Archivo regular de 1 byte a 25 MB; máximo 5 por respuesta; sin duplicados.
 * Las notas y el registro solo llevan el NOMBRE del archivo, nunca la ruta.
 */
import { constants as FS } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';

export const MAX_ADJUNTOS = 5;
export const MAX_BYTES_ADJUNTO = 25 * 1024 * 1024;

// Espejo de BLOCKED_ATTACHMENT_EXTENSIONS (lib/chat/attachments.ts).
const EXT_BLOQUEADAS = new Set([
  'exe', 'com', 'scr', 'msi', 'msp', 'msix', 'appx', 'dll', 'sys', 'drv',
  'cpl', 'ocx', 'pif', 'gadget', 'app', 'pkg', 'dmg', 'deb', 'rpm', 'apk',
  'bat', 'cmd', 'lnk', 'url', 'reg', 'inf', 'scf',
  'ps1', 'psm1', 'psd1', 'vbs', 'vbe', 'js', 'jse', 'mjs', 'cjs', 'wsf',
  'wsh', 'hta', 'sh', 'bash', 'zsh', 'ksh', 'csh', 'py', 'pyc', 'pl', 'rb',
  'php', 'jar', 'class', 'ws', 'ahk',
  'docm', 'xlsm', 'xlsb', 'pptm', 'dotm', 'xltm', 'potm', 'xlam', 'ppam',
]);

/** Lista blanca de lo que la sesión puede adjuntar. */
export const EXT_PERMITIDAS = ['xlsx', 'xls', 'csv', 'pdf', 'docx', 'pptx', 'png', 'jpg', 'jpeg', 'txt', 'md', 'json'];
const PERMITIDAS = new Set(EXT_PERMITIDAS);

const MIME = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
export const tipoMime = (nombre) => MIME[path.extname(nombre).slice(1).toLowerCase()] ?? 'application/octet-stream';

const RE_CERCO = /^ {0,3}(`{3,}|~{3,})/;
const RE_MEDIA = /^[ \t]{0,3}(?:[-*][ \t]+)?MEDIA:[ \t]*(\S.*?)[ \t]*$/;
const RE_COMILLAS = /^(["'`<])(.*)(["'`>])$/;

/**
 * Saca las líneas «MEDIA:<ruta>» que están fuera de bloques de código.
 * @returns {{ texto: string, rutas: string[] }}
 */
export function extraerMedia(texto) {
  const original = String(texto ?? '');
  const quedan = [];
  const rutas = [];
  let cerco = null;
  for (const linea of original.split('\n')) {
    const sinCR = linea.replace(/\r$/, '');
    const m = RE_CERCO.exec(sinCR);
    if (m) {
      if (!cerco) cerco = m[1];
      else if (m[1][0] === cerco[0] && m[1].length >= cerco.length && sinCR.trim() === m[1]) cerco = null;
      quedan.push(linea);
      continue;
    }
    if (!cerco) {
      const mm = RE_MEDIA.exec(sinCR);
      if (mm) {
        const r = mm[1].trim().replace(RE_COMILLAS, '$2').trim();
        if (r) {
          rutas.push(r);
          continue;
        }
      }
    }
    quedan.push(linea);
  }
  if (rutas.length === 0) return { texto: original, rutas };
  return { texto: quedan.join('\n').replace(/\n{3,}/g, '\n\n').trim(), rutas };
}

function nombreSeguro(ruta) {
  // eslint-disable-next-line no-control-regex
  const n = path.basename(String(ruta).replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (n || 'archivo').slice(0, 120);
}

/** Ruta absoluta pedida (relativa a la carpeta de la conversación) o null si es inválida. */
function resolverPedida(pedida, cwd) {
  const r = String(pedida);
  if (!r || r.includes('\0')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(r)) return null; // file://, http://, C:…
  if (r.startsWith('~')) return null;
  if (r.split(/[\\/]+/).some((seg) => seg === '..')) return null;
  return path.resolve(cwd, r);
}

/**
 * Valida y LEE los archivos pedidos. Nunca lanza.
 * @param {string[]} rutas
 * @param {{ cwd: string, trabajo: string, excluir?: string[], log?: (m: string) => void }} opts
 * @returns {Promise<{ archivos: { nombre: string, bytes: number, datos: Buffer, tipo: string }[], fallidos: { nombre: string, motivo: string }[] }>}
 */
export async function validarAdjuntos(rutas, { cwd, trabajo, excluir = [], log } = {}) {
  const archivos = [];
  const fallidos = [];
  const vistos = new Set();
  let raiz = null;
  try {
    raiz = { cruda: path.resolve(trabajo), real: await realpath(trabajo) };
  } catch {}
  const excluidos = new Set(excluir.map((e) => e.toLowerCase()));
  for (const pedida of rutas ?? []) {
    const nombre = nombreSeguro(pedida);
    try {
      if (!raiz) throw new Error('no existe la carpeta ./trabajo');
      const abs = resolverPedida(pedida, cwd);
      if (!abs) throw new Error('ruta no permitida');
      let rel = path.relative(raiz.cruda, abs);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
        rel = path.relative(raiz.real, abs);
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('fuera de ./trabajo');
      }
      if (rel.split(path.sep).some((seg) => seg.startsWith('.'))) throw new Error('archivo o carpeta oculta');
      if (excluidos.has(path.basename(rel).toLowerCase())) throw new Error('archivo interno del puente');
      const ext = path.extname(abs).slice(1).toLowerCase();
      if (!ext || !PERMITIDAS.has(ext) || EXT_BLOQUEADAS.has(ext)) throw new Error('extensión no permitida');
      const real = await realpath(abs);
      if (real !== path.join(raiz.real, rel)) throw new Error('enlace simbólico no permitido');
      if (vistos.has(real)) continue;
      if (archivos.length >= MAX_ADJUNTOS) throw new Error(`máximo ${MAX_ADJUNTOS} archivos por respuesta`);
      const fh = await open(real, FS.O_RDONLY | FS.O_NOFOLLOW);
      let datos;
      try {
        const st = await fh.stat();
        if (!st.isFile()) throw new Error('no es un archivo regular');
        if (st.size <= 0) throw new Error('está vacío');
        if (st.size > MAX_BYTES_ADJUNTO) throw new Error('supera 25 MB');
        datos = await fh.readFile();
      } finally {
        await fh.close();
      }
      if (datos.length <= 0 || datos.length > MAX_BYTES_ADJUNTO) throw new Error('cambió de tamaño al leerlo');
      vistos.add(real);
      const nombreReal = nombreSeguro(real);
      archivos.push({ nombre: nombreReal, bytes: datos.length, datos, tipo: tipoMime(nombreReal) });
    } catch (err) {
      const motivo = err?.code === 'ENOENT' ? 'no existe' : err?.code === 'ELOOP' ? 'enlace simbólico no permitido' : (err?.message ?? 'error');
      if (!fallidos.some((f) => f.nombre === nombre)) fallidos.push({ nombre, motivo });
      log?.(`adjunto rechazado (${nombre}): ${motivo}`);
    }
  }
  return { archivos, fallidos };
}

export function notaRechazados(fallidos) {
  if (!fallidos.length) return '';
  return `⚠️ No pude adjuntar: ${fallidos.map((f) => `${f.nombre} (${f.motivo})`).join(', ')}.`;
}

/**
 * Extrae las marcas, valida y deja el texto listo. Nunca lanza.
 * @returns {Promise<{ texto: string, archivos: Array, fallidos: Array, hayMedia: boolean }>}
 */
export async function prepararAdjuntos(texto, opts) {
  const { texto: limpio, rutas } = extraerMedia(texto);
  if (rutas.length === 0) return { texto, archivos: [], fallidos: [], hayMedia: false };
  const { archivos, fallidos } = await validarAdjuntos(rutas, opts);
  const nota = notaRechazados(fallidos);
  let final = nota ? (limpio ? `${limpio}\n\n${nota}` : nota) : limpio;
  if (!final.trim()) final = archivos.length === 1 ? 'Le adjunto el archivo.' : 'Le adjunto los archivos.';
  return { texto: final, archivos, fallidos, hayMedia: true };
}

/** Texto para el encabezado de sistema de CADA turno (todos los usuarios, con o sin código). */
export function textoAdjuntosSalida() {
  return [
    `- ADJUNTAR ARCHIVOS a su respuesta: SÍ puede, en cualquier turno. 1) Cree el archivo dentro de ./trabajo (por ejemplo ./trabajo/salida/informe.csv) con Write o, si tiene terminal, con sus comandos. 2) En su respuesta final escriba, en una línea sola y fuera de bloques de código, \`MEDIA:trabajo/salida/informe.csv\` (una línea por archivo). El puente quita esa línea y sube el archivo con su mensaje.`,
    `  Límites: máximo ${MAX_ADJUNTOS} archivos, 25 MB cada uno, solo dentro de ./trabajo (sin \`..\`, sin enlaces simbólicos ni archivos ocultos) y solo extensiones ${EXT_PERMITIDAS.join(', ')}. Con Write solo se escribe texto: sin terminal, entregue tablas como .csv (separado por «;») o .md/.txt/.json; un .xlsx/.docx real solo si lo generó con un comando; un PDF, con la regla DOCUMENTOS EN PDF (el puente convierte su HTML). Nombre en la respuesta el archivo que adjunta; si el puente no lo puede adjuntar, lo dirá en el hilo. Nunca diga que no puede adjuntar archivos.`,
  ].join('\n');
}
