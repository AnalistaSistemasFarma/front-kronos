import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import type { OrionAnnotationFont, OrionDocumentAnnotation } from './types';
import { fitText, formatValidatorDate, safeText } from './validatorStamp';
import { viewedPageSize, visualBlToDrawImage } from './pageRotation';

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

/** Caja en coords visuales (pdf.js /Rotate), origen abajo-izquierda. */
function boxOnPage(page: PDFPage, a: OrionDocumentAnnotation) {
  const { width: mw, height: mh } = page.getSize();
  const pageRotate = page.getRotation().angle;
  const { width: vw, height: vh } = viewedPageSize(mw, mh, pageRotate);
  const bw = (a.width / 100) * vw;
  const bh = (a.height / 100) * vh;
  return {
    bx: (a.x / 100) * vw,
    by: vh - (a.y / 100) * vh - bh,
    bw,
    bh,
    mw,
    mh,
    pageRotate,
  };
}

/** Línea base respecto al borde de arriba (igual que se ve en pantalla con line-height 1). */
const TEXT_BASELINE_RATIO = 0.85;

const STANDARD_FONT: Record<OrionAnnotationFont, { regular: StandardFonts; bold: StandardFonts }> = {
  helvetica: { regular: StandardFonts.Helvetica, bold: StandardFonts.HelveticaBold },
  times: { regular: StandardFonts.TimesRoman, bold: StandardFonts.TimesRomanBold },
  courier: { regular: StandardFonts.Courier, bold: StandardFonts.CourierBold },
};

function drawVisualText(
  page: PDFPage,
  left: number,
  bottom: number,
  text: string,
  size: number,
  font: PDFFont,
  color: ReturnType<typeof rgb>,
  mw: number,
  mh: number,
  pageRotate: number
) {
  const box = visualBlToDrawImage(left, bottom, 1, 1, mw, mh, pageRotate);
  page.drawText(text, {
    x: box.x,
    y: box.y,
    size,
    font,
    color,
    rotate: degrees(box.rotate),
  });
}

/** Texto con letra y tamaño elegidos: sale tal cual, desde la esquina de arriba de la caja. */
function drawStyledText(page: PDFPage, a: OrionDocumentAnnotation, font: PDFFont) {
  const { bx, by, bw, bh, mw, mh, pageRotate } = boxOnPage(page, a);
  const size = Number(a.fontSize);
  const text = safeText(font, String(a.text || ''));
  const value = fitText(font, text, size, Math.max(1, bw));
  const top = by + bh;
  drawVisualText(
    page,
    bx,
    top - size * TEXT_BASELINE_RATIO,
    value,
    size,
    font,
    TEXT,
    mw,
    mh,
    pageRotate
  );
}

function drawTextAnnotation(page: PDFPage, a: OrionDocumentAnnotation, fonts: { regular: PDFFont; bold: PDFFont }) {
  const { bx, by, bw, bh, mw, mh, pageRotate } = boxOnPage(page, a);
  const withCaption = bh >= CAPTION_SIZE + MIN_TEXT_SIZE + 3;
  const captionSpace = withCaption ? CAPTION_SIZE + 1.5 : 0;
  const text = safeText(fonts.bold, String(a.text || ''));
  const size = fitTextSize(fonts.bold, text, Math.max(1, bw), Math.max(1, bh - captionSpace));
  const value = fitText(fonts.bold, text, size, Math.max(1, bw));
  const textY = by + captionSpace + Math.max(0, (bh - captionSpace - size) / 2) + size * 0.15;
  drawVisualText(page, bx, textY, value, size, fonts.bold, TEXT, mw, mh, pageRotate);
  if (withCaption) {
    const caption = fitText(fonts.regular, annotationCaption(a), CAPTION_SIZE, Math.max(1, bw));
    drawVisualText(page, bx, by + 0.5, caption, CAPTION_SIZE, fonts.regular, MUTED, mw, mh, pageRotate);
  }
}

function drawSealAnnotation(page: PDFPage, a: OrionDocumentAnnotation, image: PDFImage, font: PDFFont) {
  const { bx, by, bw, bh, mw, mh, pageRotate } = boxOnPage(page, a);
  const withCaption = bh >= 24;
  const captionSpace = withCaption ? CAPTION_SIZE + 1.5 : 0;
  const scale = Math.min(bw / image.width, (bh - captionSpace) / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  const left = bx + (bw - w) / 2;
  const bottom = by + captionSpace + (bh - captionSpace - h) / 2;
  const box = visualBlToDrawImage(left, bottom, w, h, mw, mh, pageRotate);
  page.drawImage(image, {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    rotate: degrees(box.rotate),
  });
  if (withCaption) {
    const caption = fitText(font, annotationCaption(a), CAPTION_SIZE, Math.max(1, bw));
    drawVisualText(page, bx, by + 0.5, caption, CAPTION_SIZE, font, MUTED, mw, mh, pageRotate);
  }
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
  const styledFonts = new Map<StandardFonts, PDFFont>();
  const styledFont = async (a: OrionDocumentAnnotation) => {
    const family = STANDARD_FONT[a.fontFamily ?? 'helvetica'] ?? STANDARD_FONT.helvetica;
    const name = a.bold ? family.bold : family.regular;
    if (!styledFonts.has(name)) styledFonts.set(name, await pdf.embedFont(name));
    return styledFonts.get(name)!;
  };

  for (const a of annotations) {
    const page = pages[a.page - 1];
    if (!page) continue;
    if (a.kind === 'text') {
      if (!String(a.text || '').trim()) continue;
      if (a.fontSize) drawStyledText(page, a, await styledFont(a));
      else drawTextAnnotation(page, a, { regular, bold });
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
