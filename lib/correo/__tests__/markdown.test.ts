import { describe, expect, it } from 'vitest';
import { markdownAHtml, markdownATexto } from '../markdown';

describe('Correo · Markdown de las respuestas', () => {
  it('negrita, cursiva, tachado y código; respeta los saltos de línea', () => {
    expect(markdownAHtml('Hola **Laura**, *gracias*.\nSegunda línea')).toBe('<p>Hola <strong>Laura</strong>, <em>gracias</em>.<br>Segunda línea</p>');
    expect(markdownAHtml('__fuerte__ y _suave_ ~~no~~ `co*de*`')).toBe('<p><strong>fuerte</strong> y <em>suave</em> <del>no</del> <code>co*de*</code></p>');
  });

  it('no confunde guiones bajos dentro de palabras ni asteriscos sueltos', () => {
    expect(markdownAHtml('archivo_final_v2.pdf y 3 * 4')).toBe('<p>archivo_final_v2.pdf y 3 * 4</p>');
  });

  it('listas con viñetas y numeradas, párrafos, citas, títulos y separador', () => {
    expect(markdownAHtml('- uno\n- **dos**\n\n1. a\n2. b')).toBe('<ul><li>uno</li><li><strong>dos</strong></li></ul><ol><li>a</li><li>b</li></ol>');
    expect(markdownAHtml('Párrafo 1\n\nPárrafo 2')).toBe('<p>Párrafo 1</p><p>Párrafo 2</p>');
    expect(markdownAHtml('> cita\n> dos\n\n---\n# Título')).toBe('<blockquote>cita<br>dos</blockquote><hr><h2>Título</h2>');
  });

  it('enlaces [texto](url) y sueltos, siempre en otra pestaña; sin la puntuación final', () => {
    const html = markdownAHtml('ver [portal](https://www.invima.gov.co/?a=1&b=2) y https://x.com/a.');
    expect(html).toContain('<a href="https://www.invima.gov.co/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer nofollow">portal</a>');
    expect(html).toContain('<a href="https://x.com/a" target="_blank" rel="noopener noreferrer nofollow">https://x.com/a</a>.');
    expect(markdownAHtml('[correo](mailto:x@y.com)')).toContain('href="mailto:x@y.com"');
  });

  it('el HTML escrito queda como texto y los esquemas peligrosos no se enlazan', () => {
    const html = markdownAHtml('<script>alert(1)</script> <img src=x onerror=alert(1)> [x](javascript:alert(1)) [y](data:text/html,1)');
    expect(html).not.toMatch(/<script|<img|href=/i);
    expect(html).toContain('&lt;script&gt;');
    expect(markdownAHtml('```\n<b>x</b>\n```')).toBe('<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>');
    expect(markdownAHtml('[a" onclick="x](https://y.com/" onclick=")')).not.toMatch(/onclick="/);
  });

  it('vacío → cadena vacía', () => {
    expect(markdownAHtml('   \n ')).toBe('');
  });

  it('texto plano legible para la nota de la solicitud', () => {
    expect(markdownATexto('Hola **Laura**\n- uno\n- *dos*\n[portal](https://p.co) `x`')).toBe('Hola Laura\n• uno\n• dos\nportal (https://p.co) x');
    expect(markdownATexto('archivo_final_v2 y 3 * 4')).toBe('archivo_final_v2 y 3 * 4');
  });
});
