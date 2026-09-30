/**
 * Limpieza del HTML del borrador editado en la app (Tiptap) o convertido desde
 * Word (mammoth) — función PURA, sin DOM, para el servidor.
 *
 * Lista BLANCA: solo se conservan las etiquetas de texto enriquecido que
 * produce el editor (párrafos, títulos, negrita/cursiva/subrayado/tachado,
 * listas, tablas, citas, código, saltos). Se quitan TODOS los atributos salvo
 * colspan/rowspan numéricos de las celdas; se eliminan con su contenido
 * script, style, iframe, object, embed, svg, math, template, noscript y
 * similares; los comentarios desaparecen; cualquier otra etiqueta se descarta
 * (queda su texto). Así el HTML guardado y el que se imprime a PDF no pueden
 * ejecutar código ni cargar recursos externos.
 */

const ALLOWED = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'sub', 'sup',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'br', 'hr', 'blockquote', 'code', 'pre', 'span',
]);
const VOID = new Set(['br', 'hr']);
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript', 'head', 'title', 'textarea', 'select', 'button', 'form', 'frame', 'frameset', 'applet', 'audio', 'video', 'canvas', 'xml']);
const CELL_ATTRS = /\b(colspan|rowspan)\s*=\s*["']?(\d{1,2})["']?/gi;

export const SGC_DRAFT_MAX_HTML_BYTES = 2 * 1024 * 1024;

function escapeText(text: string): string {
  return text.replace(/&(?!(?:[a-zA-Z]{2,10}|#\d{1,6}|#x[0-9a-fA-F]{1,6});)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function sanitizeDraftHtml(input: string): string {
  const html = String(input ?? '').replace(/<!--[\s\S]*?(-->|$)/g, '');
  const out: string[] = [];
  const open: string[] = [];
  let dropping: string | null = null;
  const tagRe = /<\s*(\/)?\s*([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    const text = html.slice(last, m.index);
    if (!dropping && text) out.push(escapeText(text));
    last = tagRe.lastIndex;
    const closing = Boolean(m[1]);
    const name = m[2].toLowerCase();
    const attrs = m[3] ?? '';
    if (dropping) {
      if (closing && name === dropping) dropping = null;
      continue;
    }
    if (DROP_WITH_CONTENT.has(name)) {
      if (!closing && !/\/\s*$/.test(attrs)) dropping = name;
      continue;
    }
    if (!ALLOWED.has(name)) continue;
    if (closing) {
      const idx = open.lastIndexOf(name);
      if (idx === -1) continue;
      while (open.length > idx) out.push(`</${open.pop()}>`);
      continue;
    }
    if (VOID.has(name)) {
      out.push(`<${name}>`);
      continue;
    }
    let kept = '';
    if (name === 'td' || name === 'th') {
      for (const a of attrs.matchAll(CELL_ATTRS)) kept += ` ${a[1].toLowerCase()}="${Number(a[2])}"`;
    }
    out.push(`<${name}${kept}>`);
    open.push(name);
  }
  if (!dropping) {
    const tail = html.slice(last).replace(/<[^>]*$/, '');
    if (tail) out.push(escapeText(tail));
  }
  while (open.length) out.push(`</${open.pop()}>`);
  return out.join('').trim();
}

/** Texto plano aproximado (para saber si el borrador está vacío). */
export function draftPlainText(html: string): string {
  return sanitizeDraftHtml(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Error del HTML de un guardado, o null. */
export function getDraftHtmlError(html: unknown): string | null {
  if (typeof html !== 'string') return 'El contenido del borrador es inválido.';
  if (new TextEncoder().encode(html).length > SGC_DRAFT_MAX_HTML_BYTES) return 'El borrador supera 2 MB de contenido.';
  if (draftPlainText(html).length < 20) return 'El borrador está vacío o es muy corto (mínimo 20 caracteres de texto).';
  return null;
}
