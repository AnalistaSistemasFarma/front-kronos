/**
 * Plantilla HTML del acuse en el hilo (Nicolás Rivera, 2026-10-15 14:46: «era con una plantilla
 * HTML bien chévere y con los lineamientos, no algo tan plano»).
 *
 * Única fuente del HTML del acuse: la usa el servidor (Graph: createReply(All) → PATCH del cuerpo
 * → send) y la vista previa del navegador (iframe aislado, como el visor del hilo). Módulo PURO.
 *
 * Misma familia visual de los correos de notificación de SynerLink (MBX: logo + título + tabla
 * «etiqueta → valor» + cierre) y de la plantilla GSS del conector de Outlook (templates/default.html):
 * tarjeta de 600 px, solo tablas y estilos en línea (Outlook de escritorio, web y celular), tokens
 * de gss-design (azul #1a3c6e, tinta #0f1a2c/#38445a/#6a7689, línea #d8dde6, fondo #f5f7fa).
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

/** Tokens de gss-design usados en el correo (en línea: los clientes de correo no leen variables CSS). */
const C = {
  azul: '#1a3c6e',
  azul700: '#15315a',
  celeste: '#2e8fd0',
  tinta: '#0f1a2c',
  tinta2: '#38445a',
  tinta3: '#6a7689',
  linea: '#d8dde6',
  fondoSuave: '#f5f7fa',
  fondo: '#eef1f5',
  blanco: '#ffffff',
} as const;
const FUENTE = "font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";

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

/** Logo de SynerLink servido por la propia app (public/logo.png, 817×176), absoluto para el correo. */
export function logoAcuseUrl(base: string | null | undefined): string | null {
  const b = String(base ?? '').trim().replace(/\/+$/, '');
  return b ? urlSegura(`${b}/logo.png`) : null;
}

/** «15 de octubre de 2026» (hora de Colombia). */
export function fechaLarga(v: Date | string | null | undefined): string {
  if (v == null || v === '') return '';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' }).format(d);
}

const limpio = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

function filaDato(etiqueta: string, valor: string): string {
  return `<tr>
<td valign="top" style="padding:6px 12px 6px 0;width:118px;${FUENTE}font-size:13px;line-height:1.4;color:${C.tinta3};">${escaparHtml(etiqueta)}</td>
<td valign="top" style="padding:6px 0;${FUENTE}font-size:14px;line-height:1.4;color:${C.tinta};font-weight:600;">${escaparHtml(valor)}</td>
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

function boton(href: string | null): string {
  const texto = escaparHtml(ACUSE_HTML_BOTON);
  if (!href) return '';
  const h = escaparHtml(href);
  // Botón «a prueba de balas»: VML para Outlook de escritorio (Word), tabla para el resto.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 0 0;">
<tr><td align="left">
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${h}" style="height:44px;v-text-anchor:middle;width:260px;" arcsize="14%" stroke="f" fillcolor="${C.azul}">
<w:anchorlock/><center style="color:#ffffff;font-family:Segoe UI,Arial,sans-serif;font-size:15px;font-weight:bold;">${texto}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-- -->
<a href="${h}" target="_blank" rel="noopener" style="display:inline-block;background-color:${C.azul};color:#ffffff;${FUENTE}font-size:15px;font-weight:700;line-height:44px;padding:0 28px;border-radius:6px;text-decoration:none;mso-hide:all;">${texto}</a>
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
  const cabecera = logo
    ? `<img src="${escaparHtml(logo)}" width="150" height="32" alt="SynerLink" style="display:block;width:150px;max-width:150px;height:auto;border:0;outline:none;text-decoration:none;">`
    : `<span style="${FUENTE}font-size:22px;font-weight:700;color:${C.azul};">Syner</span><span style="${FUENTE}font-size:22px;font-weight:700;color:${C.celeste};">link</span>`;

  return `<div class="synerlink-acuse" style="margin:0;padding:0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.fondo}" style="background-color:${C.fondo};border-collapse:collapse;">
<tr><td align="center" style="padding:20px 12px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.blanco}" style="width:100%;max-width:600px;background-color:${C.blanco};border:1px solid ${C.linea};border-radius:8px;border-collapse:separate;">
<tr><td bgcolor="${C.blanco}" style="padding:20px 28px 16px 28px;background-color:${C.blanco};border-radius:8px 8px 0 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" align="left">${cabecera}</td>
<td valign="middle" align="right" style="${FUENTE}font-size:11px;line-height:1.3;color:${C.tinta3};letter-spacing:0.3px;">${escaparHtml(ACUSE_ORGANIZACION)}</td>
</tr></table>
</td></tr>
<tr><td bgcolor="${C.azul}" style="background-color:${C.azul};height:4px;line-height:4px;font-size:0;mso-line-height-rule:exactly;">&nbsp;</td></tr>
<tr><td style="padding:26px 28px 6px 28px;">
<h1 style="margin:0;${FUENTE}font-size:21px;line-height:1.3;font-weight:700;color:${C.azul};">${escaparHtml(ACUSE_HTML_TITULO)}</h1>
</td></tr>
<tr><td style="padding:8px 28px 18px 28px;${FUENTE}font-size:15px;line-height:1.6;color:${C.tinta2};">
Cordial saludo.<br>Les informamos que, a partir de este hilo de correo, se registró la siguiente solicitud en SynerLink.
</td></tr>
<tr><td style="padding:0 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.fondoSuave}" style="background-color:${C.fondoSuave};border:1px solid ${C.linea};border-left:4px solid ${C.azul};border-radius:6px;border-collapse:separate;">
<tr><td style="padding:16px 18px 6px 18px;">
<div style="${FUENTE}font-size:11px;line-height:1.4;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${C.tinta3};">Solicitud</div>
<div style="${FUENTE}font-size:26px;line-height:1.25;font-weight:700;color:${C.azul};">#${id}</div>
<div style="padding-top:4px;${FUENTE}font-size:16px;line-height:1.4;font-weight:600;color:${C.tinta};">${escaparHtml(titulo)}</div>
</td></tr>
<tr><td style="padding:6px 18px 14px 18px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${C.linea};">
${datosTarjeta(d).map(([k, v]) => filaDato(k, v)).join('\n')}
</table>
</td></tr>
</table>
</td></tr>
<tr><td style="padding:22px 28px 6px 28px;">${boton(href)}</td></tr>
${
  href
    ? `<tr><td style="padding:4px 28px 0 28px;${FUENTE}font-size:12px;line-height:1.5;color:${C.tinta3};">Si el botón no funciona, copie este enlace en su navegador:<br><a href="${escaparHtml(href)}" target="_blank" rel="noopener" style="color:${C.azul};word-break:break-all;">${escaparHtml(href)}</a></td></tr>`
    : ''
}
<tr><td style="padding:18px 28px 4px 28px;${FUENTE}font-size:14px;line-height:1.6;color:${C.tinta2};">
El seguimiento se hará por <strong style="color:${C.tinta};">SynerLink</strong>. Si necesitan agregar información, respondan a este mismo correo y quedará como nota de la solicitud.<br><br>Quedamos atentos.
</td></tr>
<tr><td style="padding:16px 28px 0 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ${C.linea};height:1px;line-height:1px;font-size:0;">&nbsp;</td></tr></table></td></tr>
<tr><td style="padding:14px 28px 22px 28px;${FUENTE}font-size:14px;line-height:1.5;color:${C.tinta2};">
${firma ? `<strong style="color:${C.tinta};">${escaparHtml(firma)}</strong><br>` : ''}${escaparHtml(ACUSE_ORGANIZACION)}
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td align="center" style="padding:12px 16px 0 16px;${FUENTE}font-size:11px;line-height:1.5;color:${C.tinta3};">
${escaparHtml(ACUSE_ORGANIZACION)} · Farmalógica · Laboratorios Ryan · OneLATAM Pharma · Abamia · Meditrack · Kelab<br>Mensaje generado desde SynerLink al registrar la solicitud.
</td></tr>
</table>
</td></tr>
</table>
</div>`;
}

/**
 * Documento completo (vista previa y referencia visual). En el envío real se usa el fragmento,
 * insertado dentro del cuerpo del borrador de respuesta, para conservar el historial citado.
 * Modo oscuro: se declara «solo claro» y todos los fondos van explícitos (bgcolor + estilo), de
 * modo que los clientes que invierten colores mantengan el contraste de la tarjeta.
 */
export function documentoAcuse(d: DatosAcuseHtml): string {
  return `<!DOCTYPE html>
<html lang="es" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
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
