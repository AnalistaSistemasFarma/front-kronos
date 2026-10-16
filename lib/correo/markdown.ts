/**
 * Markdown sencillo de las respuestas del módulo Correo — funciones PURAS (sin DOM ni
 * dependencias), para el servidor y para la vista previa del navegador.
 *
 * Lo que se admite (lo mismo que ofrece la barra del editor):
 *   **negrita** / __negrita__, *cursiva* / _cursiva_, ~~tachado~~, `código`,
 *   [texto](https://…) y enlaces sueltos https://…, listas con «- », «* », «+ » o «1. »,
 *   citas con «> », títulos «# », «## », «### » y bloques ``` de código.
 * Un salto de línea simple se respeta (como en un correo); una línea en blanco separa párrafos.
 *
 * Seguridad: el texto se ESCAPA antes de dar formato (el HTML que alguien escriba queda como
 * texto) y el resultado pasa SIEMPRE por `sanitizeEmailHtml` (lista blanca de etiquetas y de
 * esquemas de enlace: solo http(s) y mailto). `markdownAHtml` nunca devuelve HTML sin sanear.
 */

import { safeHref, sanitizeEmailHtml } from './sanitize';

const MAX_ENTRADA = 100_000;

function esc(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Formato en línea sobre texto YA escapado. Los enlaces y el código se protegen con marcadores. */
function enLinea(textoEscapado: string): string {
  const guardados: string[] = [];
  const guardar = (html: string) => `\u0000${guardados.push(html) - 1}\u0000`;
  let t = textoEscapado.replace(/\u0000/g, '');

  // `código` (sin formato adentro)
  t = t.replace(/`([^`\n]+)`/g, (_, c: string) => guardar(`<code>${c}</code>`));

  // [texto](url) — la URL se valida (des-escapada) con la misma regla del saneado.
  t = t.replace(/\[([^\]\n]{1,500})\]\(([^)\s]{1,2000})\)/g, (todo: string, txt: string, url: string) => {
    const real = url.replace(/&amp;/g, '&');
    const href = safeHref(real) ?? (/^www\./i.test(real) ? `https://${real}` : null);
    if (!href) return todo;
    return guardar(`<a href="${esc(href)}">${formato(txt)}</a>`);
  });

  // Enlaces sueltos (https://…, http://…, www.…), sin la puntuación final.
  t = t.replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)\]'"])/gi, (_, pre: string, url: string) => {
    const real = url.replace(/&amp;/g, '&');
    const href = /^www\./i.test(real) ? `https://${real}` : safeHref(real);
    return href ? `${pre}${guardar(`<a href="${esc(href)}">${url}</a>`)}` : `${pre}${url}`;
  });

  t = formato(t);
  return t.replace(/\u0000(\d+)\u0000/g, (_, i: string) => guardados[Number(i)] ?? '');
}

/** Negrita, cursiva y tachado. «_» solo cuenta en límites de palabra (no rompe nombres_con_guion). */
function formato(t: string): string {
  return t
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/(^|[^*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?=[^\s_])([^_\n]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([^~\n]*?\S)~~/g, '<del>$1</del>');
}

type Bloque = { tipo: 'p' | 'ul' | 'ol' | 'quote' | 'pre' | 'h'; lineas: string[]; nivel?: number };

const RE_UL = /^\s{0,3}[-*+]\s+(.*)$/;
const RE_OL = /^\s{0,3}\d{1,3}[.)]\s+(.*)$/;
const RE_QUOTE = /^\s{0,3}>\s?(.*)$/;
const RE_H = /^\s{0,3}(#{1,3})\s+(.*?)\s*#*\s*$/;
const RE_FENCE = /^\s{0,3}```/;
const esSeparador = (l: string) => /^(?:-{3,}|\*{3,}|_{3,})$/.test(l.replace(/[ \t]/g, ''));

function bloques(md: string): Array<Bloque | { tipo: 'hr' }> {
  const out: Array<Bloque | { tipo: 'hr' }> = [];
  const lineas = md.replace(/\r\n?/g, '\n').split('\n');
  let actual: Bloque | null = null;
  const cerrar = () => {
    if (actual) out.push(actual);
    actual = null;
  };
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    if (RE_FENCE.test(l)) {
      cerrar();
      const codigo: string[] = [];
      for (i++; i < lineas.length && !RE_FENCE.test(lineas[i]); i++) codigo.push(lineas[i]);
      out.push({ tipo: 'pre', lineas: codigo });
      continue;
    }
    if (!l.trim()) {
      cerrar();
      continue;
    }
    if (esSeparador(l)) {
      cerrar();
      out.push({ tipo: 'hr' });
      continue;
    }
    const h = RE_H.exec(l);
    if (h) {
      cerrar();
      out.push({ tipo: 'h', nivel: h[1].length, lineas: [h[2]] });
      continue;
    }
    const tipos: Array<[Bloque['tipo'], RegExp]> = [
      ['ul', RE_UL],
      ['ol', RE_OL],
      ['quote', RE_QUOTE],
    ];
    let usado = false;
    for (const [tipo, re] of tipos) {
      const m = re.exec(l);
      if (!m) continue;
      if (!actual || (actual as Bloque).tipo !== tipo) {
        cerrar();
        actual = { tipo, lineas: [] };
      }
      (actual as Bloque).lineas.push(m[1]);
      usado = true;
      break;
    }
    if (usado) continue;
    const a = actual as Bloque | null;
    if (a && (a.tipo === 'ul' || a.tipo === 'ol') && /^\s{2,}\S/.test(l)) {
      // Continuación de un elemento de la lista (línea con sangría).
      a.lineas[a.lineas.length - 1] += `\n${l.trim()}`;
      continue;
    }
    if (!a || a.tipo !== 'p') {
      cerrar();
      actual = { tipo: 'p', lineas: [] };
    }
    (actual as unknown as Bloque).lineas.push(l);
  }
  cerrar();
  return out;
}

const conSaltos = (lineas: string[]) => lineas.map((l) => enLinea(esc(l.trimEnd()))).join('<br>');

/** HTML del Markdown, YA SANEADO. Texto vacío → cadena vacía. */
export function markdownAHtml(md: string): string {
  const texto = String(md ?? '').slice(0, MAX_ENTRADA);
  if (!texto.trim()) return '';
  const html = bloques(texto)
    .map((b) => {
      if (b.tipo === 'hr') return '<hr>';
      switch (b.tipo) {
        case 'pre':
          return `<pre><code>${esc(b.lineas.join('\n'))}</code></pre>`;
        case 'h': {
          const n = Math.min(4, (b.nivel ?? 1) + 1);
          return `<h${n}>${enLinea(esc(b.lineas[0]))}</h${n}>`;
        }
        case 'ul':
        case 'ol':
          return `<${b.tipo}>${b.lineas.map((li) => `<li>${conSaltos(li.split('\n'))}</li>`).join('')}</${b.tipo}>`;
        case 'quote':
          return `<blockquote>${conSaltos(b.lineas)}</blockquote>`;
        default:
          return `<p>${conSaltos(b.lineas)}</p>`;
      }
    })
    .join('');
  return sanitizeEmailHtml(html).html;
}

/**
 * Texto plano legible del Markdown (para las NOTAS de la solicitud, que se muestran como texto):
 * quita los marcadores de formato, deja las viñetas como «• » y los enlaces como «texto (url)».
 */
export function markdownATexto(md: string): string {
  const t = String(md ?? '').replace(/\r\n?/g, '\n').slice(0, MAX_ENTRADA);
  return t
    .split('\n')
    .filter((l) => !RE_FENCE.test(l))
    .map((l) => {
      let x = l;
      const h = RE_H.exec(x);
      if (h) x = h[2];
      x = x.replace(/^\s{0,3}[-*+]\s+/, '• ').replace(/^\s{0,3}>\s?/, '');
      return x
        .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, txt: string, url: string) => (txt === url ? url : `${txt} (${url})`))
        .replace(/\*\*(?=\S)(.*?\S)\*\*/g, '$1')
        .replace(/(^|[^\w])__(?=\S)(.*?\S)__(?!\w)/g, '$1$2')
        .replace(/(^|[^*\w])\*(?=[^\s*])([^*]*?[^\s*])\*(?!\*)/g, '$1$2')
        .replace(/(^|[^\w])_(?=[^\s_])([^_]*?[^\s_])_(?!\w)/g, '$1$2')
        .replace(/~~(?=\S)(.*?\S)~~/g, '$1')
        .replace(/`([^`]+)`/g, '$1');
    })
    .join('\n')
    .trim();
}
