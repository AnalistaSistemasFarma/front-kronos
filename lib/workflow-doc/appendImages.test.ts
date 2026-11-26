import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { appendImagesToPdf, isAppendableImage } from './appendImages';

/** Anexo de imágenes del informe (2026-11-26, Calidad OLP). */
const PNG_1x1 = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));

describe('Plantillas · anexo de imágenes', () => {
  it('solo JPG y PNG', () => {
    expect(isAppendableImage('foto.JPG')).toBe(true);
    expect(isAppendableImage('foto.png')).toBe(true);
    expect(isAppendableImage('foto.webp')).toBe(false);
    expect(isAppendableImage('informe.pdf')).toBe(false);
  });

  it('agrega una página por imagen válida y omite las dañadas o de otro tipo', async () => {
    const base = await PDFDocument.create();
    base.addPage();
    const bytes = await base.save();
    const out = await appendImagesToPdf(bytes, [
      { name: 'evidencia 1.png', bytes: PNG_1x1 },
      { name: 'dañada.jpg', bytes: Uint8Array.from([1, 2, 3]) },
      { name: 'otra.webp', bytes: PNG_1x1 },
    ]);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
    expect(await appendImagesToPdf(bytes, [])).toBe(bytes);
  });
});
