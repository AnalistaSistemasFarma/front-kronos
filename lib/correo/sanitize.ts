/**
 * Saneado del HTML de los correos — función PURA (sin DOM), para el servidor.
 * Mismo enfoque de lista blanca que lib/sgc/draft/html.ts (sin dependencias nuevas).
 *
 * - Solo etiquetas de texto enriquecido y de TABLAS de correo; todo lo demás se quita (queda su texto).
 * - script, iframe, object, embed, svg, math, form, meta, etc. se eliminan con su contenido.
 * - Atributos (2026-10-16, compatibilidad con Outlook/Gmail/Apple Mail): `style` saneado propiedad por
 *   propiedad (lib/correo/sanitizeCss.ts), `class`, y los de presentación de las tablas de correo
 *   (align, valign, width, height, bgcolor, background, border, cellpadding, cellspacing, colspan,
 *   rowspan, color, face, size, dir, lang, title, id), cada uno con su formato validado. Nunca `on*`.
 * - Enlaces: solo http(s)/mailto, siempre en otra pestaña con rel="noopener noreferrer nofollow".
 * - Imágenes (y fondos `background`/`url()`): las incrustadas (cid:) se reemplazan por su data: URI;
 *   data:image png/jpeg/gif se conservan; las REMOTAS se bloquean por defecto (píxeles de rastreo) y
 *   solo se muestran si la persona lo pide (`remotas: true`), y solo https.
 * - Outlook: comentarios condicionales (`<!--[if mso]>`) fuera, `<o:p>`/`<v:…>` se quitan (queda su
 *   texto), `mso-*` se ignora; `<body>` pasa a un `<div>` para conservar su color de fondo.
 * - Con `bloquesEstilo: true` los `<style>` (incluso los del `<head>`) se conservan saneados al inicio.
 * El navegador además lo muestra en un iframe con `sandbox` (sin scripts) y una CSP propia.
 */

import { sanitizeStyle, sanitizeStyleBlock, type CssContador } from './sanitizeCss';

const ALLOWED = new Set([
  'a', 'img', 'p', 'div', 'span', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's',
  'strike', 'del', 'ins', 'sub', 'sup', 'small', 'big', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody',
  'tfoot', 'tr', 'th', 'td', 'colgroup', 'col', 'caption', 'blockquote', 'pre', 'code', 'center', 'font', 'figure',
  'figcaption', 'abbr', 'address', 'section', 'article', 'header', 'footer', 'main', 'wbr',
]);
const VOID = new Set(['br', 'hr', 'img', 'col', 'wbr']);
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript', 'head', 'title', 'textarea',
  'select', 'button', 'form', 'frame', 'frameset', 'applet', 'audio', 'video', 'canvas', 'xml', 'link', 'meta', 'base',
]);
const SIN_CIERRE = new Set(['meta', 'link', 'base']);
const ATTR_RE = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
const DATA_IMG = /^data:image\/(?:png|jpeg|jpg|gif);base64,[A-Za-z0-9+/=]+$/i;
const MAX_DATA_IMG = 3 * 1024 * 1024;

/** Formato válido de cada atributo de presentación (el valor ya viene con las entidades decodificadas). */
const COLOR = {
  test: (v: string) => v.length <= 40 && (/^#[0-9a-f]{3,8}$/i.test(v) || /^[a-z]{3,20}$/i.test(v) || /^rgba?\([\d.%\s,]+\)$/i.test(v)),
};
const LONGITUD = {
  test: (v: string) => /^auto$/i.test(v) || (/^[\d.]{1,8}(?:%|px)?$/i.test(v) && /^\d/.test(v) && (v.match(/\./g) ?? []).length <= 1),
};
const ATRIBUTOS: Record<string, { test: (v: string) => boolean }> = {
  align: /^(?:left|right|center|justify|top|middle|bottom|baseline|absmiddle)$/i,
  valign: /^(?:top|middle|bottom|baseline)$/i,
  width: LONGITUD,
  height: LONGITUD,
  bgcolor: COLOR,
  color: COLOR,
  border: /^\d{1,3}$/,
  cellpadding: /^\d{1,3}$/,
  cellspacing: /^\d{1,3}$/,
  span: /^\d{1,2}$/,
  face: /^[\w\s,'"-]{1,200}$/,
  size: /^[+-]?\d{1,2}$/,
  dir: /^(?:ltr|rtl|auto)$/i,
  lang: /^[a-z][a-z0-9-]{1,23}$/i,
};

export interface SaneadoOpciones {
  /** Mostrar imágenes remotas (https). Por defecto false. */
  remotas?: boolean;
  /** cid (en minúsculas, sin < >) → data: URI. */
  cid?: Record<string, string>;
  /** Conservar los bloques `<style>` (saneados). Solo para mostrar en el iframe; por defecto false. */
  bloquesEstilo?: boolean;
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

/** Imagen (src o fondo): data: URI o https permitido, o null; cuenta las remotas bloqueadas. */
function urlImagen(src: string, opciones: SaneadoOpciones, c: CssContador): string | null {
  if (/^cid:/i.test(src)) return opciones.cid?.[src.slice(4).replace(/^<|>$/g, '').toLowerCase()] ?? null;
  if (DATA_IMG.test(src) && src.length <= MAX_DATA_IMG) return src;
  if (/^https:\/\//i.test(src) && !/[\s\u0000-\u001f]/.test(src)) {
    if (opciones.remotas) return src;
    c.remotasBloqueadas++;
    return null;
  }
  if (/^http:\/\//i.test(src) && !opciones.remotas) c.remotasBloqueadas++;
  return null;
}

/** Atributos comunes de presentación, ya validados y escapados. */
function atributosComunes(a: Map<string, string>, opciones: SaneadoOpciones, c: CssContador): string {
  let kept = '';
  for (const [k, re] of Object.entries(ATRIBUTOS)) {
    const v = a.get(k);
    if (v && re.test(v)) kept += ` ${k}="${escapeAttr(v)}"`;
  }
  const clases = (a.get('class') ?? '').split(/\s+/).filter((x) => /^[\w-]{1,64}$/.test(x)).slice(0, 20);
  if (clases.length) kept += ` class="${clases.join(' ')}"`;
  const id = a.get('id');
  if (id && /^[\w-]{1,64}$/.test(id)) kept += ` id="${id}"`;
  const titulo = a.get('title');
  if (titulo) kept += ` title="${escapeAttr(titulo.slice(0, 300))}"`;
  const fondo = a.get('background');
  if (fondo) {
    const ok = urlImagen(fondo, opciones, c);
    if (ok) kept += ` background="${escapeAttr(ok)}"`;
  }
  const style = a.get('style');
  if (style) {
    const s = sanitizeStyle(style, opciones, c);
    if (s) kept += ` style="${escapeAttr(s)}"`;
  }
  return kept;
}

/**
 * Comentarios condicionales de Outlook: el contenido para Outlook (`<!--[if mso]>…<![endif]-->`) se
 * quita entero; el que es para los demás clientes (`<!--[if !mso]><!-->…<!--<![endif]-->`) se conserva.
 */
function quitarCondicionales(html: string): string {
  return html
    .replace(/<!--\[if[^\]]*\]>\s*<!-->/gi, '')
    .replace(/<!--\s*<!\[endif\]\s*-->/gi, '')
    .replace(/<!--\[if[^\]]*\]>[\s\S]*?<!\[endif\]\s*-->/gi, '')
    .replace(/<!\[(?:end)?if[^\]]*\]>/gi, '');
}

export function sanitizeEmailHtml(input: string, opciones: SaneadoOpciones = {}): Saneado {
  const c: CssContador = { remotasBloqueadas: 0 };
  const estilos: string[] = [];
  // Comentarios y bloques <style> en una sola pasada (lo que aparezca primero gana): así el CSS
  // envuelto en <!-- --> se conserva y un <style> comentado no se aplica.
  const html = quitarCondicionales(String(input ?? ''))
    .replace(/<!--[\s\S]*?(?:-->|$)|<style\b[^>]*>([\s\S]*?)(?:<\/style\s*>|$)/gi, (todo, css?: string) => {
      if (css !== undefined && opciones.bloquesEstilo) {
        const s = sanitizeStyleBlock(css, opciones, c);
        if (s) estilos.push(s);
      }
      return '';
    })
    .replace(/<!\[CDATA\[[\s\S]*?(\]\]>|$)/g, '')
    .replace(/<![^>]*>|<\?[^>]*>/g, ''); // <!DOCTYPE …>, <?xml …?>
  const out: string[] = [];
  const open: string[] = [];
  let dropping: string | null = null;
  const tagRe = /<(\/)?([a-zA-Z][a-zA-Z0-9:-]*)([^>]*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    const text = html.slice(last, m.index);
    if (!dropping && text) out.push(escapeText(text));
    last = tagRe.lastIndex;
    const closing = Boolean(m[1]);
    let name = m[2].toLowerCase();
    const rawAttrs = m[3] ?? '';
    if (dropping) {
      if (closing && name === dropping) dropping = null;
      continue;
    }
    if (DROP_WITH_CONTENT.has(name)) {
      // meta/link/base no tienen contenido ni cierre: se quitan solos (antes se tragaban el resto del correo).
      if (!closing && !SIN_CIERRE.has(name) && !/\/\s*$/.test(rawAttrs)) dropping = name;
      continue;
    }
    // <body> → <div>: el color/fondo del correo se conserva dentro del iframe.
    if (name === 'body') name = 'div';
    if (!ALLOWED.has(name)) continue; // incluye <html>, <o:p>, <v:…>, <w:…>
    if (closing) {
      const idx = open.lastIndexOf(name);
      if (idx === -1) continue;
      while (open.length > idx) out.push(`</${open.pop()}>`);
      continue;
    }
    const a = attrs(rawAttrs);
    if (name === 'img') {
      const ok = urlImagen(a.get('src') ?? '', opciones, c);
      const alt = a.get('alt') ? ` alt="${escapeAttr(a.get('alt')!.slice(0, 200))}"` : '';
      if (ok) out.push(`<img src="${escapeAttr(ok)}"${alt}${atributosComunes(a, opciones, c)}>`);
      else if (a.get('alt')) out.push(`<span>[${escapeText(a.get('alt')!.slice(0, 200))}]</span>`);
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
    kept += atributosComunes(a, opciones, c);
    if (VOID.has(name)) {
      out.push(`<${name}${kept}>`);
      continue;
    }
    out.push(`<${name}${kept}>`);
    open.push(name);
  }
  if (!dropping) {
    const tail = html.slice(last).replace(/<[^>]*$/, '');
    if (tail) out.push(escapeText(tail));
  }
  while (open.length) out.push(`</${open.pop()}>`);
  const cuerpo = out.join('').trim();
  const bloque = estilos.length ? `<style>${estilos.join('')}</style>` : '';
  return { html: bloque + cuerpo, remotasBloqueadas: c.remotasBloqueadas };
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
