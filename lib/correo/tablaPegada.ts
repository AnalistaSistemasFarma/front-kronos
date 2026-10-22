/**
 * «Pegar tablas» en el editor de Redactar (2026-10-19) — funciones PURAS. Lo que se copia de Excel llega como
 * texto con tabuladores; lo de Word, Outlook o una página web, como HTML con <table>. Ambos se convierten en una
 * tabla Markdown («| a | b |» + «|---|---|»), que el servidor pasa a HTML con el mismo conversor y saneado de
 * siempre: el navegador nunca manda HTML propio.
 */

const MAX_FILAS = 200;
const MAX_COLUMNAS = 30;

function celda(t: string): string {
  return String(t ?? '')
    .replace(/\r?\n|\r/g, ' ')
    .replace(/\|/g, '\\|')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Filas (celdas en texto) → tabla Markdown; la primera fila es el encabezado. null si no es una tabla (1×1). */
export function filasAMarkdown(filas: string[][]): string | null {
  const limpias = filas
    .slice(0, MAX_FILAS)
    .map((f) => f.slice(0, MAX_COLUMNAS).map(celda))
    .filter((f) => f.some((c) => c));
  const n = Math.max(0, ...limpias.map((f) => f.length));
  if (limpias.length < 2 && n < 2) return null;
  if (n < 1) return null;
  const linea = (f: string[]) => `| ${Array.from({ length: n }, (_, j) => f[j] ?? '').join(' | ')} |`;
  const [enc, ...cuerpo] = limpias;
  return [linea(enc), `|${Array.from({ length: n }, () => ' --- ').join('|')}|`, ...cuerpo.map(linea)].join('\n');
}

/** Texto con tabuladores (Excel, Hojas de cálculo) → tabla Markdown, o null si no lo parece. */
export function tsvAMarkdown(texto: string): string | null {
  const t = String(texto ?? '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!t.includes('\t')) return null;
  const filas = t.split('\n').map((l) => l.split('\t'));
  if (filas.length < 2 && filas[0].length < 2) return null;
  return filasAMarkdown(filas);
}
