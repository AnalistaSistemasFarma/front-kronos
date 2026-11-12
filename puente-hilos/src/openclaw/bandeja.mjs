/**
 * BANDEJA DE ADJUNTOS EN EL WORKSPACE del agente openclaw (2026-11-12, Nicolás Rivera: Kepler no
 * podía leer un PDF adjunto).
 *
 * Las herramientas nativas `image` y `pdf` de openclaw solo abren archivos bajo media/, tmp y el
 * workspace del agente («Local media path is not under an allowed directory»), y no hay opción de
 * configuración para sumar carpetas. Los adjuntos del hilo viven en
 * `<area>/proyectos/<p>/conversaciones/<c>/adjuntos`, fuera de esas raíces. Por eso cada adjunto se
 * COPIA a `<workspace>/inbox/<prefijo-sin-guion>/c<conversación>-<nombre>` (el workspace es el padre
 * del outbox del agente) y el agente recibe la ruta de la copia. El original no se toca.
 *
 * PDF: el `pdf` nativo con Anthropic manda el archivo a la API con x-api-key y la flota usa token
 * de suscripción (401). Se deja al lado el TEXTO extraído (`<pdf>.txt`, con el clawpdf que trae
 * openclaw o `pdftotext`) y, si casi no tiene texto (escaneado), las primeras páginas como PNG
 * (`<pdf>-pN.png`), que el agente abre con `read` o `image`.
 *
 * Solo lectura para el agente en el sentido de que es una copia: lo que haga con ella no toca el
 * original. Las copias con más de 7 días se borran en cada turno.
 */
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const DIAS_RETENCION_BANDEJA = 7;
const MAX_PAGINAS_TEXTO = '60';
const PAGINAS_IMAGEN = 3;
const MIN_TEXTO = 200;

/** Carpeta de la bandeja para esta instancia, o null si el agente no tiene outbox (workspace). */
export function dirBandeja(outbox, prefijo) {
  if (!outbox || !path.isAbsolute(outbox)) return null;
  const sufijo = String(prefijo ?? '').replace(/[^a-z0-9-]+/gi, '').replace(/-+$/, '') || 'proyecto';
  return path.join(path.dirname(path.resolve(outbox)), 'inbox', sufijo);
}

/** Borra las copias (y sus .txt/.png) con más de `dias`. */
export function podarBandeja(dir, { dias = DIAS_RETENCION_BANDEJA, ahora = Date.now() } = {}) {
  if (!dir || !existsSync(dir)) return 0;
  const corte = ahora - dias * 86_400_000;
  let borrados = 0;
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    try {
      const st = statSync(p);
      if (st.isFile() && st.mtimeMs < corte) {
        rmSync(p, { force: true });
        borrados += 1;
      }
    } catch {}
  }
  return borrados;
}

function ejecutar(bin, args, ms = 60_000) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: ms, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' }, (err, stdout) => resolve(err ? null : String(stdout ?? '')));
  });
}

/** CLI de clawpdf que trae openclaw (junto a su binario), o ''. */
export function rutaClawpdf(binOpenclaw) {
  const env = (process.env.HILOS_OPENCLAW_CLAWPDF ?? '').trim();
  if (env) return existsSync(env) ? env : '';
  for (const bin of [binOpenclaw, '/opt/homebrew/bin/openclaw', '/usr/local/bin/openclaw']) {
    if (!bin) continue;
    try {
      const raiz = path.dirname(realpathSync(bin));
      for (const c of [path.join(raiz, 'node_modules', 'clawpdf', 'dist', 'cli.js'), path.join(raiz, '..', 'node_modules', 'clawpdf', 'dist', 'cli.js')]) {
        if (existsSync(c)) return c;
      }
    } catch {}
  }
  return '';
}

function nodeParaClawpdf() {
  if (Number(process.versions.node.split('.')[0]) >= 22) return process.execPath;
  return ['/opt/homebrew/bin/node', '/usr/local/bin/node'].find((c) => existsSync(c)) ?? '';
}

function esPdf(ruta) {
  if (/\.pdf$/i.test(ruta)) return true;
  try {
    return readFileSync(ruta).subarray(0, 5).toString('latin1') === '%PDF-';
  } catch {
    return false;
  }
}

/** Deja `<pdf>.txt` (y PNG si es escaneado). Devuelve { texto: ruta|null, paginas: [rutas] }. */
export async function prepararPdf(pdf, { binOpenclaw = null, run = ejecutar } = {}) {
  const clawpdf = rutaClawpdf(binOpenclaw);
  const nodeBin = clawpdf ? nodeParaClawpdf() : '';
  let texto = null;
  if (clawpdf && nodeBin) texto = await run(nodeBin, [clawpdf, 'extract', pdf, '--plain', '-q', '--no-input', '--max-pages', MAX_PAGINAS_TEXTO]);
  if (texto === null) {
    const pdftotext = ['/opt/homebrew/bin/pdftotext', '/usr/local/bin/pdftotext'].find((c) => existsSync(c));
    if (pdftotext) texto = await run(pdftotext, ['-layout', '-l', MAX_PAGINAS_TEXTO, pdf, '-']);
  }
  if (texto === null) return { texto: null, paginas: [] };
  const rutaTexto = `${pdf}.txt`;
  writeFileSync(rutaTexto, texto, { mode: 0o600 });
  const paginas = [];
  if (texto.replace(/\s+/g, '').length < MIN_TEXTO && clawpdf && nodeBin) {
    for (let p = 1; p <= PAGINAS_IMAGEN; p++) {
      const png = `${pdf}-p${p}.png`;
      if ((await run(nodeBin, [clawpdf, 'render', pdf, '--page', String(p), '-o', png, '-q', '--no-input'])) === null) break;
      if (existsSync(png)) paginas.push(png);
    }
  }
  return { texto: rutaTexto, paginas };
}

/**
 * Copia los adjuntos del turno a la bandeja y devuelve las líneas para el mensaje (una por
 * adjunto, con el texto extraído de los PDF). Si algo falla con un archivo, ese archivo queda con
 * su ruta original (el turno nunca se cae por esto).
 */
export async function copiarABandeja({ adjuntos, dir, idConversation, binOpenclaw = null, log = () => {}, preparar = prepararPdf }) {
  if (!dir || adjuntos.length === 0) return adjuntos;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch (e) {
    log(`no se pudo crear la bandeja de adjuntos (${e.message}); van con su ruta original.`);
    return adjuntos;
  }
  const lineas = [];
  for (const original of adjuntos) {
    try {
      const copia = path.join(dir, `c${idConversation}-${path.basename(original)}`);
      copyFileSync(original, copia);
      let linea = copia;
      if (esPdf(copia)) {
        const pdf = await preparar(copia, { binOpenclaw });
        if (pdf.texto) linea += `\n      · texto extraído: ${pdf.texto} (ábralo con read; no use la herramienta pdf)`;
        for (const [i, png] of pdf.paginas.entries()) linea += `\n      · página ${i + 1} como imagen: ${png} (read o image)`;
      }
      lineas.push(linea);
    } catch (e) {
      log(`adjunto ${path.basename(original)} no copiado a la bandeja: ${e.message}`);
      lineas.push(original);
    }
  }
  return lineas;
}
