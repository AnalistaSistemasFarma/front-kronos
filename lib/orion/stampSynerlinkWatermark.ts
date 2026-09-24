import 'server-only';
import { PDFDocument, rgb, degrees, StandardFonts, type PDFPage, type PDFFont } from 'pdf-lib';

export const SYNERLINK_WATERMARK_LABEL = 'SYNERLINK-VALIDO';
export const SYNERLINK_WATERMARK_PATTERN = 'SYNERLINK · VALIDADO';

const PATTERN_COLOR = rgb(0.72, 0.65, 0.52);
const SEAL_COLOR = rgb(0.42, 0.52, 0.42);

function drawSeal(page: PDFPage, font: PDFFont, cx: number, cy: number, radius: number) {
  // Anillo exterior
  page.drawCircle({
    x: cx,
    y: cy,
    size: radius,
    borderColor: SEAL_COLOR,
    borderWidth: 1.6,
    borderOpacity: 0.9,
    opacity: 0,
  });
  // Anillo interior
  page.drawCircle({
    x: cx,
    y: cy,
    size: radius * 0.86,
    borderColor: SEAL_COLOR,
    borderWidth: 0.9,
    borderOpacity: 0.75,
    opacity: 0,
  });

  // Checkmark (dos segmentos)
  const checkScale = radius * 0.35;
  page.drawLine({
    start: { x: cx - checkScale * 0.55, y: cy + checkScale * 0.55 },
    end: { x: cx - checkScale * 0.1, y: cy + checkScale * 0.15 },
    thickness: 2.2,
    color: SEAL_COLOR,
    opacity: 0.9,
  });
  page.drawLine({
    start: { x: cx - checkScale * 0.1, y: cy + checkScale * 0.15 },
    end: { x: cx + checkScale * 0.65, y: cy + checkScale * 0.85 },
    thickness: 2.2,
    color: SEAL_COLOR,
    opacity: 0.9,
  });

  const titleSize = Math.max(7, radius * 0.22);
  const subSize = Math.max(6, radius * 0.18);
  const title = 'SYNERLINK';
  const sub = 'VALIDADO';
  const titleW = font.widthOfTextAtSize(title, titleSize);
  const subW = font.widthOfTextAtSize(sub, subSize);

  page.drawText(title, {
    x: cx - titleW / 2,
    y: cy - radius * 0.12,
    size: titleSize,
    font,
    color: SEAL_COLOR,
    opacity: 0.92,
  });
  page.drawText(sub, {
    x: cx - subW / 2,
    y: cy - radius * 0.38,
    size: subSize,
    font,
    color: SEAL_COLOR,
    opacity: 0.88,
  });
}

function drawPattern(page: PDFPage, font: PDFFont, width: number, height: number) {
  const size = 9;
  const stepX = 150;
  const stepY = 42;
  const text = SYNERLINK_WATERMARK_PATTERN;

  for (let y = -height; y < height * 2; y += stepY) {
    for (let x = -width; x < width * 2; x += stepX) {
      page.drawText(text, {
        x,
        y,
        size,
        font,
        color: PATTERN_COLOR,
        opacity: 0.18,
        rotate: degrees(-32),
      });
    }
  }
}

/**
 * Estampa patrón diagonal + sello circular SYNERLINK / VALIDADO en todas las páginas.
 */
export async function stampSynerlinkWatermark(
  pdfBytes: ArrayBuffer | Uint8Array | Buffer
): Promise<Uint8Array> {
  const input =
    pdfBytes instanceof Buffer
      ? new Uint8Array(pdfBytes)
      : pdfBytes instanceof ArrayBuffer
        ? new Uint8Array(pdfBytes)
        : pdfBytes;

  const pdf = await PDFDocument.load(input, { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = pdf.getPages();

  for (const page of pages) {
    const { width, height } = page.getSize();
    drawPattern(page, font, width, height);

    const radius = Math.min(width, height) * 0.11;
    const cx = width * 0.5;
    const cy = height * 0.48;
    drawSeal(page, font, cx, cy, Math.max(42, radius));
  }

  return pdf.save();
}
