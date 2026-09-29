import 'server-only';
import { PDFDocument, rgb, degrees, StandardFonts, type PDFPage, type PDFFont } from 'pdf-lib';

export const SYNERLINK_WATERMARK_LABEL = 'SYNERLINK-VALIDO';
export const SYNERLINK_WATERMARK_PATTERN = 'SYNERLINK · VALIDADO';

const PATTERN_COLOR = rgb(0.72, 0.65, 0.52);
const SEAL_COLOR = rgb(0.42, 0.52, 0.42);

function drawSeal(page: PDFPage, font: PDFFont, cx: number, cy: number, radius: number) {
  page.drawCircle({
    x: cx,
    y: cy,
    size: radius,
    borderColor: SEAL_COLOR,
    borderWidth: 1.6,
    borderOpacity: 0.9,
    opacity: 0,
  });
  page.drawCircle({
    x: cx,
    y: cy,
    size: radius * 0.86,
    borderColor: SEAL_COLOR,
    borderWidth: 0.9,
    borderOpacity: 0.75,
    opacity: 0,
  });

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

/** Caja en % de la página, origen arriba-izquierda; `page` 0 = última página. */
export type SealAvoidBox = { page: number; x: number; y: number; width: number; height: number };

type Rect = { x0: number; y0: number; x1: number; y1: number };

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Posición del sello en la última hoja sin tapar firmas ni validadores: prueba esquinas
 * y bordes, achicando el sello si hace falta; si nada queda libre, la de menor choque.
 */
export function pickSealPlacement(
  width: number,
  height: number,
  obstacles: Rect[]
): { cx: number; cy: number; radius: number } {
  const base = Math.max(30, Math.min(width, height) * 0.065);
  const pad = 4;
  let best: { cx: number; cy: number; radius: number; overlap: number } | null = null;

  for (const radius of [base, base * 0.8, Math.max(24, base * 0.65)]) {
    const m = radius + 18;
    const candidates = [
      [width - m, m],
      [m, m],
      [width / 2, m],
      [width - m, height - m],
      [m, height - m],
      [width - m, height / 2],
      [m, height / 2],
    ];
    for (const [cx, cy] of candidates) {
      const seal = { x0: cx - radius - pad, y0: cy - radius - pad, x1: cx + radius + pad, y1: cy + radius + pad };
      const overlap = obstacles.reduce((sum, o) => sum + overlapArea(seal, o), 0);
      if (overlap === 0) return { cx, cy, radius };
      if (!best || overlap < best.overlap) best = { cx, cy, radius, overlap };
    }
  }
  return best!;
}

/**
 * Estampa patrón diagonal SYNERLINK · VALIDADO en todas las páginas
 * y el sello circular en la última hoja, en un hueco libre de `avoid`.
 */
export async function stampSynerlinkWatermark(
  pdfBytes: ArrayBuffer | Uint8Array | Buffer,
  avoid: SealAvoidBox[] = []
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
  }

  const last = pages[pages.length - 1];
  if (last) {
    const { width, height } = last.getSize();
    // pdf-lib: origen abajo-izquierda; las cajas vienen en % desde arriba-izquierda.
    const obstacles = avoid
      .filter((b) => b.page <= 0 || b.page >= pages.length)
      .map((b) => ({
        x0: (b.x / 100) * width,
        x1: ((b.x + b.width) / 100) * width,
        y0: height - ((b.y + b.height) / 100) * height,
        y1: height - (b.y / 100) * height,
      }));
    const { cx, cy, radius } = pickSealPlacement(width, height, obstacles);
    drawSeal(last, font, cx, cy, radius);
  }

  return pdf.save();
}
