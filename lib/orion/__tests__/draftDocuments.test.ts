import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { inspectDocxMarkup } from '../docxClean';
import { stampDraftWatermark } from '../draftWatermark';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

async function docx(parts: { body: string; comments?: string }): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('word/document.xml', `<w:document ${W}><w:body>${parts.body}</w:body></w:document>`);
  if (parts.comments) zip.file('word/comments.xml', `<w:comments ${W}>${parts.comments}</w:comments>`);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('revisión de limpieza del Word', () => {
  it('un Word sin marcas está limpio', async () => {
    const report = await inspectDocxMarkup(await docx({ body: '<w:p><w:r><w:t>Hola</w:t></w:r></w:p>' }));
    expect(report).toEqual({ comments: 0, trackedChanges: 0, clean: true });
  });

  it('cuenta comentarios y cambios sin aceptar', async () => {
    const report = await inspectDocxMarkup(
      await docx({
        body:
          '<w:p><w:ins w:id="1"><w:r><w:t>nuevo</w:t></w:r></w:ins><w:del w:id="2"><w:r><w:delText>viejo</w:delText></w:r></w:del></w:p>',
        comments: '<w:comment w:id="0"><w:p/></w:comment>',
      })
    );
    expect(report).toEqual({ comments: 1, trackedChanges: 2, clean: false });
  });

  it('rechaza lo que no es .docx', async () => {
    await expect(inspectDocxMarkup(new TextEncoder().encode('no soy un zip'))).rejects.toThrow(/no es un documento Word/);
  });
});

describe('marca de agua del borrador', () => {
  it('marca todas las páginas y el PDF sigue siendo válido', async () => {
    const src = await PDFDocument.create();
    src.addPage([595, 842]);
    src.addPage([842, 595]);
    const stamped = await stampDraftWatermark(await src.save(), { versionLabel: 'v0.3' });
    const out = await PDFDocument.load(stamped);
    expect(out.getPageCount()).toBe(2);
    expect(stamped.byteLength).toBeGreaterThan((await src.save()).byteLength);
  });
});
