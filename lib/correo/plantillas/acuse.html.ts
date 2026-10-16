/**
 * Plantilla HTML del acuse en el hilo (Nicolás Rivera, 2026-10-15 14:46: «era con una plantilla
 * HTML bien chévere y con los lineamientos, no algo tan plano»).
 *
 * Única fuente del HTML del acuse: la usa el servidor (Graph: createReply(All) → PATCH del cuerpo
 * → send) y la vista previa del navegador (iframe aislado, como el visor del hilo). Módulo PURO.
 *
 * Estilo Apple (Nicolás, 2026-10-15 15:10: «hazlo estilo Apple»): fondo #f5f5f7, columna centrada
 * con mucho aire, logo vigente de SynerLink pequeño y centrado, titular grande, tarjeta blanca
 * redondeada con filas livianas y un único botón tipo píldora en el azul del logo (#2d2e82).
 * SIN URLs visibles (Nicolás, 15:05: «no pongas URLs en el correo, solo botones»): el botón es
 * a prueba de Outlook de escritorio (VML) y no necesita enlace alterno.
 * Apto para correo: tablas y estilos en línea, máximo 600 px, fluido en celular; modo oscuro con
 * fondos explícitos + reglas prefers-color-scheme para Apple Mail / Outlook iOS y macOS.
 *
 * TODO valor dinámico pasa por escaparHtml (título, nombres, empresa…) y el enlace solo se acepta
 * http(s): nada que llegue del correo o de la solicitud puede inyectar HTML.
 */

export interface DatosAcuseHtml {
  id: number | string;
  titulo: string;
  /** URL absoluta de la solicitud (solo http/https; si no, el botón no lleva enlace). */
  enlace: string;
  /** Nombre de quien informa (la persona dueña del buzón). */
  firma: string;
  categoria?: string | null;
  proceso?: string | null;
  empresa?: string | null;
  creada?: Date | string | null;
  /** Responsable(s) del proceso, si se conocen. */
  responsable?: string | null;
  /** URL absoluta (https) del logo de SynerLink; sin ella se pinta el nombre en texto. */
  logoUrl?: string | null;
}

export const ACUSE_HTML_TITULO = 'Se creó una solicitud a partir de este correo';
export const ACUSE_HTML_BOTON = 'Ver solicitud en SynerLink';
export const ACUSE_ORGANIZACION = 'Group Shared Services Latinoamérica';
export const LOGO_ACUSE_RUTA = '/email/logo-synerlink.png';
export const LOGO_ACUSE_ANCHO = 160;
export const LOGO_ACUSE_ALTO = 33;


/** Escapa los cinco caracteres con significado en HTML (también dentro de atributos). */
export function escaparHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Solo http(s) absolutas; cualquier otra cosa (javascript:, data:, relativa) se descarta. */
export function urlSegura(v: string | null | undefined): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Logo vigente de SynerLink para correo: public/email/logo-synerlink.png, rasterizado de
 * public/Logo_Principal.svg (el de Header y login) a 440×92, porque Outlook de escritorio no pinta
 * SVG. Se muestra a 160×33 (nítido en pantallas 2×). URL absoluta con la base del ambiente.
 */
export function logoAcuseUrl(base: string | null | undefined): string | null {
  const b = String(base ?? '').trim().replace(/\/+$/, '');
  return b ? urlSegura(`${b}${LOGO_ACUSE_RUTA}`) : null;
}

/** «15 de octubre de 2026» (hora de Colombia). */
export function fechaLarga(v: Date | string | null | undefined): string {
  if (v == null || v === '') return '';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' }).format(d);
}

const limpio = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();


/** Paleta estilo Apple con el azul del logo vigente (Logo_Principal.svg). */
const C = {
  fondo: '#f5f5f7',
  tarjeta: '#ffffff',
  tinta: '#1d1d1f',
  gris: '#6e6e73',
  gris2: '#86868b',
  separador: '#e8e8ed',
  marca: '#2d2e82',
  marca2: '#1d70b7',
} as const;
const FUENTE = `font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Helvetica Neue',Helvetica,Arial,sans-serif;`;

/** Modo oscuro para los clientes que leen <style> (Apple Mail, Outlook iOS/macOS). El resto usa los fondos explícitos. */
const ESTILO_OSCURO = `<style>
@media (prefers-color-scheme: dark) {
  .sl-fondo { background-color:#000000 !important; }
  .sl-tarjeta { background-color:#1c1c1e !important; }
  .sl-tinta { color:#f5f5f7 !important; }
  .sl-gris { color:#a1a1a6 !important; }
  .sl-sep { border-color:#38383a !important; }
  .sl-num { color:#8e9cff !important; }
  .sl-logo-claro { display:none !important; }
  .sl-logo-oscuro { display:block !important; max-height:none !important; overflow:visible !important; }
}
</style>`;

function filaDato(etiqueta: string, valor: string, primera: boolean): string {
  const borde = primera ? '' : `border-top:1px solid ${C.separador};`;
  return `<tr>
<td class="sl-gris sl-sep" valign="top" style="${borde}padding:14px 12px 14px 0;width:120px;${FUENTE}font-size:14px;line-height:1.4;color:${C.gris};">${escaparHtml(etiqueta)}</td>
<td class="sl-tinta sl-sep" valign="top" align="right" style="${borde}padding:14px 0;${FUENTE}font-size:14px;line-height:1.4;color:${C.tinta};font-weight:500;text-align:right;">${escaparHtml(valor)}</td>
</tr>`;
}

/** Filas de la tarjeta (solo las que tienen valor). */
export function datosTarjeta(d: DatosAcuseHtml): Array<[string, string]> {
  const proceso = [limpio(d.categoria), limpio(d.proceso)].filter(Boolean).join(' · ');
  const filas: Array<[string, string]> = [
    ['Proceso', proceso],
    ['Empresa', limpio(d.empresa)],
    ['Fecha de creación', fechaLarga(d.creada)],
    ['Responsable', limpio(d.responsable)],
  ];
  return filas.filter(([, v]) => v);
}

/** Botón píldora a prueba de Outlook de escritorio (VML) y del resto (tabla + enlace). Sin URL visible. */
function boton(href: string | null): string {
  if (!href) return '';
  const texto = escaparHtml(ACUSE_HTML_BOTON);
  const h = escaparHtml(href);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
<tr><td align="center">
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${h}" style="height:48px;v-text-anchor:middle;width:280px;" arcsize="50%" stroke="f" fillcolor="${C.marca}">
<w:anchorlock/><center style="color:#ffffff;font-family:Segoe UI,Arial,sans-serif;font-size:16px;font-weight:bold;">${texto}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-- -->
<a href="${h}" target="_blank" rel="noopener" style="display:inline-block;background-color:${C.marca};color:#ffffff;${FUENTE}font-size:16px;font-weight:600;line-height:48px;padding:0 32px;border-radius:980px;text-decoration:none;letter-spacing:-0.01em;mso-hide:all;">${texto}</a>
<!--<![endif]-->
</td></tr>
</table>`;
}

/**
 * Bloque del acuse (sin <html>/<head>): es lo que se inserta ENCIMA del historial citado del
 * borrador de respuesta. Tablas y estilos en línea; ancho máximo 600 px, fluido en celular.
 */
export function fragmentoAcuse(d: DatosAcuseHtml): string {
  const href = urlSegura(d.enlace);
  const logo = urlSegura(d.logoUrl ?? null);
  const titulo = limpio(d.titulo) || '(sin título)';
  const firma = limpio(d.firma);
  const id = escaparHtml(limpio(d.id));
  const img = (src: string, clase: string) =>
    `<img class="${clase}" src="${escaparHtml(src)}" width="${LOGO_ACUSE_ANCHO}" height="${LOGO_ACUSE_ALTO}" alt="SynerLink" style="display:block;margin:0 auto;width:${LOGO_ACUSE_ANCHO}px;max-width:${LOGO_ACUSE_ANCHO}px;height:auto;border:0;outline:none;text-decoration:none;">`;
  const logoOscuro = logo && logo.endsWith(LOGO_ACUSE_RUTA) ? logo.replace(/\.png$/, '-blanco.png') : null;
  const marca = logo
    ? img(logo, 'sl-logo-claro') +
      (logoOscuro
        ? `<!--[if !mso]><!-- --><div class="sl-logo-oscuro" style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${img(logoOscuro, '')}</div><!--<![endif]-->`
        : '')
    : `<span style="${FUENTE}font-size:20px;font-weight:600;color:${C.marca};">Syner</span><span style="${FUENTE}font-size:20px;font-weight:600;color:${C.marca2};">Link</span>`;
  const filas = datosTarjeta(d);

  return `<div class="synerlink-acuse" style="margin:0;padding:0;">
${ESTILO_OSCURO}
<table class="sl-fondo" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.fondo}" style="background-color:${C.fondo};border-collapse:collapse;">
<tr><td align="center" style="padding:40px 16px 32px 16px;">
<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">
<tr><td align="center" style="padding:0 0 32px 0;">${marca}</td></tr>
<tr><td class="sl-tinta" align="center" style="padding:0 8px;${FUENTE}font-size:30px;line-height:1.15;font-weight:700;letter-spacing:-0.02em;color:${C.tinta};">${escaparHtml(ACUSE_HTML_TITULO)}</td></tr>
<tr><td class="sl-gris" align="center" style="padding:14px 16px 32px 16px;${FUENTE}font-size:17px;line-height:1.5;color:${C.gris};">A partir de este hilo de correo se registró la siguiente solicitud en SynerLink.</td></tr>
<tr><td>
<table class="sl-tarjeta" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.tarjeta}" style="background-color:${C.tarjeta};border-radius:18px;box-shadow:0 2px 12px rgba(0,0,0,0.06);border-collapse:separate;">
<tr><td style="padding:28px 28px 8px 28px;">
<div class="sl-gris" style="${FUENTE}font-size:13px;line-height:1.4;font-weight:600;letter-spacing:0.02em;color:${C.gris2};">Solicitud</div>
<div class="sl-num" style="${FUENTE}font-size:40px;line-height:1.1;font-weight:700;letter-spacing:-0.02em;color:${C.marca};">#${id}</div>
<div class="sl-tinta" style="padding-top:8px;${FUENTE}font-size:19px;line-height:1.35;font-weight:600;letter-spacing:-0.01em;color:${C.tinta};">${escaparHtml(titulo)}</div>
</td></tr>
${
  filas.length
    ? `<tr><td style="padding:12px 28px 14px 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${filas.map(([k, v], i) => filaDato(k, v, i === 0)).join('\n')}
</table>
</td></tr>`
    : '<tr><td style="padding:0 0 20px 0;font-size:0;line-height:0;">&nbsp;</td></tr>'
}
</table>
</td></tr>
<tr><td align="center" style="padding:32px 0 8px 0;">${boton(href)}</td></tr>
<tr><td class="sl-gris" align="center" style="padding:20px 16px 0 16px;${FUENTE}font-size:15px;line-height:1.55;color:${C.gris};">El seguimiento se hará por SynerLink. Si necesitan agregar información, respondan a este mismo correo y quedará como nota de la solicitud.</td></tr>
<tr><td style="padding:36px 0 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="sl-sep" style="border-top:1px solid #d2d2d7;height:1px;line-height:1px;font-size:0;">&nbsp;</td></tr></table></td></tr>
<tr><td class="sl-gris" align="center" style="padding:18px 16px 0 16px;${FUENTE}font-size:12px;line-height:1.6;color:${C.gris2};">
${firma ? `<span class="sl-tinta" style="color:${C.gris};font-weight:600;">${escaparHtml(firma)}</span><br>` : ''}${escaparHtml(ACUSE_ORGANIZACION)}<br>Mensaje generado desde SynerLink al registrar la solicitud.
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</div>`;
}

/**
 * Documento completo (vista previa y referencia visual). En el envío real se usa el fragmento,
 * insertado dentro del cuerpo del borrador de respuesta, para conservar el historial citado.
 */
export function documentoAcuse(d: DatosAcuseHtml): string {
  return `<!DOCTYPE html>
<html lang="es" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escaparHtml(ACUSE_HTML_TITULO)}</title>
</head>
<body style="margin:0;padding:0;background-color:${C.fondo};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
${fragmentoAcuse(d)}
</body>
</html>`;
}

/**
 * Inserta el acuse ENCIMA del historial citado del borrador (createReply/createReplyAll ya trae el
 * hilo citado en su cuerpo HTML). Conserva todo lo que Outlook puso después.
 */
export function insertarSobreHistorial(cuerpoBorrador: string | null | undefined, fragmento: string): string {
  const cuerpo = String(cuerpoBorrador ?? '');
  const bloque = `${fragmento}\n<br>\n`;
  const m = /<body\b[^>]*>/i.exec(cuerpo);
  if (m) return cuerpo.slice(0, m.index + m[0].length) + '\n' + bloque + cuerpo.slice(m.index + m[0].length);
  return bloque + cuerpo;
}
