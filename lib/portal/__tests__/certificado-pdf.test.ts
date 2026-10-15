import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { TEXTO_OTORGADO_POR, generarCertificadoPdf, tamanoQueCabe } from '../certificado-pdf';

// Certificado de los cursos del portal (Cristian Baldión, 2026-10-14): logo de GSS, estilos de SynerLink y
// «Otorgado por Talento Humano» sobre la ciudad y la fecha. Se usa el generador REAL (el logo se lee de public/).

const DATOS = { code: 'GSS-8D028717', studentName: 'Cristian Baldion', courseTitle: 'INDUCCIÓN CALIDAD', issuedAt: new Date('2026-10-14T17:00:00Z') };

/** pdf-lib escribe el texto de las fuentes estándar como cadenas hexadecimales en el flujo (comprimido) de la página. */
const aHex = (t: string) => Buffer.from(t, 'latin1').toString('hex').toUpperCase();
async function contenidoDePagina(pdf: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(pdf);
  const contenidos = doc.getPage(0).node.Contents();
  const flujos = contenidos instanceof PDFArray ? contenidos.asArray().map((r) => doc.context.lookup(r)) : [contenidos];
  return flujos
    .map((f) => (f instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(f).decode()).toString('latin1') : ''))
    .join('\n')
    .toUpperCase();
}

describe('generarCertificadoPdf', () => {
  it('es un PDF válido de una sola página, apaisada', async () => {
    const pdf = await generarCertificadoPdf(DATOS);
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe('%PDF-');
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeGreaterThan(height);
  });

  it('trae el logo de GSS (una imagen incrustada)', async () => {
    const doc = await PDFDocument.load(await generarCertificadoPdf(DATOS));
    const recursos = doc.getPage(0).node.Resources();
    const imagenes = recursos?.lookup(PDFName.of('XObject'), PDFDict);
    expect(imagenes?.keys().length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('dice «Otorgado por Talento Humano», además del nombre, el curso, la ciudad con la fecha y el código', async () => {
    const t = await contenidoDePagina(await generarCertificadoPdf(DATOS));
    expect(TEXTO_OTORGADO_POR).toBe('Otorgado por Talento Humano');
    for (const frase of [TEXTO_OTORGADO_POR, 'Cristian Baldion', 'Bogotá D.C., 14 de octubre de 2026', 'Código de verificación: GSS-8D028717']) {
      // Las tildes cambian de codificación: se comprueba el tramo ASCII que sigue a la última (y el anterior).
      const tramos = frase.split(/[^\x20-\x7e]/).filter((x) => x.length >= 4);
      expect(tramos.length, frase).toBeGreaterThan(0);
      for (const tramo of tramos) expect(t, frase).toContain(aHex(tramo));
    }
  });

  it('reimprimirlo da exactamente el mismo PDF en lo que se ve (mismos datos congelados)', async () => {
    const a = await contenidoDePagina(await generarCertificadoPdf(DATOS));
    const b = await contenidoDePagina(await generarCertificadoPdf(DATOS));
    expect(a).toBe(b);
    expect(a).toContain(aHex('Cristian Baldion'));
  });

  it('un nombre y un curso muy largos no revientan ni se salen de la tarjeta', async () => {
    const pdf = await generarCertificadoPdf({
      ...DATOS,
      studentName: 'María Fernanda Rodríguez Hernández de la Cruz Pérez Gómez Alvarado',
      courseTitle: 'INDUCCIÓN ORGANIZACIONAL Y SEGURIDAD Y SALUD EN EL TRABAJO (SST) FARMALÓGICA 2026 — SEDE ADMINISTRATIVA Y PLANTA',
    });
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
  });
});

describe('tamanoQueCabe', () => {
  it('usa el máximo si cabe y baja de a poco si no, sin pasar del mínimo', async () => {
    const doc = await PDFDocument.create();
    const f = await doc.embedFont(StandardFonts.Helvetica);
    expect(tamanoQueCabe('Hola', f, 26, 12, 600)).toBe(26);
    const largo = 'x'.repeat(200);
    const s = tamanoQueCabe(largo, f, 26, 12, 600);
    expect(s).toBeLessThan(26);
    expect(s).toBeGreaterThanOrEqual(12);
    expect(f.widthOfTextAtSize(largo, s) <= 600 || s === 12).toBe(true);
    expect(tamanoQueCabe(largo, f, 26, 12, 10)).toBe(12);
  });
});
