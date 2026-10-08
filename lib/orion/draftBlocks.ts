import mammoth from 'mammoth';
import type { DraftBlock } from './draftDiff';

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function plain(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

const KIND: Record<string, DraftBlock['kind']> = { p: 'p', li: 'li', td: 'cell', th: 'cell' };

/**
 * HTML de mammoth → párrafos de texto. Cada celda de tabla y cada ítem de lista es un párrafo;
 * la negrilla inicial se conserva aparte para mostrar los títulos de cláusula.
 */
export function htmlToDraftBlocks(html: string): DraftBlock[] {
  const blocks: DraftBlock[] = [];
  const re = /<(h[1-6]|p|li|td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const tag = match[1].toLowerCase();
    const inner = match[2];
    const text = plain(inner);
    if (!text) continue;
    const leadMatch = /^\s*<strong>([\s\S]*?)<\/strong>/i.exec(inner);
    const lead = leadMatch ? plain(leadMatch[1]) : null;
    blocks.push({
      kind: tag.startsWith('h') ? 'h' : KIND[tag] ?? 'p',
      text,
      ...(lead && text.startsWith(lead) && lead !== text ? { lead } : {}),
    });
  }
  return blocks;
}

/** .docx → párrafos (sin encabezados/pies de página: para eso está la vista PDF). */
export async function docxToDraftBlocks(content: Buffer): Promise<DraftBlock[]> {
  const { value } = await mammoth.convertToHtml({ buffer: content });
  return htmlToDraftBlocks(value);
}
