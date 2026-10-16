/**
 * PORTAL DE TALENTO HUMANO — FORMACIÓN — PDF del certificado.
 *
 * Se genera con `pdf-lib` (ya es dependencia del proyecto — no hace falta
 * Puppeteer ni ninguna otra librería nueva para un documento de una sola
 * página con texto y un logo). Se arma en el servidor, siempre a partir de
 * los datos CONGELADOS en `portal_certificate` — nunca del curso en vivo —
 * así que reimprimirlo da exactamente el mismo PDF cada vez.
 *
 * DISEÑO (Cristian Baldión, 2026-10-14): logo de GSS y estilos predeterminados
 * de SynerLink, más la línea «Otorgado por Talento Humano» sobre la ciudad y
 * la fecha.
 *   - El logo de GSS (`public/portal-th/logo-gss.png`) es BLANCO sobre fondo
 *     transparente: sobre el papel blanco no se veía (por eso el certificado
 *     salía «sin logo»). Va sobre una banda del azul de marca (#1a3c6e).
 *   - Colores y tipografía de SynerLink (`lib/theme/tokens.ts`, tema claro): texto
 *     #1a1d21, texto atenuado #5c6370, borde #d8dee6 y acento #2563eb; fuente sans
 *     del sistema (aquí, Helvetica: una fuente estándar del PDF, sin incrustar
 *     ninguna fuente nueva).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';

const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);

/** Azul de marca de GSS (el mismo de la banda del portal de Talento Humano). */
const AZUL_MARCA = hex('#1a3c6e');
/** Tokens del tema claro de SynerLink. */
const TEXTO = hex('#1a1d21');
const TEXTO_ATENUADO = hex('#5c6370');
const BORDE = hex('#d8dee6');
const ACENTO = hex('#2563eb');
const BLANCO = hex('#ffffff');

export const TEXTO_OTORGADO_POR = 'Otorgado por Talento Humano';

export interface DatosCertificado {
  code: string;
  studentName: string;
  courseTitle: string;
  issuedAt: Date;
}

const FORMATO_FECHA = new Intl.DateTimeFormat('es-CO', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'America/Bogota',
});

/** Centra una línea de texto horizontalmente dentro del ancho de la página. */
function centrar(texto: string, font: PDFFont, size: number, anchoPagina: number): number {
  const ancho = font.widthOfTextAtSize(texto, size);
  return (anchoPagina - ancho) / 2;
}

/** El tamaño más grande (hasta `max`) con el que la línea cabe en `anchoMax`, sin bajar de `min`. */
export function tamanoQueCabe(texto: string, font: PDFFont, max: number, min: number, anchoMax: number): number {
  let size = max;
  while (size > min && font.widthOfTextAtSize(texto, size) > anchoMax) size -= 0.5;
  return size;
}

export async function generarCertificadoPdf(datos: DatosCertificado): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  // A4 apaisado: es lo que se espera de un certificado, y así cabe holgado el
  // título largo de un curso sin partirlo en dos líneas.
  const pagina = doc.addPage([842, 595]);
  const { width, height } = pagina.getSize();

  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  // Tarjeta: un solo borde fino (el de SynerLink), con margen para que la
  // impresora no recorte nada.
  const margen = 24;
  const anchoTarjeta = width - margen * 2;
  const altoTarjeta = height - margen * 2;
  pagina.drawRectangle({ x: margen, y: margen, width: anchoTarjeta, height: altoTarjeta, color: BLANCO, borderColor: BORDE, borderWidth: 1 });

  // Banda superior del azul de marca, con el logo de GSS y el nombre de la organización.
  const altoBanda = 118;
  const yBanda = height - margen - altoBanda;
  pagina.drawRectangle({ x: margen, y: yBanda, width: anchoTarjeta, height: altoBanda, color: AZUL_MARCA });

  // El logo es blanco sobre transparente: solo se ve sobre la banda. Si el archivo
  // llegara a faltar, el certificado sigue siendo válido (sin logo).
  try {
    const bytesLogo = await readFile(path.join(process.cwd(), 'public', 'portal-th', 'logo-gss.png'));
    const logo = await doc.embedPng(bytesLogo);
    const logoAlto = 66;
    const logoAncho = (logo.width / logo.height) * logoAlto;
    pagina.drawImage(logo, { x: (width - logoAncho) / 2, y: yBanda + altoBanda - logoAlto - 10, width: logoAncho, height: logoAlto });
  } catch {
    // Sin logo: ver comentario arriba.
  }

  const org = 'GROUP SHARED SERVICES LATINOAMÉRICA';
  pagina.drawText(org, { x: centrar(org, bold, 12, width), y: yBanda + 14, size: 12, font: bold, color: BLANCO });

  let y = yBanda - 62;
  const titulo = 'CERTIFICADO DE FINALIZACIÓN';
  pagina.drawText(titulo, { x: centrar(titulo, bold, 28, width), y, size: 28, font: bold, color: TEXTO });

  // Trazo corto de acento bajo el título.
  y -= 16;
  pagina.drawRectangle({ x: (width - 64) / 2, y, width: 64, height: 3, color: ACENTO });

  y -= 40;
  const otorga = 'Se otorga el presente certificado a';
  pagina.drawText(otorga, { x: centrar(otorga, regular, 13, width), y, size: 13, font: regular, color: TEXTO_ATENUADO });

  y -= 42;
  // Lo que pueda ser largo (nombre y curso) se achica para quedar dentro de la tarjeta, con aire a los lados.
  const anchoTexto = anchoTarjeta - 120;
  const nombreSize = tamanoQueCabe(datos.studentName, bold, 26, 12, anchoTexto);
  pagina.drawText(datos.studentName, { x: centrar(datos.studentName, bold, nombreSize, width), y, size: nombreSize, font: bold, color: AZUL_MARCA });

  y -= 34;
  const porHaber = 'por haber completado satisfactoriamente el curso';
  pagina.drawText(porHaber, { x: centrar(porHaber, regular, 13, width), y, size: 13, font: regular, color: TEXTO_ATENUADO });

  y -= 34;
  const curso = `"${datos.courseTitle}"`;
  const cursoSize = tamanoQueCabe(curso, italic, 19, 10, anchoTexto);
  pagina.drawText(curso, { x: centrar(curso, italic, cursoSize, width), y, size: cursoSize, font: italic, color: TEXTO });

  // Pie: filete, «Otorgado por Talento Humano» y, debajo, la ciudad con la fecha y el código.
  pagina.drawLine({ start: { x: margen + 60, y: 130 }, end: { x: width - margen - 60, y: 130 }, thickness: 0.75, color: BORDE });

  pagina.drawText(TEXTO_OTORGADO_POR, { x: centrar(TEXTO_OTORGADO_POR, bold, 13, width), y: 106, size: 13, font: bold, color: AZUL_MARCA });

  const fecha = `Bogotá D.C., ${FORMATO_FECHA.format(datos.issuedAt)}`;
  pagina.drawText(fecha, { x: centrar(fecha, regular, 11, width), y: 86, size: 11, font: regular, color: TEXTO_ATENUADO });

  const codigoVerificacion = `Código de verificación: ${datos.code}`;
  pagina.drawText(codigoVerificacion, { x: centrar(codigoVerificacion, regular, 10, width), y: 62, size: 10, font: regular, color: TEXTO_ATENUADO });

  return doc.save();
}
