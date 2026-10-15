/**
 * Saneado del HTML de los correos — función PURA (sin DOM), para el servidor.
 * Mismo enfoque de lista blanca que lib/sgc/draft/html.ts (sin dependencias nuevas).
 *
 * - Solo etiquetas de texto enriquecido; todo lo demás se quita (queda su texto).
 * - script, style, iframe, object, embed, svg, math, form, etc. se eliminan con su contenido.
 * - Atributos: ninguno, salvo colspan/rowspan numéricos, `href` de enlaces http(s)/mailto
 *   (se abren en otra pestaña con rel="noopener noreferrer nofollow") y `src`/`alt` de imágenes.
 * - Imágenes: las incrustadas (cid:) se reemplazan por su data: URI; data:image png/jpeg/gif se
 *   conservan; las REMOTAS se bloquean por defecto (píxeles de rastreo) y solo se muestran si la
 *   persona lo pide (`remotas: true`), y solo https.
 * El navegador además lo muestra en un iframe con `sandbox` (sin scripts) y una CSP propia.
 */

const ALLOWED = new Set([
  'a', 'img', 'p', 'div', 'span', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's',
  'strike', 'del', 'sub', 'sup', 'small', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'caption', 'blockquote', 'pre', 'code', 'center',
]);
const VOID = new Set(['br', 'hr', 'img']);
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript', 'head', 'title', 'textarea',
  'select', 'button', 'form', 'frame', 'frameset', 'applet', 'audio', 'video', 'canvas', 'xml', 'link', 'meta', 'base',
]);
const ATTR_RE = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
const DATA_IMG = /^data:image\/(?:png|jpeg|jpg|gif);base64,[A-Za-z0-9+/=]+$/i;
const MAX_DATA_IMG = 3 * 1024 * 1024;

export interface SaneadoOpciones {
  /** Mostrar imágenes remotas (https). Por defecto false. */
  remotas?: boolean;
  /** cid (en minúsculas, sin < >) → data: URI. */
  cid?: Record<string, string>;
}

export interface Saneado {
  html: string;
  /** Imágenes remotas que se bloquearon (para ofrecer «Mostrar imágenes»). */
  remotasBloqueadas: number;
}

function escapeText(text: string): string {
  return text
    .replace(/&(?!(?:[a-zA-Z]{2,10}|#\d{1,6}|#x[0-9a-fA-F]{1,6});)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Decodifica entidades para VALIDAR una URL (evita «jav&#x61;script:»). */
export function decodeEntities(v: string): string {
  return v
    .replace(/&#x([0-9a-f]{1,6});?/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d{1,7});?/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&colon;/gi, ':')
    .replace(/&tab;|&newline;/gi, '')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
}

function safeChar(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

function attrs(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of raw.matchAll(ATTR_RE)) {
    const name = m[1].toLowerCase();
    if (!out.has(name)) out.set(name, decodeEntities(m[2] ?? m[3] ?? m[4] ?? '').trim());
  }
  return out;
}

/** URL de enlace segura (http, https o mailto), o null. */
export function safeHref(v: string | undefined): string | null {
  if (!v) return null;
  // Sin espacios ni caracteres de control (los navegadores los ignoran dentro del esquema).
  if (/[\s\u0000-\u001f\u007f]/.test(v)) return null;
  return /^(https?:\/\/|mailto:)/i.test(v) ? v : null;
}

export function sanitizeEmailHtml(input: string, opciones: SaneadoOpciones = {}): Saneado {
  const html = String(input ?? '').replace(/<!--[\s\S]*?(-->|$)/g, '').replace(/<!\[CDATA\[[\s\S]*?(\]\]>|$)/g, '');
  const out: string[] = [];
  const open: string[] = [];
  let dropping: string | null = null;
  let remotasBloqueadas = 0;
  const tagRe = /<(\/)?([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    const text = html.slice(last, m.index);
    if (!dropping && text) out.push(escapeText(text));
    last = tagRe.lastIndex;
    const closing = Boolean(m[1]);
    const name = m[2].toLowerCase();
    const rawAttrs = m[3] ?? '';
    if (dropping) {
      if (closing && name === dropping) dropping = null;
      continue;
    }
    if (DROP_WITH_CONTENT.has(name)) {
      if (!closing && !/\/\s*$/.test(rawAttrs)) dropping = name;
      continue;
    }
    if (!ALLOWED.has(name)) continue;
    if (closing) {
      const idx = open.lastIndexOf(name);
      if (idx === -1) continue;
      while (open.length > idx) out.push(`</${open.pop()}>`);
      continue;
    }
    const a = attrs(rawAttrs);
    if (name === 'img') {
      const src = a.get('src') ?? '';
      const alt = a.get('alt') ? ` alt="${escapeAttr(a.get('alt')!.slice(0, 200))}"` : '';
      let ok: string | null = null;
      if (/^cid:/i.test(src)) {
        ok = opciones.cid?.[src.slice(4).replace(/^<|>$/g, '').toLowerCase()] ?? null;
      } else if (DATA_IMG.test(src) && src.length <= MAX_DATA_IMG) {
        ok = src;
      } else if (/^https:\/\//i.test(src) && !/[\s\u0000-\u001f]/.test(src)) {
        if (opciones.remotas) ok = src;
        else remotasBloqueadas++;
      } else if (/^http:\/\//i.test(src)) {
        remotasBloqueadas += opciones.remotas ? 0 : 1;
      }
      if (ok) out.push(`<img src="${escapeAttr(ok)}"${alt}>`);
      else if (a.get('alt')) out.push(`<span>[${escapeText(a.get('alt')!.slice(0, 200))}]</span>`);
      continue;
    }
    if (VOID.has(name)) {
      out.push(`<${name}>`);
      continue;
    }
    let kept = '';
    if (name === 'td' || name === 'th') {
      for (const k of ['colspan', 'rowspan']) {
        const n = Number(a.get(k));
        if (Number.isInteger(n) && n > 0 && n < 100) kept += ` ${k}="${n}"`;
      }
    }
    if (name === 'a') {
      const href = safeHref(a.get('href'));
      if (href) kept += ` href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer nofollow"`;
    }
    out.push(`<${name}${kept}>`);
    open.push(name);
  }
  if (!dropping) {
    const tail = html.slice(last).replace(/<[^>]*$/, '');
    if (tail) out.push(escapeText(tail));
  }
  while (open.length) out.push(`</${open.pop()}>`);
  return { html: out.join('').trim(), remotasBloqueadas };
}

/** Marcas típicas donde empieza el historial citado de una respuesta (Outlook, Gmail, Apple). */
const CORTES_HISTORIAL = [
  /<div[^>]*id\s*=\s*["']?divRplyFwdMsg/i,
  /<div[^>]*id\s*=\s*["']?appendonsend/i,
  /<div[^>]*class\s*=\s*["']?gmail_quote/i,
  /<blockquote[^>]*type\s*=\s*["']?cite/i,
  /-----\s*(Original Message|Mensaje original)\s*-----/i,
];

/** Texto plano del correo (sin historial citado), con párrafos como saltos de línea. */
export function htmlATexto(html: string, { sinHistorial = true } = {}): string {
  let h = String(html ?? '');
  if (sinHistorial) {
    for (const re of CORTES_HISTORIAL) {
      const i = h.search(re);
      if (i > 0) h = h.slice(0, i);
    }
  }
  const limpio = sanitizeEmailHtml(h).html;
  const texto = decodeEntities(
    limpio
      .replace(/<\s*br\s*>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|pre|table)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  );
  let t = texto
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (sinHistorial) {
    // Respaldo en texto: «De: … Enviado: …» / «From: … Sent: …» / «El … escribió:».
    const idx = t.search(/\n(De|From):\s.+\n(Enviado|Sent|Fecha|Date):\s/);
    if (idx > 0) t = t.slice(0, idx).trim();
    const idx2 = t.search(/\n(El|On)\s.{5,200}(escribió|wrote):/);
    if (idx2 > 0) t = t.slice(0, idx2).trim();
  }
  return t;
}

/** Recorta a `max` caracteres sin cortar a mitad de palabra, con «…». */
export function extracto(texto: string, max: number): string {
  const t = String(texto ?? '').trim();
  if (t.length <= max) return t;
  const corte = t.slice(0, max - 1);
  const esp = corte.lastIndexOf(' ');
  return `${(esp > max * 0.6 ? corte.slice(0, esp) : corte).trimEnd()}…`;
}
