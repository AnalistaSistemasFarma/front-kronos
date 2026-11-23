import PizZip from 'pizzip';
import { describe, expect, it } from 'vitest';
import { detectDocxTags, fillDocx } from './fillDocx';
import { buildMarkerCatalog, resolveMarkerValues, type DocFormValue } from './fields';

/** .docx mínimo con un párrafo por texto (las marcas pueden partirse en varios «runs» como hace Word). */
function docx(paragraphs: string[][]): Uint8Array {
  const zip = new PizZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  );
  const body = paragraphs
    .map((runs) => `<w:p>${runs.map((t) => `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${t}</w:t></w:r>`).join('')}</w:p>`)
    .join('');
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
  );
  return zip.generate({ type: 'uint8array' }) as Uint8Array;
}

function documentXml(bytes: Uint8Array): string {
  return new PizZip(Buffer.from(bytes)).file('word/document.xml')!.asText();
}

const campos: DocFormValue[] = [
  { id_form_field: 1, field_label: 'Razón social', field_type: 'text', value_text: 'ACME & Cía <SAS>' },
  { id_form_field: 2, field_label: 'Valor', field_type: 'money', value_text: '2500000' },
  { id_form_field: 3, field_label: 'Observaciones', field_type: 'textarea', value_text: 'línea 1\nlínea 2' },
];
const catalog = buildMarkerCatalog(campos);
const values = resolveMarkerValues(campos, { idRequest: 41, company: 'OLP' });

describe('workflow-doc · fillDocx', () => {
  it('detecta las marcas y dice cuáles resuelven', () => {
    const bytes = docx([['Cliente: @{RAZON SOCIAL}'], ['Valor: @{Va', 'lor}'], ['@{Campo inexistente} y @{Empresa}']]);
    expect(detectDocxTags(bytes, catalog)).toEqual([
      { tag: 'RAZON SOCIAL', key: 'f:1' },
      { tag: 'Valor', key: 'f:2' },
      { tag: 'Campo inexistente', key: null },
      { tag: 'Empresa', key: 'sys:empresa' },
    ]);
  });

  it('llena el Word conservando el formato, escapa XML y reporta las desconocidas', () => {
    const bytes = docx([['Cliente: @{Razón social}'], ['Valor: @{Va', 'lor}'], ['N.º @{N.º de solicitud} @{Otra}'], ['@{Observaciones}']]);
    const r = fillDocx(bytes, catalog, values);
    const xml = documentXml(r.bytes);
    expect(xml).toContain('ACME &amp; Cía &lt;SAS&gt;');
    expect(xml).toContain('$ 2.500.000');
    expect(xml).toContain('N.º 41 ');
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:br/>');
    expect(xml).not.toContain('@{');
    expect(r.unknown).toEqual(['Otra']);
  });

  it('explica una marca mal cerrada', () => {
    expect(() => fillDocx(docx([['@{Razón social']]), catalog, values)).toThrow(/marcas mal escritas/);
  });
});
