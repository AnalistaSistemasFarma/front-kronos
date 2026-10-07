import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

export const DRAFT_WATERMARK_TEXT = 'BORRADOR - NO VÁLIDO PARA FIRMA';

/**
 * Marca el PDF de vista previa para el cliente: texto diagonal en todas las páginas y pie
 * con la versión. Así el borrador no se confunde con el documento listo para firmar.
 */
export async function stampDraftWatermark(
  pdf: Uint8Array,
  params: { versionLabel: string }
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const footer = `Borrador ${params.versionLabel} - pendiente de aprobación del cliente. No válido para firma.`;

  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const diagonal = Math.sqrt(width * width + height * height);
    const size = Math.max(18, Math.min(60, (diagonal * 0.75) / (DRAFT_WATERMARK_TEXT.length * 0.6)));
    const textWidth = bold.widthOfTextAtSize(DRAFT_WATERMARK_TEXT, size);
    const angle = Math.atan2(height, width);
    // Centrado sobre la diagonal inferior-izquierda → superior-derecha.
    const x = width / 2 - (Math.cos(angle) * textWidth) / 2 + (Math.sin(angle) * size) / 2;
    const y = height / 2 - (Math.sin(angle) * textWidth) / 2 - (Math.cos(angle) * size) / 2;
    page.drawText(DRAFT_WATERMARK_TEXT, {
      x,
      y,
      size,
      font: bold,
      color: rgb(0.8, 0.1, 0.1),
      opacity: 0.18,
      rotate: degrees((angle * 180) / Math.PI),
    });

    const footerSize = 8;
    const footerWidth = regular.widthOfTextAtSize(footer, footerSize);
    page.drawText(footer, {
      x: Math.max(12, (width - footerWidth) / 2),
      y: 10,
      size: footerSize,
      font: regular,
      color: rgb(0.7, 0.1, 0.1),
    });
  }

  return doc.save();
}
