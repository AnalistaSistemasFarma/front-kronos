import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import type { OrionDocumentAnnotation } from './types';
import { fitText, formatValidatorDate, safeText } from './validatorStamp';

const TEXT = rgb(0.05, 0.08, 0.15);
const MUTED = rgb(0.4, 0.44, 0.5);
const MAX_TEXT_SIZE = 11;
const MIN_TEXT_SIZE = 4;
const CAPTION_SIZE = 3.6;

export type SealImageBytes = { bytes: Uint8Array; mime: string };

/** Quién lo agregó (o lo cambió por última vez) y cuándo, en hora de Colombia. */
export function annotationCaption(a: OrionDocumentAnnotation): string {
  const who = a.updatedByName || a.updatedByEmail || a.createdByName || a.createdByEmail;
  const when = formatValidatorDate(a.updatedAt || a.createdAt);
  // El sello se ubica al preparar (o después); los datos de texto, después de firmar.
  const prefix = a.kind === 'seal' ? 'Sello ubicado por' : 'Agregado tras firmar ·';
  return `${prefix} ${who}${when ? ` · ${when}` : ''}`;
}

/** Tamaño de letra que cabe en la caja (alto y ancho). */
export function fitTextSize(font: PDFFont, text: string, maxWidth: number, maxHeight: number): number {
  let size = Math.max(MIN_TEXT_SIZE, Math.min(MAX_TEXT_SIZE, maxHeight * 0.8));
  while (size > MIN_TEXT_SIZE && font.widthOfTextAtSize(text, size) > maxWidth) {
    size -= 0.25;
  }
  return size;
}

function boxOnPage(page: PDFPage, a: OrionDocumentAnnotation) {
  const { width: pw, height: ph } = page.getSize();
  const bw = (a.width / 100) * pw;
  const bh = (a.height / 100) * ph;
  return { bx: (a.x / 100) * pw, by: ph - (a.y / 100) * ph - bh, bw, bh };
}

function drawCaption(page: PDFPage, font: PDFFont, a: OrionDocumentAnnotation, bx: number, by: number, bw: number) {
  const caption = fitText(font, annotationCaption(a), CAPTION_SIZE, Math.max(1, bw));
  page.drawText(caption, { x: bx, y: by + 0.5, size: CAPTION_SIZE, font, color: MUTED });
}

function drawTextAnnotation(page: PDFPage, a: OrionDocumentAnnotation, fonts: { regular: PDFFont; bold: PDFFont }) {
  const { bx, by, bw, bh } = boxOnPage(page, a);
  // La leyenda va dentro de la caja solo si queda espacio para el valor.
  const withCaption = bh >= CAPTION_SIZE + MIN_TEXT_SIZE + 3;
  const captionSpace = withCaption ? CAPTION_SIZE + 1.5 : 0;
  const text = safeText(fonts.bold, String(a.text || ''));
  const size = fitTextSize(fonts.bold, text, Math.max(1, bw), Math.max(1, bh - captionSpace));
  const value = fitText(fonts.bold, text, size, Math.max(1, bw));
  const textY = by + captionSpace + Math.max(0, (bh - captionSpace - size) / 2) + size * 0.15;
  page.drawText(value, { x: bx, y: textY, size, font: fonts.bold, color: TEXT });
  if (withCaption) drawCaption(page, fonts.regular, a, bx, by, bw);
}

function drawSealAnnotation(page: PDFPage, a: OrionDocumentAnnotation, image: PDFImage, font: PDFFont) {
  const { bx, by, bw, bh } = boxOnPage(page, a);
  const withCaption = bh >= 24;
  const captionSpace = withCaption ? CAPTION_SIZE + 1.5 : 0;
  const scale = Math.min(bw / image.width, (bh - captionSpace) / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  page.drawImage(image, {
    x: bx + (bw - w) / 2,
    y: by + captionSpace + (bh - captionSpace - h) / 2,
    width: w,
    height: h,
  });
  if (withCaption) drawCaption(page, font, a, bx, by, bw);
}

/**
 * Estampa los datos y sellos agregados después de firmar. Un sello sin imagen disponible
 * se omite; una página inexistente se ignora.
 */
export async function stampAnnotations(
  pdfBytes: Uint8Array,
  annotations: OrionDocumentAnnotation[],
  seals: Record<string, SealImageBytes | null | undefined> = {}
): Promise<Uint8Array> {
  if (annotations.length === 0) return pdfBytes;
  const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = pdf.getPages();
  if (pages.length === 0) return pdfBytes;
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const embedded = new Map<string, PDFImage | null>();

  for (const a of annotations) {
    const page = pages[a.page - 1];
    if (!page) continue;
    if (a.kind === 'text') {
      if (String(a.text || '').trim()) drawTextAnnotation(page, a, { regular, bold });
      continue;
    }
    const itemId = String(a.sealItemId || '');
    if (!embedded.has(itemId)) {
      const seal = seals[itemId];
      let image: PDFImage | null = null;
      if (seal) {
        try {
          image = /png/i.test(seal.mime) ? await pdf.embedPng(seal.bytes) : await pdf.embedJpg(seal.bytes);
        } catch {
          image = null;
        }
      }
      embedded.set(itemId, image);
    }
    const image = embedded.get(itemId);
    if (image) drawSealAnnotation(page, a, image, regular);
  }

  return pdf.save();
}
