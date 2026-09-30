import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { buildWatermarkLines, formatBogotaDateTime, stampControlledCopy, toWinAnsiSafe } from '../watermark';

const AT = new Date('2026-10-01T19:05:00Z'); // 14:05 en Bogotá

async function samplePdf(pages = 2): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i++) pdf.addPage([595, 842]);
  return pdf.save();
}

describe('SGC · marca de agua de copia controlada', () => {
  it('[SGC-REQ-017] la marca lleva código, versión, quién consultó y la hora de Colombia', () => {
    const { diagonal, footer } = buildWatermarkLines({ code: 'OLP-GC-PR-001', versionNumber: 2, viewerEmail: 'ana@onelatampharma.com', at: AT, mode: 'consulta' });
    expect(diagonal).toBe('COPIA CONTROLADA');
    expect(footer).toContain('OLP-GC-PR-001 V2');
    expect(footer).toContain('ana@onelatampharma.com');
    expect(footer).toContain('2026-10-01 14:05 (hora Colombia)');
    expect(footer).toContain('Consulta en línea');
    expect(buildWatermarkLines({ code: 'X', versionNumber: 1, viewerEmail: 'a@b.co', at: AT, mode: 'impresion' }).footer).toContain('Impresión autorizada');
    expect(buildWatermarkLines({ code: 'X', versionNumber: 1, viewerEmail: 'a@b.co', at: AT, mode: 'descarga' }).footer).toContain('Descarga autorizada');
  });

  it('[SGC-REQ-017] deja el texto apto para la fuente estándar (tildes sí, emojis no)', () => {
    expect(toWinAnsiSafe('Gestión 🖥️\tCalidad')).toBe('Gestión ?? Calidad');
    expect(formatBogotaDateTime(new Date('2026-01-01T03:00:00Z'))).toBe('2025-12-31 22:00');
  });

  it('[SGC-REQ-017] estampa todas las páginas y no altera el número de páginas', async () => {
    const original = await samplePdf(3);
    const stamped = await stampControlledCopy(original, { code: 'OLP-GC-PR-001', versionNumber: 1, viewerEmail: 'ana@onelatampharma.com', at: AT, mode: 'consulta' });
    const reloaded = await PDFDocument.load(stamped, { updateMetadata: false });
    expect(reloaded.getPageCount()).toBe(3);
    expect(reloaded.getProducer()).toContain('copia controlada');
    expect(stamped.length).toBeGreaterThan(original.length);
  });
});
