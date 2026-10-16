/**
 * Tablero del documento Word: comparación entre subversiones (estilo control de cambios),
 * anclaje de marcas al texto y detección automática de correcciones.
 * Funciones puras: se usan igual en el navegador y en el servidor.
 */

/** Párrafo del Word ya convertido a texto (ver draftBlocks.ts). */
export type DraftBlock = {
  kind: 'h' | 'p' | 'li' | 'cell';
  text: string;
  /** Texto en negrilla al inicio del párrafo (p. ej. "PRIMERA. OBJETO."). */
  lead?: string | null;
};

export type DiffOp = { t: 'eq' | 'ins' | 'del'; v: string };

export type BlockRow =
  | { type: 'eq'; oldIndex: number; newIndex: number }
  | { type: 'mod'; oldIndex: number; newIndex: number }
  | { type: 'ins'; newIndex: number }
  | { type: 'del'; oldIndex: number };

/** Por encima de esto una comparación palabra a palabra es muy costosa: se marca el párrafo entero. */
const MAX_TOKENS = 1500;

export function tokenize(text: string): string[] {
  return String(text || '').match(/\s+|[^\s]+/g) ?? [];
}

export function normalizeText(text: string): string {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function lcsTable<T>(a: T[], b: T[], same: (x: T, y: T) => boolean): Uint32Array[] {
  const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = same(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

/** Cambios palabra por palabra entre dos textos. */
export function diffText(before: string, after: string): DiffOp[] {
  if (before === after) return tokenize(after).map((v) => ({ t: 'eq', v }));
  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
    return [...a.map((v) => ({ t: 'del' as const, v })), ...b.map((v) => ({ t: 'ins' as const, v }))];
  }
  const dp = lcsTable(a, b, (x, y) => x === y);
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ t: 'eq', v: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ t: 'del', v: a[i++] });
    } else {
      ops.push({ t: 'ins', v: b[j++] });
    }
  }
  while (i < a.length) ops.push({ t: 'del', v: a[i++] });
  while (j < b.length) ops.push({ t: 'ins', v: b[j++] });
  return groupChanges(ops);
}

const isSpace = (op: DiffOp) => op.t === 'eq' && /^\s+$/.test(op.v);

/**
 * Agrupa cada tramo cambiado como en Word: primero todo lo quitado y luego todo lo agregado
 * ("~~treinta (30)~~ sesenta (60)" en vez de "~~treinta~~ sesenta ~~(30)~~ (60)"). Los espacios
 * que quedan entre dos cambios pasan a ambos lados.
 */
function groupChanges(ops: DiffOp[]): DiffOp[] {
  const out: DiffOp[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].t === 'eq') {
      out.push(ops[k++]);
      continue;
    }
    let end = k;
    // El tramo sigue mientras haya cambios, o espacios seguidos de otro cambio.
    while (end < ops.length) {
      if (ops[end].t !== 'eq') {
        end++;
      } else if (isSpace(ops[end]) && end + 1 < ops.length && ops[end + 1].t !== 'eq') {
        end++;
      } else {
        break;
      }
    }
    let del = '';
    let ins = '';
    for (const op of ops.slice(k, end)) {
      if (op.t !== 'ins') del += op.v;
      if (op.t !== 'del') ins += op.v;
    }
    if (del) out.push({ t: 'del', v: del });
    if (ins) out.push({ t: 'ins', v: ins });
    k = end;
  }
  return out;
}

/** Número de tramos cambiados ("N cambios"): un reemplazo (quitado + agregado seguidos) cuenta uno. */
export function countChangeRuns(ops: DiffOp[]): number {
  let runs = 0;
  let inChange = false;
  for (const op of ops) {
    if (op.t !== 'eq' && !inChange) runs++;
    inChange = op.t !== 'eq';
  }
  return runs;
}

/** Parecido entre dos párrafos (0–1): palabras en común sobre palabras totales. */
export function blockSimilarity(a: string, b: string): number {
  const words = (s: string) => new Set(normalizeText(s).split(' ').filter((w) => w.length > 2));
  const A = words(a);
  const B = words(b);
  if (A.size === 0 || B.size === 0) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common / (A.size + B.size - common);
}

/** Por debajo de esto dos párrafos distintos se tratan como uno quitado y otro agregado. */
const MIN_SIMILARITY = 0.3;

/**
 * Empareja los párrafos de dos subversiones: iguales, modificados, agregados o quitados.
 * Los párrafos idénticos se alinean con LCS; entre dos iguales, cada párrafo viejo se empareja
 * (en orden) con el nuevo más parecido, así una cláusula editada se compara palabra a palabra
 * aunque antes se haya insertado una cláusula nueva.
 */
export function alignBlocks(before: DraftBlock[], after: DraftBlock[]): BlockRow[] {
  const dp = lcsTable(before, after, (x, y) => x.text === y.text);
  const rows: BlockRow[] = [];
  let i = 0;
  let j = 0;
  const flush = (dels: number[], inss: number[]) => {
    const pairOf = new Map<number, number>(); // newIndex → oldIndex
    let from = 0;
    for (const oldIndex of dels) {
      let best = -1;
      let bestScore = MIN_SIMILARITY;
      for (let k = from; k < inss.length; k++) {
        const score = blockSimilarity(before[oldIndex].text, after[inss[k]].text);
        if (score >= bestScore) {
          best = k;
          bestScore = score;
        }
      }
      if (best >= 0) {
        pairOf.set(inss[best], oldIndex);
        from = best + 1;
      }
    }
    const paired = new Set(pairOf.values());
    let d = 0;
    const flushDelsBefore = (limit: number) => {
      while (d < dels.length && dels[d] < limit) {
        if (!paired.has(dels[d])) rows.push({ type: 'del', oldIndex: dels[d] });
        d++;
      }
    };
    for (const newIndex of inss) {
      const oldIndex = pairOf.get(newIndex);
      if (oldIndex == null) {
        rows.push({ type: 'ins', newIndex });
        continue;
      }
      flushDelsBefore(oldIndex);
      rows.push({ type: 'mod', oldIndex, newIndex });
      d = Math.max(d, dels.indexOf(oldIndex) + 1);
    }
    flushDelsBefore(Number.POSITIVE_INFINITY);
  };
  let dels: number[] = [];
  let inss: number[] = [];
  while (i < before.length && j < after.length) {
    if (before[i].text === after[j].text) {
      flush(dels, inss);
      dels = [];
      inss = [];
      rows.push({ type: 'eq', oldIndex: i, newIndex: j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      dels.push(i++);
    } else {
      inss.push(j++);
    }
  }
  while (i < before.length) dels.push(i++);
  while (j < after.length) inss.push(j++);
  flush(dels, inss);
  return rows;
}

/** Índice del párrafo equivalente en la subversión nueva (null si se quitó). */
export function mapBlockIndex(rows: BlockRow[], oldIndex: number): number | null {
  for (const row of rows) {
    if ((row.type === 'eq' || row.type === 'mod') && row.oldIndex === oldIndex) return row.newIndex;
  }
  return null;
}

export type DraftAnchor = { index: number; start: number; end: number };

/** Ubica una cita en los párrafos: primero en el sugerido, luego en el más cercano que la tenga. */
export function findAnchor(blocks: DraftBlock[], quote: string, preferIndex?: number | null): DraftAnchor | null {
  const q = String(quote || '');
  if (!q.trim()) return null;
  const at = (index: number): DraftAnchor | null => {
    const start = blocks[index]?.text.indexOf(q) ?? -1;
    return start >= 0 ? { index, start, end: start + q.length } : null;
  };
  if (preferIndex != null && preferIndex >= 0 && preferIndex < blocks.length) {
    const hit = at(preferIndex);
    if (hit) return hit;
  }
  const order = blocks
    .map((_, index) => index)
    .sort((x, y) => Math.abs(x - (preferIndex ?? 0)) - Math.abs(y - (preferIndex ?? 0)));
  for (const index of order) {
    const hit = at(index);
    if (hit) return hit;
  }
  return null;
}

/** Texto sin espacios y en minúsculas, con el índice original de cada carácter. */
export function compactWithMap(text: string): { compact: string; map: number[] } {
  let compact = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) continue;
    compact += ch.toLowerCase();
    map.push(i);
  }
  return { compact, map };
}

/**
 * Como findAnchor, pero ignora espacios y saltos de línea: el texto que sale de la hoja (PDF)
 * puede partir palabras o juntar líneas distinto al Word. Devuelve además la cita exacta del
 * párrafo, que es la que se guarda en la marca.
 */
export function findAnchorLoose(
  blocks: DraftBlock[],
  text: string,
  preferIndex?: number | null
): (DraftAnchor & { quote: string }) | null {
  const exact = findAnchor(blocks, String(text || '').replace(/\s+/g, ' ').trim(), preferIndex);
  if (exact) return { ...exact, quote: blocks[exact.index].text.slice(exact.start, exact.end) };
  const needle = compactWithMap(text).compact;
  if (needle.length < 2) return null;
  const order = blocks
    .map((_, index) => index)
    .sort((x, y) => Math.abs(x - (preferIndex ?? 0)) - Math.abs(y - (preferIndex ?? 0)));
  for (const index of order) {
    const { compact, map } = compactWithMap(blocks[index].text);
    const at = compact.indexOf(needle);
    if (at < 0) continue;
    const start = map[at];
    const end = map[at + needle.length - 1] + 1;
    return { index, start, end, quote: blocks[index].text.slice(start, end) };
  }
  return null;
}

/**
 * ¿La subversión nueva ya aplicó la corrección? En el párrafo equivalente, el texto que
 * "Dice" desapareció y apareció el que "Debe decir".
 */
export function isCorrectionApplied(blockText: string, quote: string, suggest: string): boolean {
  const text = normalizeText(blockText);
  const q = normalizeText(quote);
  const s = normalizeText(suggest);
  if (!q || !s) return false;
  return !text.includes(q) && text.includes(s);
}
