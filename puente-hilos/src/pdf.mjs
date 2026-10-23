/**
 * HTML → PDF EN EL PUENTE (pedido de Nicolás Rivera, 2026-10-21).
 *
 * La sesión del hilo no tiene terminal (salvo los operadores), así que no puede
 * correr Chrome. Escribe el documento como HTML en ./trabajo y lo pide en su
 * respuesta final con una línea sola:
 *
 *     PDF:trabajo/salida/informe.html        (o MEDIA:trabajo/salida/informe.html)
 *
 * Al terminar el turno, el PUENTE convierte ese HTML a PDF con
 * chrome-headless-shell y cambia la línea por `MEDIA:trabajo/salida/informe.pdf`,
 * que sigue el camino normal de los adjuntos (adjuntos-salida.mjs, con todos sus
 * controles). El HTML no se adjunta: depende de rutas locales del Mac y, abierto
 * en el navegador de quien lo reciba, ejecutaría su JavaScript.
 *
 * CONTROLES (fallan cerrado; lo que no se convierte se dice en el hilo):
 *  - El HTML solo desde <conversación>/trabajo: sin `..`, sin URLs, sin enlaces
 *    simbólicos (ruta real exacta), sin ocultos; .html/.htm de 1 B a 10 MB.
 *  - Chrome corre dentro de un perfil de sandbox de macOS (sandbox-exec) que:
 *      · NIEGA toda la red (también localhost: los conectores MCP y SAP no se
 *        alcanzan), y además Chrome va con un proxy muerto, sin bypass de
 *        loopback, y con el resolvedor de nombres anulado;
 *      · NIEGA leer el contenido de /Users, /private/tmp, /private/var/folders
 *        y /Volumes, salvo: el binario de Chrome, su carpeta temporal, las
 *        carpetas del hilo que la sesión ya puede leer (trabajo, adjuntos,
 *        contexto, archivos del proyecto) y los recursos de solo lectura de los
 *        plugins (p. ej. gss-design). Así un <iframe src="file:///…/.env"> sale
 *        en blanco (verificado: sin el sandbox, Chrome sí lo pinta);
 *      · NIEGA escribir fuera de su carpeta temporal.
 *    Dentro de ese perfil, el sandbox PROPIO de Chrome no puede iniciarse
 *    (macOS no anida perfiles), por eso va con --no-sandbox: la contención la
 *    da el perfil de afuera, que también hereda cada proceso hijo de Chrome.
 *  - Entorno vacío (HOME y TMPDIR = carpeta temporal), perfil de Chrome nuevo
 *    en cada conversión, tiempo máximo (60 s por defecto) con muerte del grupo
 *    de procesos, y el PDF solo si empieza por %PDF- y pesa hasta 25 MB.
 *  - Máximo 5 conversiones por respuesta (el tope de adjuntos).
 */
import { spawn } from 'node:child_process';
import { constants as FS, existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { mkdtemp, open, readFile, realpath, rename, rm, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MAX_ADJUNTOS, MAX_BYTES_ADJUNTO } from './adjuntos-salida.mjs';

export const MAX_BYTES_HTML = 10 * 1024 * 1024;
export const MAX_BYTES_PDF = MAX_BYTES_ADJUNTO;
export const MAX_CONVERSIONES = MAX_ADJUNTOS;
export const TIMEOUT_PDF_MS = 60 * 1000;
const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

const RE_CERCO = /^ {0,3}(`{3,}|~{3,})/;
const RE_MARCA = /^[ \t]{0,3}(?:[-*][ \t]+)?(PDF|MEDIA):[ \t]*(\S.*?)[ \t]*$/;
const RE_COMILLAS = /^(["'`<])(.*)(["'`>])$/;
const EXT_HTML = new Set(['html', 'htm']);

/**
 * Marcas a convertir, fuera de bloques de código: toda línea `PDF:<ruta>` y las
 * `MEDIA:<ruta>.html|.htm`. Las demás `MEDIA:` no se tocan.
 * @returns {{ lineas: string[], marcas: { indice: number, tipo: 'PDF'|'MEDIA', ruta: string }[] }}
 */
export function extraerMarcasPdf(texto) {
  const lineas = String(texto ?? '').split('\n');
  const marcas = [];
  let cerco = null;
  lineas.forEach((linea, indice) => {
    const sinCR = linea.replace(/\r$/, '');
    const m = RE_CERCO.exec(sinCR);
    if (m) {
      if (!cerco) cerco = m[1];
      else if (m[1][0] === cerco[0] && m[1].length >= cerco.length && sinCR.trim() === m[1]) cerco = null;
      return;
    }
    if (cerco) return;
    const mm = RE_MARCA.exec(sinCR);
    if (!mm) return;
    const ruta = mm[2].trim().replace(RE_COMILLAS, '$2').trim();
    if (!ruta) return;
    const tipo = mm[1];
    if (tipo === 'MEDIA' && !EXT_HTML.has(path.extname(ruta).slice(1).toLowerCase())) return;
    marcas.push({ indice, tipo, ruta });
  });
  return { lineas, marcas };
}

/** Carpetas `recursos/` de los plugins (solo lectura para la sesión y para Chrome). */
export function recursosDePlugins(pluginDirs = [], existe = existsSync) {
  return (pluginDirs ?? []).map((d) => path.join(d, 'recursos')).filter((d) => existe(d));
}

/**
 * Binario de Chrome sin ventana. Con HILOS_PDF_CHROME, ese; si no, el
 * chrome-headless-shell más nuevo de Playwright (~/Library/Caches/ms-playwright).
 * El Google Chrome de escritorio NO sirve dentro del sandbox (necesita escribir
 * su socket de instancia única en la carpeta temporal del usuario).
 */
export function resolverChrome({ explicito = null, home } = {}) {
  const ejecutable = (p) => {
    try {
      const r = realpathSync(p);
      return statSync(r).isFile() ? r : null;
    } catch {
      return null;
    }
  };
  if (explicito) return ejecutable(explicito);
  const base = path.join(home ?? '', 'Library', 'Caches', 'ms-playwright');
  let dirs = [];
  try {
    dirs = readdirSync(base)
      .map((n) => ({ n, v: Number(/^chromium_headless_shell-(\d+)$/.exec(n)?.[1]) }))
      .filter((x) => Number.isInteger(x.v))
      .sort((a, b) => b.v - a.v);
  } catch {
    return null;
  }
  for (const { n } of dirs) {
    for (const plat of ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell-mac-x64']) {
      const r = ejecutable(path.join(base, n, plat, 'chrome-headless-shell'));
      if (r) return r;
    }
  }
  return null;
}

/** Perfil SBPL. Las rutas van como parámetros (-D), nunca pegadas al texto del perfil. */
export function perfilSandbox(nLecturas) {
  const leer = Array.from({ length: nLecturas }, (_, i) => ` (subpath (param "LEER${i}"))`).join('');
  return [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    '(deny file-read-data (subpath "/Users") (subpath "/private/tmp") (subpath "/private/var/folders") (subpath "/Volumes") (subpath "/Library/Keychains"))',
    `(allow file-read-data (subpath (param "CHROME")) (subpath (param "TMP"))${leer})`,
    '(deny file-write* (subpath "/"))',
    '(allow file-write* (subpath (param "TMP")) (literal "/dev/null") (regex #"^/dev/fd/"))',
    '',
  ].join('\n');
}

/** Argumentos de Chrome: sin red, sin extensiones ni servicios de fondo, sin encabezados de impresión. */
export function argumentosChrome({ tmp, salida, html }) {
  return [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--no-pdf-header-footer',
    '--hide-scrollbars',
    `--user-data-dir=${path.join(tmp, 'perfil')}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-extensions',
    '--disable-default-apps',
    '--mute-audio',
    '--block-new-web-contents',
    '--proxy-server=http://127.0.0.1:9',
    '--proxy-bypass-list=<-loopback>',
    '--host-resolver-rules=MAP * ~NOTFOUND',
    '--virtual-time-budget=8000',
    `--print-to-pdf=${salida}`,
    pathToFileURL(html).href,
  ];
}

/**
 * Convierte UN HTML a PDF dentro del sandbox. Nunca lanza.
 * @returns {Promise<{ ok: true, datos: Buffer, ms: number } | { ok: false, motivo: string }>}
 */
export async function convertirHtmlAPdf({ html, chrome, lecturas = [], timeoutMs = TIMEOUT_PDF_MS, spawnImpl = spawn }) {
  const t0 = Date.now();
  if (!chrome) return { ok: false, motivo: 'no hay Chrome sin ventana en este equipo' };
  if (!existsSync(SANDBOX_EXEC)) return { ok: false, motivo: 'falta sandbox-exec' };
  let tmp = null;
  try {
    tmp = await realpath(await mkdtemp(path.join(tmpdir(), 'puente-pdf-')));
    const reales = [];
    for (const d of lecturas) {
      try {
        reales.push(await realpath(d));
      } catch {}
    }
    const perfil = path.join(tmp, 'perfil.sb');
    await writeFile(perfil, perfilSandbox(reales.length), { mode: 0o600 });
    const salida = path.join(tmp, 'salida.pdf');
    const raizChrome = path.dirname(chrome);
    const args = ['-f', perfil, '-D', `CHROME=${raizChrome}`, '-D', `TMP=${tmp}`];
    reales.forEach((d, i) => args.push('-D', `LEER${i}=${d}`));
    args.push(chrome, ...argumentosChrome({ tmp, salida, html }));
    const r = await new Promise((resolve) => {
      let hijo;
      try {
        hijo = spawnImpl(SANDBOX_EXEC, args, { env: { HOME: tmp, TMPDIR: `${tmp}/`, PATH: '/usr/bin:/bin', LANG: 'es_CO.UTF-8' }, cwd: tmp, stdio: ['ignore', 'ignore', 'pipe'], detached: true });
      } catch (e) {
        resolve({ codigo: -1, err: e.message });
        return;
      }
      let err = '';
      let vencido = false;
      const matar = () => {
        try {
          process.kill(-hijo.pid, 'SIGKILL');
        } catch {
          try {
            hijo.kill('SIGKILL');
          } catch {}
        }
      };
      const t = setTimeout(() => {
        vencido = true;
        matar();
      }, timeoutMs);
      hijo.stderr?.on('data', (c) => {
        err = (err + c.toString('utf8')).slice(-2000);
      });
      hijo.on('error', (e) => {
        clearTimeout(t);
        resolve({ codigo: -1, err: e.message });
      });
      hijo.on('close', (codigo) => {
        clearTimeout(t);
        // Ningún proceso de Chrome queda vivo después de la conversión.
        matar();
        resolve({ codigo, err, vencido });
      });
    });
    if (r.vencido) return { ok: false, motivo: `superó ${Math.round(timeoutMs / 1000)} s` };
    let datos;
    try {
      const fh = await open(salida, FS.O_RDONLY | FS.O_NOFOLLOW);
      try {
        const st = await fh.stat();
        if (!st.isFile() || st.size <= 0) throw new Error('vacío');
        if (st.size > MAX_BYTES_PDF) return { ok: false, motivo: 'el PDF supera 25 MB' };
        datos = await fh.readFile();
      } finally {
        await fh.close();
      }
    } catch {
      return { ok: false, motivo: `Chrome no generó el PDF${r.codigo ? ` (código ${r.codigo})` : ''}` };
    }
    if (datos.length > MAX_BYTES_PDF) return { ok: false, motivo: 'el PDF supera 25 MB' };
    if (datos.subarray(0, 5).toString('latin1') !== '%PDF-') return { ok: false, motivo: 'la salida no es un PDF' };
    return { ok: true, datos, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, motivo: e?.message ?? 'error' };
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

function nombreSeguro(ruta) {
  // eslint-disable-next-line no-control-regex
  const n = path.basename(String(ruta).replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (n || 'archivo').slice(0, 120);
}

/** HTML pedido → ruta real dentro de ./trabajo, o lanza con el motivo. */
async function validarHtml(pedida, { cwd, trabajo }) {
  const r = String(pedida);
  if (!r || r.includes('\0') || /^[a-z][a-z0-9+.-]*:/i.test(r) || r.startsWith('~') || r.split(/[\\/]+/).some((s) => s === '..')) throw new Error('ruta no permitida');
  if (!EXT_HTML.has(path.extname(r).slice(1).toLowerCase())) throw new Error('solo se convierte HTML (.html o .htm)');
  let raizReal;
  try {
    raizReal = await realpath(trabajo);
  } catch {
    throw new Error('no existe la carpeta ./trabajo');
  }
  const abs = path.resolve(cwd, r);
  let rel = path.relative(path.resolve(trabajo), abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    rel = path.relative(raizReal, abs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('fuera de ./trabajo');
  }
  if (rel.split(path.sep).some((s) => s.startsWith('.'))) throw new Error('archivo o carpeta oculta');
  let real;
  try {
    real = await realpath(abs);
  } catch (e) {
    throw new Error(e?.code === 'ENOENT' ? 'no existe' : 'no se pudo abrir');
  }
  if (real !== path.join(raizReal, rel)) throw new Error('enlace simbólico no permitido');
  const fh = await open(real, FS.O_RDONLY | FS.O_NOFOLLOW).catch((e) => {
    throw new Error(e?.code === 'ELOOP' ? 'enlace simbólico no permitido' : 'no se pudo abrir');
  });
  try {
    const st = await fh.stat();
    if (!st.isFile()) throw new Error('no es un archivo regular');
    if (st.size <= 0) throw new Error('está vacío');
    if (st.size > MAX_BYTES_HTML) throw new Error('el HTML supera 10 MB');
  } finally {
    await fh.close();
  }
  return { real, rel, raizReal };
}

/** Escribe el PDF junto al HTML sin seguir enlaces: temporal oculto + rename (reemplaza el enlace, no su destino). */
async function guardarPdf(destino, datos) {
  try {
    const st = await lstat(destino);
    if (!st.isFile() && !st.isSymbolicLink()) throw new Error('ya existe algo con ese nombre que no es un archivo');
  } catch (e) {
    if (e?.code !== 'ENOENT') throw e;
  }
  const tmp = path.join(path.dirname(destino), `.${path.basename(destino)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tmp, datos, { flag: 'wx', mode: 0o600 });
  await rename(tmp, destino);
}

/**
 * Convierte las marcas PDF del texto y las cambia por `MEDIA:…pdf`. Nunca lanza.
 * @param {string} texto respuesta final del modelo
 * @param {{ cwd: string, trabajo: string, lecturas: string[], chrome: string|null, timeoutMs?: number, token?: string|null, convertir?: Function, log?: Function }} opts
 * @returns {Promise<{ texto: string, convertidos: { html: string, pdf: string, bytes: number, ms: number }[], fallidos: { nombre: string, motivo: string }[] }>}
 */
export async function convertirMarcasPdf(texto, { cwd, trabajo, lecturas = [], chrome = null, timeoutMs = TIMEOUT_PDF_MS, token = null, convertir = convertirHtmlAPdf, log } = {}) {
  const { lineas, marcas } = extraerMarcasPdf(texto);
  if (!marcas.length) return { texto, convertidos: [], fallidos: [] };
  const convertidos = [];
  const fallidos = [];
  const hechos = new Map();
  for (const m of marcas) {
    const nombre = nombreSeguro(m.ruta);
    let reemplazo = null;
    try {
      const { real, rel } = await validarHtml(m.ruta, { cwd, trabajo });
      if (hechos.has(real)) {
        reemplazo = hechos.get(real);
      } else {
        if (convertidos.length >= MAX_CONVERSIONES) throw new Error(`máximo ${MAX_CONVERSIONES} por respuesta`);
        if (token && (await readFile(real)).includes(token)) throw new Error('contiene una credencial');
        const r = await convertir({ html: real, chrome, lecturas, timeoutMs });
        if (!r.ok) throw new Error(r.motivo);
        const relPdf = rel.replace(/\.html?$/i, '.pdf');
        await guardarPdf(path.join(path.dirname(real), path.basename(relPdf)), r.datos);
        reemplazo = `MEDIA:${path.posix.join('trabajo', ...relPdf.split(path.sep))}`;
        hechos.set(real, reemplazo);
        convertidos.push({ html: nombre, pdf: path.basename(relPdf), bytes: r.datos.length, ms: r.ms ?? 0 });
        log?.(`PDF generado: ${nombre} → ${path.basename(relPdf)} (${r.datos.length} B, ${r.ms ?? 0} ms)`);
      }
    } catch (e) {
      const motivo = e?.message ?? 'error';
      if (!fallidos.some((f) => f.nombre === nombre)) fallidos.push({ nombre, motivo });
      log?.(`PDF no generado (${nombre}): ${motivo}`);
    }
    lineas[m.indice] = reemplazo ?? '\u0000';
  }
  let final = lineas.filter((l) => l !== '\u0000').join('\n');
  if (fallidos.length) final = `${final.trim()}\n\n⚠️ No pude convertir a PDF: ${fallidos.map((f) => `${f.nombre} (${f.motivo})`).join(', ')}.`;
  return { texto: final, convertidos, fallidos };
}

/** Bloque del encabezado de cada turno (todos los usuarios, con o sin terminal). */
export function textoPdf({ disponible, recursos = [] }) {
  const l = [];
  if (disponible) {
    l.push(
      '- DOCUMENTOS EN PDF: SÍ puede entregar PDF en cualquier turno, aunque no tenga terminal. 1) Escriba el documento como HTML completo en ./trabajo (por ejemplo ./trabajo/salida/informe.html) con Write. 2) En su respuesta final escriba, en una línea sola y fuera de bloques de código, `PDF:trabajo/salida/informe.html`. El puente lo convierte con Chrome sin ventana y adjunta `informe.pdf` (el HTML no se adjunta). También sirve `MEDIA:` con un .html.',
      `  Al convertir NO hay internet: Google Fonts, CDN e imágenes por URL no cargan; use solo archivos locales (de ./trabajo, ./adjuntos, ./contexto, los archivos del proyecto${recursos.length ? ' y los recursos de solo lectura de abajo' : ''}) con rutas absolutas o relativas al HTML. Tamaño de página con \`@page { size: A4; margin: 16mm }\` (o \`size: 1920px 1080px\` para diapositivas). Máximo ${MAX_CONVERSIONES} por respuesta, ${Math.round(TIMEOUT_PDF_MS / 1000)} s cada uno, 25 MB. Si no se puede convertir, el puente lo dice en el hilo.`
    );
  } else {
    l.push('- DOCUMENTOS EN PDF: en este momento el puente no puede convertir HTML a PDF; entregue el documento como .md o .csv y dígalo.');
  }
  for (const r of recursos) {
    l.push(`- RECURSOS DE SOLO LECTURA: \`${r}\` (léalos con Read; no se pueden modificar). Úselos desde el HTML con su ruta absoluta.`);
  }
  if (recursos.some((r) => r.split(path.sep).includes('gss-design'))) {
    l.push('- MARCA GSS: para cualquier documento, informe, presentación o maqueta de Group Shared Services Latinoamérica o sus empresas, use la skill `gss-design:gss-design` (herramienta Skill) y entréguelo en PDF con la regla de arriba.');
  }
  return l.join('\n');
}
