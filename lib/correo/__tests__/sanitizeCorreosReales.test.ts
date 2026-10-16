import { describe, expect, it } from 'vitest';
import { htmlATexto, sanitizeEmailHtml } from '../sanitize';
import { sanitizeStyle, sanitizeStyleBlock } from '../sanitizeCss';
import { BOLETIN, GMAIL, OUTLOOK_RESPUESTA, XSS } from './fixtures/correosHtml';

/**
 * Compatibilidad con el HTML real de los clientes de correo (2026-10-16): las tablas, los estilos en
 * línea y los `<style>` de Outlook, Gmail y boletines se conservan, saneados. Muestras SINTÉTICAS.
 */
const vista = (html: string, o: { remotas?: boolean; cid?: Record<string, string> } = {}) => sanitizeEmailHtml(html, { ...o, bloquesEstilo: true });

describe('Correo · HTML de Outlook, Gmail y boletines', () => {
  it('Outlook: conserva la tabla con bordes, fondo del encabezado, fila resaltada y padding', () => {
    const { html } = vista(OUTLOOK_RESPUESTA);
    expect(html).toContain('<table width="600" border="1" cellpadding="0" cellspacing="0" class="MsoTableGrid" style="width:450.0pt;border-collapse:collapse;border:none">');
    expect(html).toContain('style="width:150.0pt;border:solid #1F3864 1.0pt;background:#1F3864;padding:4.0pt 6.0pt 4.0pt 6.0pt"');
    expect(html).toContain('<span style="color:white">Agente</span>');
    expect(html).toContain('background:#FFF2CC');
    expect(html).toContain('<span style="color:#C00000">Pendiente</span>');
    expect(html).toContain('valign="top"');
  });

  it('Outlook: quita mso-*, <o:p>, VML y comentarios condicionales sin perder el texto ni la estructura', () => {
    const { html } = vista(OUTLOOK_RESPUESTA);
    expect(html).not.toMatch(/mso-|<o:p|<\/o:p|<v:|xml|\[if|endif|@font-face|@page|Generator/i);
    expect(html).toContain('<p class="MsoNormal">Buenas tardes,</p>');
    // El historial citado se sigue viendo (con su separador).
    expect(html).toContain('<div style="border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0cm 0cm 0cm">');
    expect(html).toContain('Mensaje anterior de ejemplo.');
    // El <style> del <head> (envuelto en <!-- -->) llega saneado y al inicio.
    expect(html.startsWith('<style>p.MsoNormal, li.MsoNormal, div.MsoNormal{margin:0cm;font-size:11.0pt;font-family:"Aptos",sans-serif}')).toBe(true);
    // <body> pasa a <div> (conserva sus estilos) y no queda <html>/<head>.
    expect(html).toContain('<div lang="ES-CO" style="word-wrap:break-word">');
    expect(html).not.toMatch(/<\/?(html|head|body|meta)\b/i);
  });

  it('Outlook: el texto plano y el extracto siguen sin historial y sin CSS', () => {
    const t = htmlATexto(OUTLOOK_RESPUESTA);
    expect(t).toContain('Buenas tardes,');
    expect(t).toContain('Agente de prueba B');
    expect(t).not.toContain('Mensaje anterior de ejemplo');
    expect(t).not.toMatch(/MsoNormal|font-family|\{/);
  });

  it('Gmail: dir, font (face/color/size), bgcolor, align, cellpadding y la cita con su borde', () => {
    const { html } = vista(GMAIL);
    expect(html).toContain('<div dir="ltr">');
    expect(html).toContain('<div style="font-family:arial,sans-serif;font-size:small;color:#222222">');
    expect(html).toContain('<table cellpadding="6" style="border-collapse:collapse;border:1px solid #cccccc">');
    expect(html).toContain('<th align="left" bgcolor="#e8f0fe" style="border:1px solid #cccccc">Tarea</th>');
    expect(html).toContain('<font color="#0b5394" face="verdana, sans-serif" size="2">Firma de ejemplo</font>');
    expect(html).toContain('<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">');
  });

  it('boletín: <style> con clases, ids, combinadores y @media; fuera @import, @font-face, position:fixed y expression()', () => {
    const r = vista(BOLETIN);
    expect(r.html).toContain('<style>body{background-color:#eef2f7;margin:0}');
    expect(r.html).toContain('.contenedor{max-width:600px;background:#ffffff;border-radius:8px}');
    expect(r.html).toContain('#bodyTable > tbody td{font-family:\'Segoe UI\', Arial, sans-serif}');
    expect(r.html).toContain('@media only screen and (max-width: 480px){.contenedor{width:100% !important}}');
    expect(r.html).toContain('.boton{display:inline-block;background-color:#f59e0b;color:#111111;padding:10px 18px}');
    expect(r.html).not.toMatch(/@import|@font-face|fixed|expression|behavior|binding|\.malo|fuentes\.ejemplo/);
    // Fondos remotos: bloqueados por defecto (se conserva el color) y contados para «Mostrar imágenes».
    expect(r.html).toContain('.cabecera td{background:#0b3d91 no-repeat;');
    expect(r.html).toContain('<td bgcolor="#fafafa">');
    expect(r.html).not.toContain('cdn.ejemplo.com');
    expect(r.remotasBloqueadas).toBe(2);
    expect(r.html).toContain('<table align="center" width="100%" class="contenedor" id="bodyTable">');
  });

  it('boletín con «Mostrar imágenes»: los fondos https se muestran; http nunca', () => {
    const r = vista(BOLETIN, { remotas: true });
    expect(r.html).toContain('background:#0b3d91 url("https://cdn.ejemplo.com/fondo.png") no-repeat');
    expect(r.html).toContain('background="https://cdn.ejemplo.com/textura.png"');
    expect(r.remotasBloqueadas).toBe(0);
    expect(sanitizeStyle('background:url(http://inseguro.ejemplo.com/a.png)', { remotas: true })).toBe('');
  });

  it('fondos incrustados (cid:) se cambian por su data: URI, en CSS y en el atributo background', () => {
    const data = 'data:image/png;base64,iVBORw0KGgo=';
    const { html } = vista('<td background="cid:fondo@01" style="background-image:url(\'cid:fondo@01\')">x</td>', { cid: { 'fondo@01': data } });
    expect(html).toBe(`<td background="${data}" style="background-image:url(&quot;${data}&quot;)">x</td>`);
  });

  it('sin bloquesEstilo (texto plano, extractos, Markdown) los <style> siguen fuera', () => {
    expect(sanitizeEmailHtml(BOLETIN).html).not.toContain('<style');
  });

  it('instantánea del HTML que se pinta (respuesta de Outlook)', () => {
    expect(vista(OUTLOOK_RESPUESTA).html).toMatchSnapshot();
  });
});

describe('Correo · intentos de XSS', () => {
  it('onerror / on*: fuera; la imagen sin origen válido queda como su texto alternativo', () => {
    const { html } = vista(XSS.onerror);
    expect(html).toBe('<span>[foto]</span><p style="color:red">texto</p>');
  });

  it('href javascript: (con mayúsculas, espacios o entidades): el enlace queda sin href', () => {
    expect(vista(XSS.hrefJs).html).toBe('<a>uno</a><a>dos</a><a>tres</a>');
  });

  it('CSS expression(), url(javascript:), behavior, -moz-binding, escapes y comentarios: solo queda lo sano', () => {
    const { html } = vista(XSS.cssExpression);
    expect(html).toBe('<div style="color:blue">a</div><div>b</div><div style="color:red">c</div><div>d</div><div>e</div>');
  });

  it('svg con script e imagen data:svg: fuera con todo su contenido', () => {
    expect(vista(XSS.svgScript).html).toBe('<p>después</p>');
  });

  it('meta refresh, base y link: fuera, sin tragarse el resto del correo', () => {
    expect(vista(XSS.metaRefresh).html).toBe('<p>hola</p>');
  });

  it('<style>: @import y fondos remotos fuera; un bloque con escapes CSS se descarta entero', () => {
    const r = vista(XSS.styleBlock);
    expect(r.html).toBe('<style>p{color:red}.d{color:green}</style><p class="a b d">x</p>');
  });

  it('position fixed/absolute fuera (no puede tapar la interfaz); relative se permite', () => {
    expect(vista(XSS.posicion).html).toBe('<div style="width:100%;height:100%;background:#fff">tapa</div><div>b</div><div style="position:relative">c</div>');
  });

  it('un </style> dentro de una cadena no abre una etiqueta nueva', () => {
    const { html } = vista(XSS.cierreEstilo);
    expect(html).toBe('"}<p>fin</p>');
    expect(html).not.toMatch(/<img|onerror/);
  });

  it('sanitizeStyle / sanitizeStyleBlock directos', () => {
    expect(sanitizeStyle('color:red;mso-line-height-rule:exactly;-webkit-text-size-adjust:100%;font-weight:bold')).toBe('color:red;font-weight:bold');
    expect(sanitizeStyle('display:none')).toBe('display:none');
    expect(sanitizeStyle('display:-webkit-box;color:x(1);width:calc(100% - 10px)')).toBe('width:calc(100% - 10px)');
    expect(sanitizeStyle('color:red</style><script>')).toBe('');
    expect(sanitizeStyleBlock('a{color:red}<img>')).toBe('');
    expect(sanitizeStyleBlock('@media (max-width:1px){@media print{a{color:red}}}')).toBe('');
    expect(sanitizeStyleBlock('a[href^="https"]{color:red}')).toBe('a[href^="https"]{color:red}');
  });
});
