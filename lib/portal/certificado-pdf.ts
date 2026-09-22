/**
 * PORTAL DE TALENTO HUMANO — FORMACIÓN — PDF del certificado.
 *
 * Se genera con `pdf-lib` (ya es dependencia del proyecto — no hace falta
 * Puppeteer ni ninguna otra librería nueva para un documento de una sola
 * página con texto y un logo). Se arma en el servidor, siempre a partir de
 * los datos CONGELADOS en `portal_certificate` — nunca del curso en vivo —
 * así que reimprimirlo da exactamente el mismo PDF cada vez.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';

const AZUL = rgb(0x1a / 255, 0x3c / 255, 0x6e / 255);
const TINTA = rgb(0x0f / 255, 0x1a / 255, 0x2c / 255);
const GRIS = rgb(0x6a / 255, 0x76 / 255, 0x89 / 255);

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

export async function generarCertificadoPdf(datos: DatosCertificado): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  // Carta horizontal (apaisada): es lo que se espera de un certificado, y
  // así cabe holgado el título largo de un curso sin partirlo en dos líneas.
  const pagina = doc.addPage([842, 595]); // A4 apaisado en puntos
  const { width, height } = pagina.getSize();

  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  // Marco decorativo simple, dos líneas anidadas en el azul de marca.
  pagina.drawRectangle({
    x: 24,
    y: 24,
    width: width - 48,
    height: height - 48,
    borderColor: AZUL,
    borderWidth: 3,
  });
  pagina.drawRectangle({
    x: 34,
    y: 34,
    width: width - 68,
    height: height - 68,
    borderColor: AZUL,
    borderWidth: 0.75,
  });

  // Logo de GSS, si está disponible en public/. No revienta el PDF si el
  // archivo llegara a faltar: el certificado sigue siendo válido sin logo.
  try {
    const rutaLogo = path.join(process.cwd(), 'public', 'portal-th', 'logo-gss.png');
    const bytesLogo = await readFile(rutaLogo);
    const logo = await doc.embedPng(bytesLogo);
    const logoAncho = 70;
    const logoAlto = (logo.height / logo.width) * logoAncho;
    pagina.drawImage(logo, {
      x: (width - logoAncho) / 2,
      y: height - 130,
      width: logoAncho,
      height: logoAlto,
    });
  } catch {
    // Sin logo, sin drama — ver comentario arriba.
  }

  let y = height - 175;

  const org = 'GROUP SHARED SERVICES LATINOAMÉRICA';
  pagina.drawText(org, {
    x: centrar(org, bold, 14, width),
    y,
    size: 14,
    font: bold,
    color: AZUL,
  });

  y -= 46;
  const titulo = 'CERTIFICADO DE FINALIZACIÓN';
  pagina.drawText(titulo, {
    x: centrar(titulo, bold, 28, width),
    y,
    size: 28,
    font: bold,
    color: TINTA,
  });

  y -= 46;
  const otorga = 'Se otorga el presente certificado a';
  pagina.drawText(otorga, {
    x: centrar(otorga, regular, 13, width),
    y,
    size: 13,
    font: regular,
    color: GRIS,
  });

  y -= 42;
  const nombreSize = datos.studentName.length > 34 ? 22 : 26;
  pagina.drawText(datos.studentName, {
    x: centrar(datos.studentName, bold, nombreSize, width),
    y,
    size: nombreSize,
    font: bold,
    color: AZUL,
  });

  y -= 36;
  const porHaber = 'por haber completado satisfactoriamente el curso';
  pagina.drawText(porHaber, {
    x: centrar(porHaber, regular, 13, width),
    y,
    size: 13,
    font: regular,
    color: GRIS,
  });

  y -= 34;
  const cursoSize = datos.courseTitle.length > 55 ? 16 : 19;
  pagina.drawText(`"${datos.courseTitle}"`, {
    x: centrar(`"${datos.courseTitle}"`, italic, cursoSize, width),
    y,
    size: cursoSize,
    font: italic,
    color: TINTA,
  });

  const fecha = `Bogotá D.C., ${FORMATO_FECHA.format(datos.issuedAt)}`;
  pagina.drawText(fecha, {
    x: centrar(fecha, regular, 11, width),
    y: 95,
    size: 11,
    font: regular,
    color: GRIS,
  });

  const codigo = `Código de verificación: ${datos.code}`;
  pagina.drawText(codigo, {
    x: centrar(codigo, regular, 10, width),
    y: 70,
    size: 10,
    font: regular,
    color: GRIS,
  });

  return doc.save();
}
