import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import mammoth from 'mammoth';

/**
 * Prueba de la conversión DOCX -> HTML que usa
 * app/api/document-management/documents/[id]/upload-word/route.ts (mammoth
 * .convertToHtml, Sprint 9). No probamos el route.ts en sí (requeriría
 * mockear next-auth/prisma/formData -- fuera del patrón del resto de la
 * suite), sino la conversión real con la librería real: es la parte que de
 * verdad puede fallar con un archivo real (estilos raros, .docx corrupto,
 * archivo vacío).
 *
 * El .docx mínimo se arma en memoria con JSZip (ya es dependencia del
 * proyecto) siguiendo la estructura OOXML mínima que mammoth reconoce:
 * [Content_Types].xml + _rels/.rels + word/document.xml. Evita commitear un
 * binario de fixture al repo.
 */
async function buildMinimalDocx(paragraphText: string): Promise<Buffer> {
  const zip = new JSZip();

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );

  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );

  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:t>${paragraphText}</w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>`
  );

  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('conversión DOCX -> HTML (mammoth, Sprint 9)', () => {
  it('convierte un .docx válido a HTML no vacío con el texto del documento', async () => {
    const buffer = await buildMinimalDocx('Contenido de prueba para el editor de Gestión Documental');

    const conversion = await mammoth.convertToHtml({ buffer });

    expect(conversion.value).toBeTruthy();
    expect(conversion.value.trim().length).toBeGreaterThan(0);
    expect(conversion.value).toContain('Contenido de prueba para el editor de Gestión Documental');
    expect(conversion.value).toMatch(/<p>/);
  });

  it('preserva tildes/eñes del contenido original', async () => {
    const buffer = await buildMinimalDocx('Política de calidad — versión número uno, año 2026');

    const conversion = await mammoth.convertToHtml({ buffer });

    expect(conversion.value).toContain('Política de calidad');
    expect(conversion.value).toContain('versión número uno');
  });

  it('rechaza (rejects) un archivo que no es un .docx/zip válido', async () => {
    const notADocx = Buffer.from('esto no es un archivo Word, es texto plano cualquiera');

    await expect(mammoth.convertToHtml({ buffer: notADocx })).rejects.toBeTruthy();
  });
});
