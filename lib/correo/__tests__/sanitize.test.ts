import { describe, expect, it } from 'vitest';
import { decodeEntities, extracto, htmlATexto, safeHref, sanitizeEmailHtml } from '../sanitize';

describe('Correo · saneado del HTML', () => {
  it('quita scripts, estilos, iframes, formularios y manejadores de eventos', () => {
    const { html } = sanitizeEmailHtml(
      '<p onclick="alert(1)">Hola</p><script>alert(1)</script><style>p{}</style><iframe src="x"></iframe><form><input></form><svg onload=alert(1)><circle/></svg><b>fin</b>'
    );
    expect(html).toBe('<p>Hola</p><b>fin</b>');
    expect(html).not.toMatch(/script|onclick|onload|iframe|style|form|svg/i);
  });

  it('bloquea enlaces javascript:, data: y ofuscados con entidades o espacios', () => {
    for (const href of ['javascript:alert(1)', 'jav&#x61;script:alert(1)', 'java\tscript:alert(1)', ' javascript:x', 'data:text/html;base64,PGI+', 'JaVaScRiPt&colon;alert(1)', 'vbscript:x']) {
      const { html } = sanitizeEmailHtml(`<a href="${href}">x</a>`);
      expect(html).toBe('<a>x</a>');
    }
  });

  it('conserva enlaces http(s) y mailto, siempre en otra pestaña y sin referente', () => {
    const { html } = sanitizeEmailHtml('<a href="https://www.invima.gov.co/?a=1&amp;b=2" target="_self">Portal</a> <a href="mailto:x@y.com">x</a>');
    expect(html).toContain('href="https://www.invima.gov.co/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer nofollow"');
    expect(html).toContain('href="mailto:x@y.com"');
    expect(html).not.toContain('_self');
  });

  it('bloquea imágenes remotas por defecto y las cuenta; las muestra (solo https) si se pide', () => {
    const src = '<img src="https://rastreo.ejemplo.com/p.gif"><img src="http://inseguro.com/a.png" alt="logo">';
    const bloq = sanitizeEmailHtml(src);
    expect(bloq.html).not.toContain('rastreo');
    expect(bloq.html).toContain('[logo]');
    expect(bloq.remotasBloqueadas).toBe(2);
    const ok = sanitizeEmailHtml(src, { remotas: true });
    expect(ok.html).toContain('src="https://rastreo.ejemplo.com/p.gif"');
    expect(ok.html).not.toContain('http://inseguro.com');
  });

  it('reemplaza las imágenes incrustadas (cid:) por su data: URI y conserva data:image', () => {
    const data = 'data:image/png;base64,iVBORw0KGgo=';
    const { html } = sanitizeEmailHtml('<img src="cid:Imagen1@01D"><img src="cid:otra"><img src="data:image/png;base64,AAAA">', { cid: { 'imagen1@01d': data } });
    expect(html).toBe(`<img src="${data}"><img src="data:image/png;base64,AAAA">`);
  });

  it('rechaza data: que no sea imagen y SVG incrustado', () => {
    const { html } = sanitizeEmailHtml('<img src="data:image/svg+xml;base64,PHN2Zz4="><img src="data:text/html;base64,PGI+">');
    expect(html).toBe('');
  });

  it('escapa el texto y cierra etiquetas abiertas', () => {
    const { html } = sanitizeEmailHtml('<div><p>a < b & c</p><table><tr><td colspan="2" style="x">1</td></tr>');
    expect(html).toBe('<div><p>a &lt; b &amp; c</p><table><tr><td colspan="2">1</td></tr></table></div>');
  });

  it('decodifica entidades para validar URL', () => {
    expect(decodeEntities('jav&#97;script&colon;')).toBe('javascript:');
    expect(safeHref('https://a.com')).toBe('https://a.com');
    expect(safeHref('https://a .com')).toBeNull();
    expect(safeHref(undefined)).toBeNull();
  });

  it('texto plano sin el historial citado de Outlook ni de Gmail', () => {
    const outlook = '<p>Nuevo pedido</p><div id="divRplyFwdMsg"><b>De:</b> Otro</div><p>viejo</p>';
    expect(htmlATexto(outlook)).toBe('Nuevo pedido');
    const gmail = '<div>Hola<br>equipo</div><div class="gmail_quote">El lun escribió: viejo</div>';
    expect(htmlATexto(gmail)).toBe('Hola\nequipo');
    const plano = '<p>Arriba</p><p>De: X &lt;x@y.com&gt;<br>Enviado: hoy<br>Asunto: y</p>';
    expect(htmlATexto(plano)).toBe('Arriba');
    expect(htmlATexto('<p>Todo</p><p>De: X</p>', { sinHistorial: false })).toContain('De: X');
  });

  it('extracto recorta sin partir palabras', () => {
    expect(extracto('corto', 10)).toBe('corto');
    const e = extracto('una frase bastante larga para recortar', 20);
    expect(e.length).toBeLessThanOrEqual(20);
    expect(e.endsWith('…')).toBe(true);
  });
});
