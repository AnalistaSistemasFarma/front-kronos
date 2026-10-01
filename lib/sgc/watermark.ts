import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

/**
 * Marca de agua de "copia controlada" del visor del SGC.
 *
 * El PDF que sale del servidor hacia el visor (o hacia una descarga/impresión
 * autorizada) va SIEMPRE estampado con quién lo consultó y cuándo; el PDF
 * original guardado en OneDrive no se toca (su hash SHA-256 sigue siendo el
 * registrado). Así, aunque alguien extraiga el archivo del navegador, la copia
 * lleva su nombre y la fecha. Limitación honesta: nada impide una captura de
 * pantalla; la marca y el registro de consultas son la mitigación.
 */

export interface SgcWatermarkInfo {
  code: string;
  versionNumber: number;
  viewerEmail: string;
  /** Momento de la consulta (se muestra en hora de Colombia). */
  at: Date;
  mode: 'consulta' | 'descarga' | 'impresion';
  /**
   * Sprint 4: estado de la versión que se entrega. Una versión OBSOLETA o
   * ANULADA sale marcada como tal (diagonal y pie); una versión aprobada que
   * se está divulgando sale como «en divulgación — aún no vigente». El PDF
   * guardado no cambia (su SHA-256 sigue siendo el registrado).
   */
  state?: 'vigente' | 'obsoleto' | 'anulado' | 'divulgacion';
}

const STATE_TEXT: Record<NonNullable<SgcWatermarkInfo['state']>, { diagonal: string; banner: string | null }> = {
  vigente: { diagonal: 'COPIA CONTROLADA', banner: null },
  obsoleto: { diagonal: 'OBSOLETO', banner: 'DOCUMENTO OBSOLETO - NO VÁLIDO PARA USO' },
  anulado: { diagonal: 'ANULADO', banner: 'DOCUMENTO ANULADO - NO VÁLIDO PARA USO' },
  divulgacion: { diagonal: 'EN DIVULGACIÓN', banner: 'EN DIVULGACIÓN - AÚN NO VIGENTE' },
};

const MODE_TEXT: Record<SgcWatermarkInfo['mode'], string> = {
  consulta: 'Consulta en línea',
  descarga: 'Descarga autorizada',
  impresion: 'Impresión autorizada',
};

/** Deja el texto en el rango que soporta la fuente estándar (WinAnsi / Latin-1). */
export function toWinAnsiSafe(text: string): string {
  return Array.from(text ?? '')
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 63;
      if (code === 9 || code === 10 || code === 13) return ' ';
      return code >= 32 && code <= 255 ? ch : '?';
    })
    .join('');
}

/** Fecha y hora de Colombia (UTC−5, sin horario de verano): "2026-09-30 14:05". */
export function formatBogotaDateTime(at: Date): string {
  const bogota = new Date(at.getTime() - 5 * 60 * 60 * 1000);
  return bogota.toISOString().slice(0, 16).replace('T', ' ');
}

/** Textos de la marca: la diagonal y el pie de cada página. */
export function buildWatermarkLines(info: SgcWatermarkInfo): { diagonal: string; footer: string } {
  const state = STATE_TEXT[info.state ?? 'vigente'];
  const footer = [
    ...(state.banner ? [state.banner] : []),
    'COPIA CONTROLADA',
    `${info.code} V${info.versionNumber}`,
    `${MODE_TEXT[info.mode]}: ${info.viewerEmail}`,
    `${formatBogotaDateTime(info.at)} (hora Colombia)`,
    'Prohibida su reproducción sin autorización de Calidad',
  ].join(' · ');
  return { diagonal: toWinAnsiSafe(state.diagonal), footer: toWinAnsiSafe(footer) };
}

/** Devuelve el PDF con la marca de agua estampada en todas sus páginas. */
export async function stampControlledCopy(pdfBytes: Uint8Array, info: SgcWatermarkInfo): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true, updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const small = await pdf.embedFont(StandardFonts.Helvetica);
  const { diagonal, footer } = buildWatermarkLines(info);

  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.min(width, height) / 9;
    const textWidth = font.widthOfTextAtSize(diagonal, size);
    const angle = Math.atan2(height, width);
    page.drawText(diagonal, {
      x: width / 2 - (Math.cos(angle) * textWidth) / 2,
      y: height / 2 - (Math.sin(angle) * textWidth) / 2,
      size,
      font,
      color: rgb(0.75, 0.1, 0.1),
      // Obsoleto/anulado: marca más visible (no debe confundirse con una copia vigente).
      opacity: info.state === 'obsoleto' || info.state === 'anulado' ? 0.28 : 0.12,
      rotate: degrees((angle * 180) / Math.PI),
    });

    let footerSize = 7;
    while (footerSize > 4 && small.widthOfTextAtSize(footer, footerSize) > width - 24) footerSize -= 0.5;
    page.drawText(footer, {
      x: 12,
      y: 8,
      size: footerSize,
      font: small,
      color: rgb(0.55, 0.1, 0.1),
      opacity: 0.85,
    });
  }

  pdf.setProducer('SynerLink — SGC documental (copia controlada)');
  return pdf.save();
}
