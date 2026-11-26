/**
 * Rich-text paste for the chat composer.
 *
 * When someone copies a link from Teams, GitHub, Outlook or a browser, the
 * clipboard carries two flavours: `text/plain` (only the visible title, e.g.
 * "Pull Request #262 · gss…") and `text/html` (the same title inside
 * `<a href="https://…">`). The composer is a plain textarea, so the browser
 * pastes `text/plain` and the URL is lost before the message is ever stored
 * (prod msg 40971, 2026-11-26).
 *
 * This module turns that HTML into the Markdown the chat already renders:
 * anchors become `[text](url)` and everything else becomes plain text with its
 * line breaks. It never returns HTML: the output is Markdown text, rendered by
 * ChatMarkdown without `rehype-raw`, so any markup left in the text shows as
 * text. Only http, https and mailto links are kept; anything else (javascript:,
 * data:, relative URLs) keeps just its visible text.
 *
 * Pure and DOM-free so it runs the same in the browser and in Node tests.
 */

/** Above this size the clipboard is left to the browser (big Word/Excel pastes). */
const MAX_HTML_CHARS = 200_000;

const PASTE_URL_SCHEMES = ['http:', 'https:', 'mailto:'] as const;

/** Elements whose content is never visible text. */
const SKIP_CONTENT = new Set(['head', 'style', 'script', 'template', 'title', 'noscript', 'svg', 'object']);

/** Elements that are their own Markdown paragraph (blank line around them). */
const PARAGRAPH = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'table', 'pre',
  'figure', 'hr', 'dl', 'details',
]);

/** Elements that start and end on their own line. */
const LINE = new Set([
  'div', 'section', 'article', 'header', 'footer', 'aside', 'main', 'nav', 'li',
  'thead', 'tbody', 'tfoot', 'tr', 'figcaption', 'dt', 'dd', 'address', 'summary',
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…',
  middot: '·', mdash: '—', ndash: '–', laquo: '«', raquo: '»', bull: '•',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', reg: '®',
};

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});/g, (match, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return match;
      try {
        return String.fromCodePoint(n);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Absolute http/https/mailto URL, or '' when the href is not allowed. */
export function sanitizePastedHref(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  const cleaned = decodeHtmlEntities(raw).replace(/[\u0000- \u007f- ]/g, '');
  if (!cleaned) return '';
  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    return '';
  }
  if (!(PASTE_URL_SCHEMES as readonly string[]).includes(parsed.protocol)) return '';
  return cleaned;
}

/** Markdown-safe destination: no spaces, brackets or angle brackets. */
const URL_ESCAPES: Record<string, string> = { ' ': '%20', '(': '%28', ')': '%29', '<': '%3C', '>': '%3E' };
function escapeUrl(url: string): string {
  return url.replace(/[ ()<>]/g, (c) => URL_ESCAPES[c]);
}

/** Markdown-safe link label. */
function escapeLabel(label: string): string {
  return label.replace(/([\\[\]])/g, '\\$1');
}

const ATTR_RE = {
  href: /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i,
  alt: /(?:^|\s)alt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i,
} as const;

function readAttr(attrs: string, name: keyof typeof ATTR_RE): string | null {
  const m = ATTR_RE[name].exec(attrs);
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? '';
}

function sameTarget(label: string, url: string): boolean {
  const norm = (s: string) => s.trim().replace(/^mailto:/i, '').replace(/\/+$/, '').toLowerCase();
  return norm(label) === norm(url);
}

/**
 * Converts clipboard HTML to chat Markdown.
 *
 * Returns `null` when there is nothing to gain (no HTML, no allowed link, or
 * every link already shows its own URL): the caller then lets the browser
 * paste `text/plain` as usual, so Excel, Word and code pastes stay untouched.
 */
export function clipboardHtmlToMarkdown(html: string | null | undefined): string | null {
  if (typeof html !== 'string' || html.length === 0 || html.length > MAX_HTML_CHARS) return null;
  if (!/<a[\s>]/i.test(html)) return null;

  // Comments (including Windows' <!--StartFragment--> markers) go first.
  const source = html.replace(/<!--[\s\S]*?-->/g, '');

  const out: string[] = [];
  let skipDepth = 0;
  let skipTag = '';
  let preDepth = 0;
  let listDepth = 0;
  let link: { href: string; text: string[] } | null = null;
  let hiddenLinks = 0;

  const newline = () => {
    const target = link ? link.text : out;
    target.push('\n');
  };
  /** Ends the current line (or paragraph) without stacking empty lines. */
  const ensureBreak = (count: 1 | 2) => {
    const target = link ? link.text : out;
    const tail = /\n[ \t\n]*$/.exec(target.join('').slice(-8));
    const have = tail ? tail[0].split('\n').length - 1 : 0;
    if (target.length === 0) return;
    for (let i = have; i < count; i += 1) target.push('\n');
  };
  const pushText = (text: string) => {
    if (link) link.text.push(text);
    else out.push(text);
  };

  const tokenRe = /<\/?([a-zA-Z][a-zA-Z0-9:-]*)([^>]*)>|([^<]+)|</g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(source)) !== null) {
    const [whole, rawTag, attrs = '', text] = m;

    if (text !== undefined || rawTag === undefined) {
      if (skipDepth > 0) continue;
      const decoded = decodeHtmlEntities(text ?? whole);
      pushText(preDepth > 0 ? decoded : decoded.replace(/[\s ]+/g, ' '));
      continue;
    }

    const tag = rawTag.toLowerCase();
    const closing = whole.startsWith('</');

    if (skipDepth > 0) {
      if (tag === skipTag) skipDepth += closing ? -1 : 1;
      continue;
    }
    if (SKIP_CONTENT.has(tag)) {
      if (!closing && !whole.endsWith('/>')) {
        skipDepth = 1;
        skipTag = tag;
      }
      continue;
    }

    if (tag === 'a') {
      if (!closing) {
        if (link) continue; // nested anchors: the outer one wins
        link = { href: sanitizePastedHref(readAttr(attrs, 'href')), text: [] };
        continue;
      }
      if (!link) continue;
      const current = link;
      link = null;
      const label = current.text.join('').replace(/\s+/g, ' ').trim();
      if (!current.href) {
        out.push(label);
      } else if (!label || sameTarget(label, current.href)) {
        // The URL is already the text: a bare URL (or e-mail) autolinks on render.
        out.push(current.href.replace(/^mailto:/i, ''));
      } else {
        out.push(`[${escapeLabel(label)}](${escapeUrl(current.href)})`);
        hiddenLinks += 1;
      }
      continue;
    }

    if (tag === 'br') {
      newline();
      continue;
    }
    if (tag === 'img') {
      // An image-only link (avatar, card thumbnail) gets its alt text, if any.
      const alt = readAttr(attrs, 'alt');
      if (link && alt) link.text.push(` ${decodeHtmlEntities(alt)} `);
      continue;
    }
    if (tag === 'td' || tag === 'th') {
      if (closing) pushText(' ');
      continue;
    }
    if (tag === 'pre') preDepth = Math.max(0, preDepth + (closing ? -1 : 1));
    if (tag === 'ul' || tag === 'ol') listDepth = Math.max(0, listDepth + (closing ? -1 : 1));

    if (PARAGRAPH.has(tag)) ensureBreak(2);
    else if (LINE.has(tag)) ensureBreak(1);
    if (tag === 'li' && !closing) pushText(`${'  '.repeat(Math.max(0, listDepth - 1))}- `);
  }

  // An anchor never closed (truncated fragment) still keeps its link.
  if (link) {
    const label = link.text.join('').replace(/\s+/g, ' ').trim();
    if (link.href && label && !sameTarget(label, link.href)) {
      out.push(`[${escapeLabel(label)}](${escapeUrl(link.href)})`);
      hiddenLinks += 1;
    } else {
      out.push(link.href.replace(/^mailto:/i, '') || label);
    }
  }

  if (hiddenLinks === 0) return null;

  const markdown = out
    .join('')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, '').replace(/^ (?=\S)/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return markdown.length > 0 ? markdown : null;
}
