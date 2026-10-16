/**
 * Muestras SINTÉTICAS de HTML de correo (nada de correos reales), con la forma típica que mandan
 * Outlook, Gmail y un boletín con `<style>`. Las usan las pruebas unitarias del saneado y la e2e.
 */

/** Respuesta de Outlook (Word como motor): tabla con estilos en línea, encabezado con fondo, fila resaltada e historial. */
export const OUTLOOK_RESPUESTA = `<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><meta name="Generator" content="Microsoft Word 15 (filtered medium)">
<style><!--
/* Font Definitions */
@font-face {font-family:"Cambria Math"; panose-1:2 4 5 3 5 4 6 3 2 4;}
p.MsoNormal, li.MsoNormal, div.MsoNormal {margin:0cm; font-size:11.0pt; font-family:"Aptos",sans-serif; mso-fareast-language:EN-US;}
a:link, span.MsoHyperlink {mso-style-priority:99; color:#467886; text-decoration:underline;}
@page WordSection1 {size:612.0pt 792.0pt; margin:70.85pt 3.0cm 70.85pt 3.0cm;}
div.WordSection1 {page:WordSection1;}
--></style><!--[if gte mso 9]><xml><o:shapedefaults v:ext="edit" spidmax="1026" /></xml><![endif]-->
</head>
<body lang="ES-CO" link="#467886" vlink="#96607D" style="word-wrap:break-word">
<div class="WordSection1">
<p class="MsoNormal">Buenas tardes,<o:p></o:p></p>
<p class="MsoNormal"><o:p>&nbsp;</o:p></p>
<p class="MsoNormal">Comparto el estado de la revisión de los agentes de prueba:<o:p></o:p></p>
<table class="MsoTableGrid" border="1" cellspacing="0" cellpadding="0" width="600" style="width:450.0pt;border-collapse:collapse;border:none;mso-border-alt:solid windowtext .5pt;mso-yfti-tbllook:1184">
<tr style="mso-yfti-irow:0;mso-yfti-firstrow:yes">
<td width="200" valign="top" style="width:150.0pt;border:solid #1F3864 1.0pt;background:#1F3864;padding:4.0pt 6.0pt 4.0pt 6.0pt"><p class="MsoNormal"><b><span style="color:white;mso-themecolor:background1">Agente</span></b><o:p></o:p></p></td>
<td width="200" valign="top" style="width:150.0pt;border:solid #1F3864 1.0pt;border-left:none;background:#1F3864;padding:4.0pt 6.0pt 4.0pt 6.0pt"><p class="MsoNormal"><b><span style="color:white">Servidor</span></b></p></td>
<td width="200" valign="top" style="width:150.0pt;border:solid #1F3864 1.0pt;border-left:none;background:#1F3864;padding:4.0pt 6.0pt 4.0pt 6.0pt"><p class="MsoNormal"><b><span style="color:white">Estado</span></b></p></td>
</tr>
<tr>
<td style="border:solid #8EAADB 1.0pt;border-top:none;padding:4.0pt 6.0pt"><p class="MsoNormal">Agente de prueba A</p></td>
<td style="border-top:none;border-left:none;border-bottom:solid #8EAADB 1.0pt;border-right:solid #8EAADB 1.0pt;padding:4.0pt 6.0pt"><p class="MsoNormal">servidor-ejemplo-01</p></td>
<td style="border-top:none;border-left:none;border-bottom:solid #8EAADB 1.0pt;border-right:solid #8EAADB 1.0pt;padding:4.0pt 6.0pt"><p class="MsoNormal">Conectado</p></td>
</tr>
<tr>
<td style="border:solid #8EAADB 1.0pt;border-top:none;background:#FFF2CC;mso-shading:white;padding:4.0pt 6.0pt"><p class="MsoNormal"><b>Agente de prueba B</b></p></td>
<td style="border-top:none;border-left:none;border-bottom:solid #8EAADB 1.0pt;border-right:solid #8EAADB 1.0pt;background:#FFF2CC;padding:4.0pt 6.0pt"><p class="MsoNormal">servidor-ejemplo-02</p></td>
<td style="border-top:none;border-left:none;border-bottom:solid #8EAADB 1.0pt;border-right:solid #8EAADB 1.0pt;background:#FFF2CC;padding:4.0pt 6.0pt"><p class="MsoNormal"><span style="color:#C00000">Pendiente</span></p></td>
</tr>
</table>
<!--[if mso]><v:rect style="width:1pt;height:1pt" fill="true"><v:fill color="#ff0000"/></v:rect><![endif]-->
<p class="MsoNormal"><o:p>&nbsp;</o:p></p>
<div style="border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0cm 0cm 0cm">
<div id="divRplyFwdMsg"><p class="MsoNormal"><b>De:</b> Persona de Ejemplo &lt;persona@ejemplo.com&gt;<br><b>Enviado:</b> jueves, 15 de octubre de 2026 10:00<br><b>Asunto:</b> Prueba de tablas</p></div>
</div>
<p class="MsoNormal">Mensaje anterior de ejemplo.</p>
</div>
</body></html>`;

/** Gmail: divs con dir, fuente, cita gmail_quote y tabla sencilla con bgcolor. */
export const GMAIL = `<div dir="ltr"><div style="font-family:arial,sans-serif;font-size:small;color:#222222">Hola equipo,</div>
<div><br></div>
<table cellpadding="6" style="border-collapse:collapse;border:1px solid #cccccc"><tbody>
<tr><th bgcolor="#e8f0fe" align="left" style="border:1px solid #cccccc">Tarea</th><th bgcolor="#e8f0fe" style="border:1px solid #cccccc">Fecha</th></tr>
<tr><td style="border:1px solid #cccccc">Revisión</td><td style="border:1px solid #cccccc">2026-10-16</td></tr>
</tbody></table>
<font face="verdana, sans-serif" color="#0b5394" size="2">Firma de ejemplo</font>
<div class="gmail_quote"><div dir="ltr" class="gmail_attr">El jue, 15 oct 2026 a las 9:00, Ejemplo (&lt;ejemplo@ejemplo.com&gt;) escribió:<br></div>
<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">Mensaje citado de ejemplo.</blockquote></div></div>`;

/** Boletín con <style> en el <head>, @media, @import, fondo remoto y estilos por clase. */
export const BOLETIN = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width">
<style type="text/css">
@import url("https://fuentes.ejemplo.com/a.css");
body { background-color:#eef2f7; margin:0; }
.contenedor { max-width:600px; background:#ffffff; border-radius:8px; }
.cabecera td { background:#0b3d91 url("https://cdn.ejemplo.com/fondo.png") no-repeat; color:#ffffff; padding:16px; }
.boton { display:inline-block; background-color:#f59e0b; color:#111111; padding:10px 18px; position:fixed; }
.malo { width: expression(alert(1)); behavior:url(x.htc); -moz-binding:url("x.xml#x"); }
#bodyTable > tbody td { font-family: 'Segoe UI', Arial, sans-serif; }
@media only screen and (max-width: 480px) { .contenedor { width:100% !important; } }
@font-face { font-family:Ejemplo; src:url("https://fuentes.ejemplo.com/e.woff"); }
</style></head>
<body><table id="bodyTable" class="contenedor" width="100%" align="center" role="presentation"><tbody>
<tr class="cabecera"><td>Boletín de ejemplo</td></tr>
<tr><td background="https://cdn.ejemplo.com/textura.png" bgcolor="#fafafa">Contenido <a class="boton" href="https://www.ejemplo.com/leer">Leer más</a></td></tr>
</tbody></table></body></html>`;

/** Intentos de XSS que el saneado debe neutralizar. */
export const XSS = {
  onerror: '<img src="x" onerror="alert(1)" alt="foto"><p onmouseover="alert(2)" style="color:red">texto</p>',
  hrefJs: '<a href="javascript:alert(1)">uno</a><a href="  JaVaScRiPt:alert(1)">dos</a><a href="jav&#x09;ascript:alert(1)">tres</a>',
  cssExpression: '<div style="width:expression(alert(1));color:blue">a</div><div style="background:url(javascript:alert(1))">b</div><div style="color:red;behavior:url(x.htc);-moz-binding:url(x)">c</div><div style="w\\idth:exp\\72 ession(alert(1))">d</div><div style="xss:ex/**/pression(alert(1));width:ex/**/pression(1)">e</div>',
  svgScript: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle onload="alert(2)"/></svg><img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+"><p>después</p>',
  metaRefresh: '<meta http-equiv="refresh" content="0;url=https://malo.ejemplo.com"><base href="https://malo.ejemplo.com/"><link rel="stylesheet" href="https://malo.ejemplo.com/x.css"><p>hola</p>',
  styleBlock: '<style>p{color:red}</style><style>@import "https://malo.ejemplo.com/x.css"; .a{background:url(https://malo.ejemplo.com/rastreo.gif)} .b{position:absolute;top:0} .c{color:\\72 ed}</style><style>.d{color:green}</style><p class="a b d">x</p>',
  posicion: '<div style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;background:#fff">tapa</div><div style="position:absolute">b</div><div style="position:relative">c</div>',
  cierreEstilo: '<style>p{font-family:"</style><img src=x onerror=alert(1)>"}</style><p>fin</p>',
};
