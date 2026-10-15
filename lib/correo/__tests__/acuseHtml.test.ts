import { describe, expect, it } from 'vitest';
import { textoAcuse } from '../acuse';
import {
  ACUSE_HTML_BOTON,
  ACUSE_HTML_TITULO,
  datosTarjeta,
  documentoAcuse,
  escaparHtml,
  fechaLarga,
  fragmentoAcuse,
  insertarSobreHistorial,
  logoAcuseUrl,
  urlSegura,
  type DatosAcuseHtml,
} from '../plantillas/acuse.html';

// Plantilla HTML del acuse en el hilo (Nicolás, 2026-10-15 14:46: «con los lineamientos, no algo tan plano»).
const base: DatosAcuseHtml = {
  id: 812,
  titulo: 'Revisión de contrato de arrendamiento',
  enlace: 'https://synerlink.ejemplo.com/process/request-general/view-request?id=812&from=general-requests',
  firma: 'Laura Ayala',
  categoria: 'Jurídica',
  proceso: 'Elaboración y revisión de contratos',
  empresa: 'ONE LATAM PHARMA',
  creada: '2026-10-15T19:30:00Z',
  responsable: 'María Camila Pérez, Laura Ayala',
  logoUrl: 'https://synerlink.ejemplo.com/email/logo-synerlink.png',
};

describe('Acuse HTML · escape y URL', () => {
  it('escapa los cinco caracteres especiales', () => {
    expect(escaparHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  it('ningún valor dinámico inyecta HTML (título, firma, empresa, proceso, responsable)', () => {
    const malo = '<img src=x onerror=alert(1)><script>alert(1)</script>';
    const html = fragmentoAcuse({ ...base, titulo: malo, firma: malo, empresa: malo, proceso: malo, categoria: malo, responsable: malo, id: malo });
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('solo acepta enlaces http(s): javascript:/data:/relativas no generan botón', () => {
    expect(urlSegura('javascript:alert(1)')).toBeNull();
    expect(urlSegura('data:text/html,hola')).toBeNull();
    expect(urlSegura('/process/x')).toBeNull();
    expect(urlSegura('https://a.b/c?d=1')).toBe('https://a.b/c?d=1');
    const sin = fragmentoAcuse({ ...base, enlace: 'javascript:alert(1)' });
    expect(sin).not.toContain('javascript:');
    expect(sin).not.toContain(ACUSE_HTML_BOTON);
  });

  it('solo el botón lleva la URL (VML para Outlook + enlace); ninguna URL visible en el texto', () => {
    const html = fragmentoAcuse(base);
    const href = 'href="https://synerlink.ejemplo.com/process/request-general/view-request?id=812&amp;from=general-requests"';
    expect(html.split(href).length - 1).toBe(2); // v:roundrect (Outlook escritorio) y <a> píldora
    expect(html).toContain('<v:roundrect');
    expect(html).toContain('border-radius:980px');
    expect(html).toContain(ACUSE_HTML_BOTON);
    expect(html).not.toContain('Si el botón no funciona');
    // Fuera de atributos no hay ninguna URL (texto visible).
    const visible = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ');
    expect(visible).not.toMatch(/https?:\/\//);
  });

  it('logo absoluto desde la base del ambiente; sin base, nombre en texto', () => {
    expect(logoAcuseUrl('https://synerlink.ejemplo.com/')).toBe('https://synerlink.ejemplo.com/email/logo-synerlink.png');
    expect(logoAcuseUrl('')).toBeNull();
    expect(fragmentoAcuse({ ...base, logoUrl: null })).not.toContain('<img');
    expect(fragmentoAcuse(base)).toContain('src="https://synerlink.ejemplo.com/email/logo-synerlink.png" width="160" height="33"');
    // Modo oscuro (Apple Mail / Outlook iOS): versión blanca del logo vigente.
    expect(fragmentoAcuse(base)).toContain('src="https://synerlink.ejemplo.com/email/logo-synerlink-blanco.png"');
  });
});

describe('Acuse HTML · contenido', () => {
  it('título, número, tarjeta, explicación y pie', () => {
    const html = fragmentoAcuse(base);
    expect(html).toContain(ACUSE_HTML_TITULO);
    expect(html).toContain('#812');
    expect(html).toContain('Jurídica · Elaboración y revisión de contratos');
    expect(html).toContain('ONE LATAM PHARMA');
    expect(html).toContain('15 de octubre de 2026');
    expect(html).toContain('María Camila Pérez, Laura Ayala');
    expect(html).toContain('respondan a este mismo correo y quedará como nota de la solicitud');
    expect(html).toContain('Laura Ayala');
    expect(html).toContain('Group Shared Services Latinoamérica');
  });

  it('omite las filas sin dato (p. ej. responsable desconocido)', () => {
    expect(datosTarjeta({ ...base, responsable: null, empresa: '' }).map(([k]) => k)).toEqual(['Proceso', 'Fecha de creación']);
  });

  it('email-safe estilo Apple: tablas, estilos en línea, máx. 560 px, tipografía del sistema, modo oscuro, sin scripts', () => {
    const html = fragmentoAcuse(base);
    expect(html).toContain('role="presentation"');
    expect(html).toContain('max-width:560px');
    expect(html).toContain('-apple-system,BlinkMacSystemFont');
    expect(html).toContain('background-color:#f5f5f7');
    expect(html).toContain('border-radius:18px');
    expect(html).toContain('@media (prefers-color-scheme: dark)');
    expect(html).not.toMatch(/<script/);
    const doc = documentoAcuse(base);
    expect(doc).toMatch(/^<!DOCTYPE html>/);
    expect(doc).toContain('<meta name="color-scheme" content="light dark">');
  });

  it('fecha larga en hora de Colombia', () => {
    expect(fechaLarga('2026-10-16T03:00:00Z')).toBe('15 de octubre de 2026');
    expect(fechaLarga(null)).toBe('');
  });

  it('las dos variantes (HTML y texto plano) dicen lo mismo', () => {
    const t = textoAcuse({ id: 812, titulo: base.titulo, enlace: base.enlace, firma: base.firma });
    for (const x of ['#812', base.titulo, 'Laura Ayala']) {
      expect(t).toContain(x);
      expect(fragmentoAcuse(base)).toContain(x);
    }
    expect(t).toContain(base.enlace);
  });

  it('snapshot del correo completo', () => {
    expect(documentoAcuse(base)).toMatchSnapshot();
  });
});

describe('Acuse HTML · encima del historial citado', () => {
  it('se inserta justo después de <body> y conserva lo que Outlook citó', () => {
    const borrador = '<html><head><meta charset="utf-8"></head><body dir="ltr"><div id="divRplyFwdMsg">De: Uno</div><blockquote>Hola</blockquote></body></html>';
    const r = insertarSobreHistorial(borrador, '<div>ACUSE</div>');
    expect(r.startsWith('<html><head><meta charset="utf-8"></head><body dir="ltr">')).toBe(true);
    expect(r.indexOf('ACUSE')).toBeLessThan(r.indexOf('divRplyFwdMsg'));
    expect(r).toContain('<div id="divRplyFwdMsg">De: Uno</div><blockquote>Hola</blockquote></body></html>');
  });

  it('sin <body> (fragmento) lo antepone', () => {
    expect(insertarSobreHistorial('<p>citado</p>', '<div>A</div>')).toMatch(/^<div>A<\/div>[\s\S]*<p>citado<\/p>$/);
    expect(insertarSobreHistorial(null, '<div>A</div>')).toContain('<div>A</div>');
  });
});
