import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import type { OrionSignatureState } from './types';

const GREEN = rgb(0.05, 0.55, 0.36);
const TEXT = rgb(0.13, 0.16, 0.2);
const MUTED = rgb(0.4, 0.44, 0.5);

export type ValidatorMark = {
  email: string;
  name: string;
  order: number;
  decidedAt?: string | null;
  /**
   * % de la página, origen arriba-izquierda (igual que las cajas de firma).
   * `page` 0 = última página del PDF.
   */
  field: { page: number; x: number; y: number; width: number; height: number };
};

const AUTO_WIDTH = 11;
const AUTO_HEIGHT = 4;
const AUTO_MARGIN = 4;
const AUTO_GAP = 1;

function normalizeEmail(email?: string | null): string {
  return String(email || '').trim().toLowerCase();
}

/** Validador sin caja ubicada: fila en la esquina inferior derecha de la última página. */
function autoField(index: number): ValidatorMark['field'] {
  const perRow = Math.max(
    1,
    Math.floor((100 - AUTO_MARGIN * 2 + AUTO_GAP) / (AUTO_WIDTH + AUTO_GAP))
  );
  const col = index % perRow;
  const row = Math.floor(index / perRow);
  return {
    page: 0,
    x: 100 - AUTO_MARGIN - AUTO_WIDTH - col * (AUTO_WIDTH + AUTO_GAP),
    y: 100 - AUTO_MARGIN - AUTO_HEIGHT - row * (AUTO_HEIGHT + AUTO_GAP),
    width: AUTO_WIDTH,
    height: AUTO_HEIGHT,
  };
}

/**
 * Validadores que aprobaron. La caja se asocia por correo (sobrevive a cambios de
 * orden entre rondas) y, si no, por orden; sin caja se ubica automáticamente.
 */
export function buildValidatorMarks(state: OrionSignatureState): ValidatorMark[] {
  const review = state.review;
  if (!review || review.status !== 'APROBADO') return [];
  const fields = state.validatorFields ?? [];
  let autoIndex = 0;
  return [...review.approvals]
    .filter((a) => a.decision === 'APROBADO' && a.email)
    .sort((a, b) => a.order - b.order)
    .map((a) => {
      const email = normalizeEmail(a.email);
      const placed =
        fields.find((f) => normalizeEmail(f.validatorEmail) === email) ??
        fields.find((f) => !f.validatorEmail && f.signerOrder === 900 + a.order);
      return {
        email,
        name: a.name || a.email,
        order: a.order,
        decidedAt: a.decidedAt ?? null,
        field: placed
          ? {
              page: placed.page,
              x: placed.x,
              y: placed.y,
              width: placed.width,
              height: placed.height,
            }
          : autoField(autoIndex++),
      };
    });
}

/** WinAnsi (fuente estándar) no admite todos los caracteres; se sustituyen los no soportados. */
function safeText(font: PDFFont, value: string): string {
  let out = '';
  for (const ch of value.normalize('NFC')) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '') || '?';
    }
  }
  return out;
}

function fitText(font: PDFFont, value: string, size: number, maxWidth: number): string {
  let text = safeText(font, value);
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  while (text.length > 1 && font.widthOfTextAtSize(`${text}...`, size) > maxWidth) {
    text = text.slice(0, -1);
  }
  return `${text.trimEnd()}...`;
}

/** Check dibujado con líneas: la fuente estándar no trae el carácter ✓. */
function drawCheck(page: PDFPage, x: number, y: number, size: number) {
  const stroke = Math.max(0.8, size * 0.12);
  page.drawCircle({ x: x + size / 2, y: y + size / 2, size: size / 2, color: GREEN });
  page.drawLine({
    start: { x: x + size * 0.26, y: y + size * 0.52 },
    end: { x: x + size * 0.44, y: y + size * 0.32 },
    thickness: stroke,
    color: rgb(1, 1, 1),
  });
  page.drawLine({
    start: { x: x + size * 0.44, y: y + size * 0.32 },
    end: { x: x + size * 0.76, y: y + size * 0.7 },
    thickness: stroke,
    color: rgb(1, 1, 1),
  });
}

/** `decidedAt` es ISO en UTC real; se muestra en hora de Colombia sin depender del servidor. */
export function formatValidatorDate(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Bogota',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

async function embedDataUrl(pdf: PDFDocument, dataUrl: string): Promise<PDFImage | null> {
  const match = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  const bytes = Buffer.from(match[2]!, 'base64');
  try {
    return match[1]!.toLowerCase() === 'png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  } catch {
    return null;
  }
}

/**
 * Estampa el visto bueno de cada validador en su caja: chulito verde o, si se pasa
 * `signatures` (versión final), su firma guardada en pequeño. Debajo, nombre y fecha.
 */
export async function stampValidatorMarks(
  pdfBytes: Uint8Array,
  marks: ValidatorMark[],
  signatures?: Record<string, string | null | undefined>
): Promise<Uint8Array> {
  if (marks.length === 0) return pdfBytes;
  const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pages = pdf.getPages();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let stamped = false;

  for (const mark of marks) {
    const page = mark.field.page > 0 ? pages[mark.field.page - 1] : pages[pages.length - 1];
    if (!page) continue;
    const { width: pw, height: ph } = page.getSize();
    const bw = (mark.field.width / 100) * pw;
    const bh = (mark.field.height / 100) * ph;
    const bx = (mark.field.x / 100) * pw;
    const by = ph - (mark.field.y / 100) * ph - bh;

    // Visto bueno discreto: tamaños acotados aunque la caja sea grande.
    const nameSize = Math.min(5.5, Math.max(3.5, bh * 0.14));
    const dateSize = Math.max(3, nameSize - 1.3);
    // Caja muy pequeña: sin nombre ni fecha, el chulito/firma ocupa toda la caja.
    const withText = bh >= nameSize + dateSize + 8 && bw >= 24;
    const textHeight = withText ? nameSize + dateSize + 2 : 0;
    const graphicHeight = withText ? Math.min(16, Math.max(4, bh - textHeight - 2)) : Math.max(1, bh - 1);
    const graphicTop = withText ? by + textHeight + graphicHeight + 1 : by + bh - 0.5;

    const dataUrl = signatures?.[mark.email];
    const image = dataUrl ? await embedDataUrl(pdf, dataUrl) : null;
    if (image) {
      const scale = Math.min(Math.max(1, bw - 2) / image.width, graphicHeight / image.height);
      const w = image.width * scale;
      const h = image.height * scale;
      page.drawImage(image, { x: bx + (bw - w) / 2, y: graphicTop - h, width: w, height: h });
    } else {
      const size = withText ? Math.min(graphicHeight, bw * 0.3, 8) : Math.min(graphicHeight, bw - 1, 8);
      drawCheck(page, bx + (bw - size) / 2, graphicTop - size - (graphicHeight - size) / 2, size);
    }
    if (!withText) {
      stamped = true;
      continue;
    }

    const maxWidth = bw - 2;
    const name = fitText(bold, mark.name, nameSize, maxWidth);
    page.drawText(name, {
      x: bx + (bw - bold.widthOfTextAtSize(name, nameSize)) / 2,
      y: by + dateSize + 2,
      size: nameSize,
      font: bold,
      color: TEXT,
    });
    const date = formatValidatorDate(mark.decidedAt);
    if (date) {
      const text = fitText(font, `Validó ${date}`, dateSize, maxWidth);
      page.drawText(text, {
        x: bx + (bw - font.widthOfTextAtSize(text, dateSize)) / 2,
        y: by + 1,
        size: dateSize,
        font,
        color: MUTED,
      });
    }
    stamped = true;
  }

  return stamped ? pdf.save() : pdfBytes;
}
