/**
 * Saneamiento del Markdown del chat de agentes — parte PURA (sin React).
 *
 * -------------------------------------------------------------------------
 * POR QUÉ ESTE ARCHIVO EXISTE
 * -------------------------------------------------------------------------
 * El cuerpo de un mensaje se guarda como MARKDOWN CRUDO (ver
 * prisma/schema.prisma → ChatMessage.body y lib/chat/constants.ts). El render
 * ocurre en el navegador, y el texto lo produce un modelo de lenguaje que lee
 * correos, tickets y adjuntos: hay que asumir que cualquier cosa que llegue
 * puede venir de un tercero que intenta inyectar contenido.
 *
 * La política de render es CERRADA:
 *
 *   1. `react-markdown` + `remark-gfm`. NUNCA `rehype-raw`: sin él,
 *      react-markdown no interpreta HTML embebido — un `<script>` dentro del
 *      Markdown queda como texto, no como etiqueta.
 *   2. SIN Mermaid. La versión anterior de este chat
 *      (components/ai/AssistantMarkdown.tsx en la rama Implement-New-Agent)
 *      renderizaba diagramas con `securityLevel: 'loose'` y los inyectaba con
 *      `innerHTML`: eso es ejecución de código en el navegador de quien lea el
 *      mensaje. Se eliminó por completo; un fence ```mermaid se muestra como
 *      bloque de código y ya.
 *   3. Lista BLANCA de esquemas de URL (`http`, `https`, `mailto`, `tel`) y de
 *      rutas relativas de la propia aplicación. Todo lo demás — `javascript:`,
 *      `data:`, `vbscript:`, `file:` — se descarta.
 *   4. Lista BLANCA CERRADA de elementos (`ALLOWED_MARKDOWN_ELEMENTS`). Lo que
 *      no esté ahí no se pinta. Nótese que `img` NO está: una imagen remota es
 *      una baliza que filtra la IP y el momento de lectura de quien abre el
 *      mensaje.
 *   5. Topes de LONGITUD y de ANIDAMIENTO, para que un mensaje patológico no
 *      congele la pestaña.
 *
 * Todo lo de aquí es puro y sin dependencias para poder probarlo de verdad
 * (lib/chat/__tests__/markdown.test.ts). El componente que lo usa es
 * components/chat/ChatMarkdown.tsx.
 */

/**
 * Elementos permitidos en el render. Lista CERRADA: agregar algo aquí es una
 * decisión de seguridad, no un detalle de estilo.
 *
 * Deliberadamente FUERA: `img` (baliza de seguimiento), `input` (casillas de
 * las listas de tareas de GFM), `iframe`, `video`, `audio`, `object`, `svg` y
 * cualquier etiqueta con handlers o carga remota.
 */
export const ALLOWED_MARKDOWN_ELEMENTS = [
  'p',
  'strong',
  'em',
  'del',
  'code',
  'pre',
  'ul',
  'ol',
  'li',
  'blockquote',
  'a',
  'h1',
  'h2',
  'h3',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'hr',
  'br',
] as const;

/** Esquemas de URL admitidos en un enlace. */
export const ALLOWED_URL_SCHEMES = ['http', 'https', 'mailto', 'tel'] as const;

/**
 * Tope de caracteres que se RENDERIZAN. Coincide con
 * MAX_AGENT_MESSAGE_CHARS: la API ya no acepta más, pero el cliente no confía
 * en que el dato de la base haya pasado siempre por esa validación.
 */
export const MAX_MARKDOWN_CHARS = 40_000;

/**
 * Profundidad máxima de anidamiento (citas y listas). Un Markdown con cientos
 * de niveles produce un árbol igual de profundo en React y bloquea el hilo
 * principal; recortarlo no pierde información legible.
 */
export const MAX_MARKDOWN_DEPTH = 6;

/** Aviso que se añade al final cuando hubo que recortar. */
export const TRUNCATION_NOTICE = '\n\n_(mensaje recortado por longitud)_';

/**
 * Normaliza una URL de enlace contra la lista blanca.
 *
 * Devuelve la cadena vacía cuando la URL no es admisible: react-markdown pinta
 * el `<a>` sin `href`, así que el texto sigue siendo legible pero el enlace no
 * hace nada. Se admiten rutas relativas (`/process/...`, `./x`, `#ancla`)
 * porque son navegación dentro de SynerLink, no una URL controlada por el
 * emisor del mensaje.
 *
 * El truco de los `\t\n\r` y los espacios de control es importante: navegadores
 * históricos aceptan `java\tscript:alert(1)` como `javascript:`.
 */
export function sanitizeChatUrl(url: string | null | undefined): string {
  if (typeof url !== 'string') return '';

  // Fuera espacios, saltos y caracteres de control (incl. NUL) en cualquier
  // posición: son el vehículo clásico para disfrazar el esquema.
  const cleaned = url.replace(/[\u0000-\u0020\u007f-\u00a0]/g, '');
  if (cleaned.length === 0) return '';

  // Relativas y anclas: no llevan esquema, no hay nada que suplantar.
  if (cleaned.startsWith('/') || cleaned.startsWith('#') || cleaned.startsWith('./') || cleaned.startsWith('../')) {
    // `//host` es una URL absoluta protocolo-relativa disfrazada de ruta.
    if (cleaned.startsWith('//')) return '';
    return cleaned;
  }

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(cleaned);
  if (!schemeMatch) {
    // Sin esquema y sin barra inicial: texto suelto tipo "ejemplo.com". Se
    // deja pasar como relativa; el navegador la resuelve dentro del sitio.
    return cleaned;
  }

  const scheme = schemeMatch[1].toLowerCase();
  return (ALLOWED_URL_SCHEMES as readonly string[]).includes(scheme) ? cleaned : '';
}

/**
 * Recorta el cuerpo al tope de longitud. Devuelve también si hubo recorte para
 * que la interfaz pueda avisarlo.
 */
export function clampMarkdownLength(
  raw: string,
  maxChars: number = MAX_MARKDOWN_CHARS
): { text: string; truncated: boolean } {
  if (typeof raw !== 'string') return { text: '', truncated: false };
  if (raw.length <= maxChars) return { text: raw, truncated: false };
  return { text: raw.slice(0, maxChars) + TRUNCATION_NOTICE, truncated: true };
}

/**
 * Mide el prefijo de citas (`> > >`) de una línea, DEVOLVIENDO su longitud y
 * su profundidad.
 *
 * Se hace con un recorrido a mano y no con una expresión regular a propósito:
 * el patrón natural (`/^((?:\s{0,3}>\s?)+)/`) tiene cuantificadores anidados y
 * es vulnerable a retroceso catastrófico — justo lo que este archivo intenta
 * evitar, y lo que marca la regla `security/detect-unsafe-regex`. Este bucle
 * es lineal en la longitud de la línea, sin retroceso posible.
 */
function measureQuotePrefix(line: string): { length: number; depth: number } {
  let index = 0;
  let depth = 0;

  for (;;) {
    let cursor = index;
    let spaces = 0;
    while (cursor < line.length && spaces < 3 && (line[cursor] === ' ' || line[cursor] === '\t')) {
      cursor += 1;
      spaces += 1;
    }
    if (line[cursor] !== '>') break;
    cursor += 1;
    if (line[cursor] === ' ') cursor += 1;
    depth += 1;
    index = cursor;
  }

  return { length: index, depth };
}

/**
 * Aplana el anidamiento excesivo de citas y listas.
 *
 * Recorta los `>` encadenados y la sangría de las listas a `maxDepth` niveles.
 * Las líneas DENTRO de un bloque de código cercado se dejan intactas: ahí la
 * sangría es contenido, no estructura.
 */
export function limitNestingDepth(
  raw: string,
  maxDepth: number = MAX_MARKDOWN_DEPTH
): string {
  if (typeof raw !== 'string' || raw.length === 0) return '';

  const maxIndent = maxDepth * 2;
  const lines = raw.split('\n');
  let insideFence = false;

  const out = lines.map((line) => {
    // Un cercado abre/cierra con ``` o ~~~ al principio de la línea.
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      insideFence = !insideFence;
      return line;
    }
    if (insideFence) return line;

    // 1) Citas encadenadas: "> > > > > > > > texto".
    const quote = measureQuotePrefix(line);
    let rest = line;
    let prefix = '';
    if (quote.depth > 0) {
      prefix = '> '.repeat(Math.min(quote.depth, maxDepth));
      rest = line.slice(quote.length);
    }

    // 2) Sangría de listas: se recorta el bloque de espacios inicial.
    const indent = /^[ \t]+/.exec(rest);
    if (indent) {
      const spaces = indent[0].replace(/\t/g, '  ').length;
      rest = ' '.repeat(Math.min(spaces, maxIndent)) + rest.slice(indent[0].length);
    }

    return prefix + rest;
  });

  return out.join('\n');
}

/**
 * Punto de entrada único: aplica longitud y anidamiento en el orden correcto.
 * Es lo que consume ChatMarkdown antes de entregarle el texto a react-markdown.
 */
export function prepareChatMarkdown(
  raw: string | null | undefined,
  opts: { maxChars?: number; maxDepth?: number } = {}
): { text: string; truncated: boolean } {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { text: '', truncated: false };
  }
  const clamped = clampMarkdownLength(raw, opts.maxChars ?? MAX_MARKDOWN_CHARS);
  return {
    text: limitNestingDepth(clamped.text, opts.maxDepth ?? MAX_MARKDOWN_DEPTH),
    truncated: clamped.truncated,
  };
}
