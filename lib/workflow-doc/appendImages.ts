import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * «Anexar las imágenes de la solicitud» (2026-11-26; Calidad OLP: el informe de auditoría con imágenes): agrega al PDF
 * generado un anexo con las fotos adjuntas de la solicitud (JPG y PNG), una por página A4 con su nombre.
 */
export const MAX_IMAGES = 30;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const isAppendableImage = (name: string) => /\.(jpe?g|png)$/i.test(name);

export async function appendImagesToPdf(pdfBytes: Uint8Array, images: { name: string; bytes: Uint8Array }[]): Promise<Uint8Array> {
  const usable = images.filter((i) => isAppendableImage(i.name) && i.bytes.byteLength > 0 && i.bytes.byteLength <= MAX_IMAGE_BYTES).slice(0, MAX_IMAGES);
  if (!usable.length) return pdfBytes;
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [W, H] = [595.28, 841.89];
  const M = 40;
  let n = 0;
  for (const img of usable) {
    let embedded;
    try {
      embedded = /\.png$/i.test(img.name) ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
    } catch {
      continue; // a corrupt image does not break the report
    }
    n++;
    const page = doc.addPage([W, H]);
    page.drawText(`Anexo · Imagen ${n}`, { x: M, y: H - M - 12, size: 12, font: bold, color: rgb(0, 0.37, 0.66) });
    // Standard fonts only support WinAnsi: drop characters outside it from the file name.
    const caption = img.name.replace(/[^\x20-\x7E -ÿ]/g, '?').slice(0, 110);
    page.drawText(caption, { x: M, y: H - M - 28, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
    const boxW = W - 2 * M;
    const boxH = H - 2 * M - 50;
    const scale = Math.min(boxW / embedded.width, boxH / embedded.height, 1);
    const w = embedded.width * scale;
    const h = embedded.height * scale;
    page.drawImage(embedded, { x: (W - w) / 2, y: H - M - 45 - h, width: w, height: h });
  }
  return n ? doc.save() : pdfBytes;
}
