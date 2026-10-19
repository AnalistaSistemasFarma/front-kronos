/**
 * Saneado del CSS de los correos (atributo `style` y bloques `<style>`) — función PURA, sin
 * dependencias. Lista blanca de PROPIEDADES y de VALORES (2026-10-16: las tablas y formatos de
 * Outlook/Gmail/Apple Mail se perdían porque el saneador quitaba todo el CSS).
 *
 * - Propiedad por propiedad: solo las de presentación (colores, fondos, bordes, márgenes, rellenos,
 *   fuentes, alineación, tamaños, `display` sin posicionamiento fijo/absoluto, tablas…).
 * - Se descarta la declaración entera si trae `expression(`, `javascript:`, `behavior`,
 *   `-moz-binding`, `@import`, escapes CSS (`\`), `<`/`>` o funciones fuera de la lista.
 * - `url()` solo en fondos: `cid:` (se cambia por su data: URI), `data:image` png/jpeg/gif y https
 *   SOLO si la persona pidió «Mostrar imágenes» (si no, se cuenta como imagen remota bloqueada).
 * - Las propiedades de Outlook (`mso-*`) y con prefijo de navegador se ignoran sin romper el resto.
 * - Bloques `<style>`: reglas con selectores simples y `@media`; cualquier otra regla-@ se descarta.
 */

export interface CssOpciones {
  remotas?: boolean;
  cid?: Record<string, string>;
}

/** Contador mutable de imágenes remotas bloqueadas (lo comparte el saneado del HTML). */
export interface CssContador {
  remotasBloqueadas: number;
}

const DATA_IMG = /^data:image\/(?:png|jpeg|jpg|gif);base64,[A-Za-z0-9+/=]+$/i;
const MAX_DATA_IMG = 3 * 1024 * 1024;
const MAX_BLOQUE = 200 * 1024;

const PROPIEDADES = new Set([
  'color', 'background', 'background-color', 'background-image', 'background-repeat', 'background-position',
  'background-size',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-width', 'border-style', 'border-color',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-radius', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius',
  'border-bottom-right-radius', 'border-collapse', 'border-spacing',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
  'text-align', 'text-decoration', 'text-decoration-line', 'text-decoration-color', 'text-decoration-style',
  'text-transform', 'text-indent', 'text-overflow', 'letter-spacing', 'word-spacing', 'white-space', 'word-break',
  'word-wrap', 'overflow-wrap', 'vertical-align', 'line-height', 'direction',
  'width', 'height', 'max-width', 'min-width', 'max-height', 'min-height',
  'display', 'float', 'clear', 'box-sizing', 'overflow', 'overflow-x', 'overflow-y', 'opacity', 'visibility',
  'list-style', 'list-style-type', 'list-style-position',
  'table-layout', 'caption-side', 'empty-cells', 'position',
]);

const DISPLAY = /^(?:none|block|inline|inline-block|flex|inline-flex|list-item|table|inline-table|table-row|table-cell|table-row-group|table-header-group|table-footer-group|table-column|table-column-group|table-caption)$/;
const FUNCIONES = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'calc', 'url']);
const PELIGROSO = /expression\s*\(|javascript\s*:|vbscript\s*:|behavior|binding|@import|[\\<>{}]|&#|\/\*/i;
/** Caracteres permitidos en un valor (sin url(), que se valida aparte). */
const VALOR_OK = /^[#%\w\s.,'"()\-+/!]*$/;

/** Resuelve la URL de una imagen de fondo: data: URI, https (si se permiten remotas) o null. */
function urlFondo(raw: string, o: CssOpciones, c: CssContador): string | null {
  const u = raw.trim().replace(/^(['"])([\s\S]*)\1$/, '$2').trim();
  if (/[\s\u0000-\u001f\u007f"'()\\]/.test(u)) return null;
  if (/^cid:/i.test(u)) return o.cid?.[u.slice(4).replace(/^<|>$/g, '').toLowerCase()] ?? null;
  if (DATA_IMG.test(u) && u.length <= MAX_DATA_IMG) return u;
  if (/^https?:\/\//i.test(u)) {
    if (o.remotas && /^https:\/\//i.test(u)) return u;
    if (!o.remotas) c.remotasBloqueadas++;
    return null;
  }
  return null;
}

/** Sanea UNA declaración; devuelve `prop:valor` o null si se descarta. */
function declaracion(prop: string, valor: string, o: CssOpciones, c: CssContador): string | null {
  const p = prop.trim().toLowerCase();
  let v = valor.trim();
  if (!p || !v || !PROPIEDADES.has(p)) return null; // incluye mso-*, -webkit-*, behavior, etc.
  if (PELIGROSO.test(v) || v.length > 2000) return null;
  // Comillas sin cerrar: el resto de la regla quedaría dentro de la cadena.
  if ((v.match(/"/g) ?? []).length % 2 || (v.match(/'/g) ?? []).length % 2) return null;
  // url(): solo en fondos y con origen permitido.
  if (/url\s*\(/i.test(v)) {
    if (!/^background(?:-image)?$/.test(p)) return null;
    let falla = false;
    v = v.replace(/url\s*\(([^)]*)\)/gi, (_, inner: string) => {
      const ok = urlFondo(inner, o, c);
      if (!ok) falla = true;
      return `url("${ok ?? ''}")`;
    });
    if (falla) {
      // Sin la imagen, un `background` con color sigue sirviendo: se conserva solo el color.
      if (p !== 'background') return null;
      const sinUrl = v.replace(/url\("[^"]*"\)/g, '').trim();
      if (!sinUrl || !VALOR_OK.test(sinUrl)) return null;
      return `background:${sinUrl.replace(/\s+/g, ' ')}`;
    }
    const resto = v.replace(/url\("[^"]*"\)/g, '');
    if (!VALOR_OK.test(resto)) return null;
  } else if (!VALOR_OK.test(v)) {
    return null;
  }
  // Funciones: solo colores, calc y url.
  for (const m of v.replace(/url\("[^"]*"\)/g, '').matchAll(/([a-z-]+)\s*\(/gi)) {
    if (!FUNCIONES.has(m[1].toLowerCase())) return null;
  }
  const base = v.replace(/\s*!important\s*$/i, '').trim().toLowerCase();
  if (p === 'display' && !DISPLAY.test(base)) return null;
  // Nada de posicionamiento fijo/absoluto/sticky (taparía la interfaz o el texto).
  if (p === 'position' && !/^(?:static|relative)$/.test(base)) return null;
  return `${p}:${v.replace(/\s+/g, ' ')}`;
}

/** Divide por `;` respetando comillas y paréntesis. */
function partir(texto: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let comilla: string | null = null;
  let par = 0;
  for (const ch of texto) {
    if (comilla) {
      if (ch === comilla) comilla = null;
    } else if (ch === '"' || ch === "'") comilla = ch;
    else if (ch === '(') par++;
    else if (ch === ')') par = Math.max(0, par - 1);
    else if (ch === sep && par === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Sanea el contenido de un atributo `style` (o el cuerpo de una regla). */
export function sanitizeStyle(style: string, o: CssOpciones = {}, c: CssContador = { remotasBloqueadas: 0 }): string {
  const limpio = String(style ?? '').replace(/\/\*[\s\S]*?(\*\/|$)/g, '');
  const out: string[] = [];
  for (const parte of partir(limpio, ';')) {
    const i = parte.indexOf(':');
    if (i <= 0) continue;
    const d = declaracion(parte.slice(0, i), parte.slice(i + 1), o, c);
    if (d) out.push(d);
  }
  return out.join(';');
}

/** Selector simple y sin trucos (tipo, clase, id, atributos, pseudoclases, combinadores). */
const SELECTOR_OK = /^[\w\s.#,>+~*:()[\]="'|^$-]+$/;
const MEDIA_OK = /^[\w\s(),:.\-]+$/;

/** Busca la llave de cierre que empareja la de `inicio` (índice de `{`). */
function cierre(css: string, inicio: number): number {
  let nivel = 0;
  for (let i = inicio; i < css.length; i++) {
    if (css[i] === '{') nivel++;
    else if (css[i] === '}' && --nivel === 0) return i;
  }
  return css.length;
}

function reglas(css: string, o: CssOpciones, c: CssContador, profundidad: number): string {
  const out: string[] = [];
  let i = 0;
  while (i < css.length) {
    const llave = css.indexOf('{', i);
    const puntoComa = css.indexOf(';', i);
    // Regla-@ sin bloque (@import, @charset, @namespace…): se descarta hasta el `;`.
    if (puntoComa !== -1 && (llave === -1 || puntoComa < llave) && css.slice(i, puntoComa).trim().startsWith('@')) {
      i = puntoComa + 1;
      continue;
    }
    if (llave === -1) break;
    const fin = cierre(css, llave);
    const prelude = css.slice(i, llave).trim();
    const cuerpo = css.slice(llave + 1, fin);
    i = fin + 1;
    if (prelude.startsWith('@')) {
      const m = /^@media\s+([\s\S]+)$/i.exec(prelude);
      if (m && profundidad === 0 && MEDIA_OK.test(m[1])) {
        const dentro = reglas(cuerpo, o, c, 1);
        if (dentro) out.push(`@media ${m[1].replace(/\s+/g, ' ').trim()}{${dentro}}`);
      }
      continue; // @font-face, @keyframes, @supports, @page, @import con bloque…: fuera.
    }
    if (!prelude || prelude.length > 1000 || !SELECTOR_OK.test(prelude) || /[{}]/.test(cuerpo)) continue;
    const decl = sanitizeStyle(cuerpo, o, c);
    if (decl) out.push(`${prelude.replace(/\s+/g, ' ')}{${decl}}`);
  }
  return out.join('');
}

/** Sanea el contenido de un bloque `<style>`. */
export function sanitizeStyleBlock(css: string, o: CssOpciones = {}, c: CssContador = { remotasBloqueadas: 0 }): string {
  const limpio = String(css ?? '')
    .slice(0, MAX_BLOQUE)
    .replace(/\/\*[\s\S]*?(\*\/|$)/g, '')
    .replace(/<!--|-->/g, '');
  // Un `\` (escape CSS) o `<` en cualquier parte del bloque: no se confía en nada de él.
  if (/[\\<]/.test(limpio)) return '';
  return reglas(limpio, o, c, 0);
}
