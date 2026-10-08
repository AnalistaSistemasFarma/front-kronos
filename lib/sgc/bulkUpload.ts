import { normalizeDocumentCode } from './coding';

/**
 * CARGA MASIVA DE PDF del listado maestro (Sprint 9) — funciones PURAS.
 *
 * Calidad sube de una vez los PDF de los documentos importados del listado
 * maestro («pendientes de archivo»). Cada archivo se EMPAREJA con su
 * documento por el CÓDIGO al inicio del nombre del archivo
 * («OLP-GCC-02 Almacenamiento y distribución.pdf» → OLP-GCC-02). Se toma el
 * código MÁS LARGO que coincida, para que «OLP-GCC-02-FO01 …» no se cruce con
 * OLP-GCC-02. Después del código, el resto del nombre se compara con el
 * nombre del documento en el listado: si no se parecen, se AVISA (no bloquea).
 */

export interface SgcBulkCandidate {
  idDocument: number;
  code: string;
  title: string;
  status: string;
}

export interface SgcBulkMatch {
  fileName: string;
  idDocument: number | null;
  code: string | null;
  title: string | null;
  /** cargable | error */
  status: 'cargable' | 'error';
  error: string | null;
  warning: string | null;
  /** Parecido (0 a 1) entre el nombre del archivo y el del listado; null si el archivo solo trae el código. */
  similarity: number | null;
}

const SEPARATOR = /[\s_.\-–—]/;

/** Palabras significativas (minúsculas, sin tildes, sin palabras vacías de 1–2 letras). */
export function nameTokens(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}
const STOP = new Set(['del', 'los', 'las', 'por', 'para', 'con', 'una', 'uno', 'que', 'pdf', 'version', 'vigente', 'copia']);

/** Parecido entre dos nombres: proporción de palabras del listado que aparecen en el archivo. */
export function nameSimilarity(fileRest: string, title: string): number | null {
  const fileWords = new Set(nameTokens(fileRest));
  if (fileWords.size === 0) return null;
  const titleWords = [...new Set(nameTokens(title))];
  if (titleWords.length === 0) return null;
  const hits = titleWords.filter((w) => fileWords.has(w) || [...fileWords].some((f) => f.length >= 5 && w.length >= 5 && (f.startsWith(w.slice(0, 5)) || w.startsWith(f.slice(0, 5))))).length;
  return Math.round((hits / titleWords.length) * 100) / 100;
}

/** Umbral por debajo del cual se avisa que el nombre del archivo no coincide con el del listado. */
export const SGC_BULK_NAME_THRESHOLD = 0.5;

/** Nombre sin la extensión ni la ruta. */
export function baseName(fileName: string): string {
  const last = fileName.split(/[\\/]/).pop() ?? fileName;
  return last.replace(/\.[^.]+$/, '').trim();
}

/**
 * Empareja un archivo con su documento. `candidates` son los documentos de la
 * empresa (cualquier estado): solo se carga sobre uno «pendiente de archivo».
 */
export function matchBulkFile(fileName: string, candidates: readonly SgcBulkCandidate[]): SgcBulkMatch {
  const base: SgcBulkMatch = { fileName, idDocument: null, code: null, title: null, status: 'error', error: null, warning: null, similarity: null };
  if (!/\.pdf$/i.test(fileName.trim())) return { ...base, error: 'Solo se cargan archivos PDF.' };
  const name = normalizeDocumentCode(baseName(fileName));
  let best: SgcBulkCandidate | null = null;
  for (const c of candidates) {
    const code = normalizeDocumentCode(c.code);
    if (!name.startsWith(code)) continue;
    const next = name.charAt(code.length);
    if (next && !SEPARATOR.test(next)) continue;
    if (!best || code.length > best.code.length) best = c;
  }
  if (!best) return { ...base, error: 'El nombre del archivo no empieza con el código de ningún documento del listado.' };
  const matched = { ...base, idDocument: best.idDocument, code: best.code, title: best.title };
  if (best.status !== 'pendiente_archivo') {
    return { ...matched, error: best.status === 'anulado' ? `El documento ${best.code} está anulado.` : `El documento ${best.code} ya tiene su archivo (está ${best.status}).` };
  }
  const rest = baseName(fileName).slice(best.code.length);
  const similarity = nameSimilarity(rest, best.title);
  const warning =
    similarity !== null && similarity < SGC_BULK_NAME_THRESHOLD ? `El nombre del archivo no coincide con el del listado («${best.title}»): revise que sea el documento correcto.` : null;
  return { ...matched, status: 'cargable', similarity, warning };
}

/** Empareja una tanda; un mismo documento no puede recibir dos archivos en la tanda. */
export function matchBulkFiles(fileNames: readonly string[], candidates: readonly SgcBulkCandidate[]): SgcBulkMatch[] {
  const used = new Map<number, string>();
  return fileNames.map((f) => {
    const m = matchBulkFile(f, candidates);
    if (m.status !== 'cargable' || m.idDocument === null) return m;
    const prev = used.get(m.idDocument);
    if (prev) return { ...m, status: 'error', warning: null, error: `El documento ${m.code} ya recibe el archivo «${prev}» en esta carga.` };
    used.set(m.idDocument, f);
    return m;
  });
}
