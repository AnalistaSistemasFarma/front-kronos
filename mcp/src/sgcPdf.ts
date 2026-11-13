/**
 * Utilidades de PDF para las herramientas del SGC documental (solo lectura).
 *
 *  - `extractPdfText`: texto del PDF controlado (pdfjs-dist, sin canvas ni red),
 *    página por página, recortado a un máximo de caracteres.
 *  - `stampAgentCopy`: marca la copia que se le entrega al agente como «copia
 *    controlada» (quién y cuándo), igual que el visor de SynerLink marca toda
 *    entrega (lib/sgc/watermark.ts). El original de OneDrive no se modifica.
 *
 * Nada de esto escribe en la base de datos ni en OneDrive.
 */
import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

/** Huella SHA-256 (hex en minúsculas) de un contenido. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface PdfTextResult {
  text: string;
  pages: number;
  truncated: boolean;
}

/**
 * Extrae el texto de un PDF. `maxChars` corta la salida (se marca `truncated`).
 * Un PDF escaneado (solo imagen) devuelve texto vacío: no hay OCR.
 */
export async function extractPdfText(bytes: Uint8Array, maxChars: number): Promise<PdfTextResult> {
  // Import perezoso: pdfjs es pesado y solo lo usa sgc_download_document.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    // pdfjs puede «transferir» (vaciar) el buffer que recibe: se le pasa una copia.
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;
  try {
    const parts: string[] = [];
    let length = 0;
    let truncated = false;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      let line = '';
      const lines: string[] = [];
      for (const item of content.items) {
        if (!('str' in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line);
          line = '';
        }
      }
      if (line) lines.push(line);
      const pageText = `--- Página ${p} ---\n${lines.map((l) => l.replace(/[ \t]+/g, ' ').trimEnd()).join('\n').trim()}\n`;
      page.cleanup();
      if (length + pageText.length > maxChars) {
        parts.push(pageText.slice(0, Math.max(0, maxChars - length)));
        truncated = true;
        break;
      }
      parts.push(pageText);
      length += pageText.length;
    }
    return { text: parts.join('\n').trim(), pages: doc.numPages, truncated };
  } finally {
    await doc.destroy();
  }
}

/** Fecha y hora de Bogotá legibles (UTC-5, sin horario de verano). */
export function formatBogota(at: Date): string {
  const local = new Date(at.getTime() - 5 * 60 * 60 * 1000);
  const iso = local.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} (hora Colombia)`;
}

/** Las fuentes estándar de pdf-lib solo codifican WinAnsi: se quitan los caracteres fuera de ese juego. */
export function toWinAnsi(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[«»]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E -ÿ]/g, '');
}

export interface AgentCopyInfo {
  code: string;
  versionNumber: number;
  agent: string;
  at: Date;
  /** Estado de la versión entregada (vigente, o «borrador» si está en divulgación). */
  versionStatus: string;
}

/** Líneas de la marca de la copia del agente (exportadas para pruebas). */
export function agentCopyLines(info: AgentCopyInfo): { diagonal: string; footer: string } {
  const estado = info.versionStatus === 'vigente' ? 'VIGENTE' : 'AUN NO VIGENTE (en divulgacion)';
  return {
    diagonal: toWinAnsi(`COPIA CONTROLADA - ${estado}`),
    footer: toWinAnsi(
      `Copia controlada de ${info.code} V${info.versionNumber} entregada al asistente de IA "${info.agent}" el ${formatBogota(info.at)} para consulta. ` +
        'Verifique la vigencia en SynerLink antes de usarla; impresa o descargada fuera del sistema es copia no controlada.'
    ),
  };
}

/** Estampa la copia que recibe el agente. No toca el PDF original guardado en OneDrive. */
export async function stampAgentCopy(pdfBytes: Uint8Array, info: AgentCopyInfo): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: false });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { diagonal, footer } = agentCopyLines(info);
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.max(18, Math.min(42, width / 16));
    const textWidth = bold.widthOfTextAtSize(diagonal, size);
    page.drawText(diagonal, {
      x: width / 2 - (textWidth / 2) * Math.cos(Math.PI / 4),
      y: height / 2 - (textWidth / 2) * Math.sin(Math.PI / 4),
      size,
      font: bold,
      color: rgb(0.75, 0.1, 0.1),
      opacity: 0.18,
      rotate: degrees(45),
    });
    // Pie en una o dos líneas, ajustado al ancho de la página.
    const footSize = 6.5;
    const maxWidth = width - 40;
    const words = footer.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const w of words) {
      const next = current ? `${current} ${w}` : w;
      if (font.widthOfTextAtSize(next, footSize) > maxWidth && current) {
        lines.push(current);
        current = w;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
    lines.slice(0, 3).forEach((l, i) => {
      page.drawText(l, { x: 20, y: 6 + (lines.length - 1 - i) * (footSize + 2), size: footSize, font, color: rgb(0.45, 0.1, 0.1) });
    });
  }
  return pdf.save();
}
