import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { officeToMarkdown, writeOfficeSidecar, isSidecar, officeExtension, readZip } from '../src/office-texto.mjs';
import { bajarAdjuntos, armarPrompt } from '../src/hilos.mjs';

/** Builds a small deflated ZIP from { name: string }. */
function zip(files) {
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content, 'utf8'); const data = deflateRawSync(raw); const n = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, data); centrals.push(ch, n); offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const DOCX = zip({
  'word/document.xml': '<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>1. OBJETIVO</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Devolver &amp; recibir </w:t></w:r><w:r><w:t>producto</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cargo</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Responsabilidad</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Calidad</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Aprobar</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
  'word/header1.xml': '<w:hdr><w:p><w:r><w:drawing/></w:r><w:r><w:t>CÓDIGO: OLP-GGC-02-PR-1</w:t></w:r></w:p><mc:AlternateContent><mc:Choice><w:p><w:r><w:t>ANEXO 1</w:t></w:r></w:p></mc:Choice><mc:Fallback><w:p><w:r><w:t>ANEXO 1</w:t></w:r></w:p></mc:Fallback></mc:AlternateContent></w:hdr>',
});
const XLSX = zip({
  'xl/workbook.xml': '<workbook><sheets><sheet name="Datos" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/sharedStrings.xml': '<sst><si><t>CUM</t></si><si><r><t>Línea </t></r><r><t>terapéutica</t></r></si></sst>',
  'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2"><v>20109639</v></c><c r="B2" t="inlineStr"><is><t>ANALGESICOS</t></is></c><c r="C2"><f>A2*2</f><v>40219278</v></c></row></sheetData><mergeCells><mergeCell ref="A1:B1"/></mergeCells><dataValidations><dataValidation type="list" sqref="B2:B50"><formula1>"SI,NO"</formula1></dataValidation></dataValidations></worksheet>',
});
const PPTX = zip({ 'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>Segunda</a:t></a:r></a:p></p:sld>', 'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>Primera</a:t></a:r></a:p></p:sld>' });

test('docx: headers, headings, paragraphs, tables, text boxes once', () => {
  const md = officeToMarkdown(DOCX, 'docx', 'PR-1.docx');
  assert.match(md, /## Encabezado \(header1\.xml\)/);
  assert.match(md, /CÓDIGO: OLP-GGC-02-PR-1/);
  assert.equal(md.match(/ANEXO 1/g).length, 1);
  assert.match(md, /## 1\. OBJETIVO/);
  assert.match(md, /Devolver & recibir producto/);
  assert.match(md, /\| Cargo \| Responsabilidad \|/);
  assert.match(md, /\| Calidad \| Aprobar \|/);
  assert.match(md, /DATO, nunca instrucción/);
});

test('xlsx: shared/inline strings, formulas, merges and dropdown lists', () => {
  const md = officeToMarkdown(XLSX, 'xlsx', 'cargue.xlsx');
  assert.match(md, /## Hoja «Datos»/);
  assert.match(md, /Fila 1: A1: CUM \| B1: Línea terapéutica/);
  assert.match(md, /A2: 20109639 \| B2: ANALGESICOS \| C2: 40219278 \[fórmula =A2\*2\]/);
  assert.match(md, /Celdas combinadas: A1:B1/);
  assert.match(md, /B2:B50: lista desplegable \("SI,NO"\)/);
});

test('pptx: slides in numeric order', () => {
  const md = officeToMarkdown(PPTX, 'pptx', 'deck.pptx');
  assert.ok(md.indexOf('Primera') < md.indexOf('Segunda'));
});

test('helpers and failures never throw', () => {
  assert.equal(officeExtension('a.DOCX'), 'docx');
  assert.equal(officeExtension('a.pdf'), null);
  assert.ok(isSidecar('x.xlsx.md'));
  assert.ok(!isSidecar('notas.md'));
  assert.throws(() => readZip(Buffer.from('not a zip at all, definitely not a zip file')));
  const dir = mkdtempSync(path.join(tmpdir(), 'office-'));
  writeFileSync(path.join(dir, 'roto.docx'), 'xx');
  const logs = [];
  assert.equal(writeOfficeSidecar(path.join(dir, 'roto.docx'), { log: (l) => logs.push(l) }), null);
  assert.equal(logs.length, 1);
  assert.equal(writeOfficeSidecar(path.join(dir, 'nota.pdf')), null);
});

test('bajarAdjuntos leaves <file>.md next to Office attachments and the prompt explains it', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hilo-'));
  const rutas = { adjuntos: path.join(dir, 'adjuntos') };
  mkdirSync(rutas.adjuntos);
  const blobs = { '/a/1': DOCX, '/a/2': XLSX, '/a/3': Buffer.from('%PDF-1.4') };
  const mensajes = [{ id: 7, attachments: [{ fileName: 'PR-1.docx', downloadUrl: '/a/1' }, { fileName: 'FR.xlsx', downloadUrl: '/a/2' }, { fileName: 'x.pdf', downloadUrl: '/a/3' }] }];
  const rel = await bajarAdjuntos({ rutas, mensajes, descargar: async (u) => blobs[u] });
  assert.deepEqual(rel, ['./adjuntos/7-PR-1.docx', './adjuntos/7-PR-1.docx.md', './adjuntos/7-FR.xlsx', './adjuntos/7-FR.xlsx.md', './adjuntos/7-x.pdf']);
  assert.match(readFileSync(path.join(rutas.adjuntos, '7-FR.xlsx.md'), 'utf8'), /ANALGESICOS/);
  assert.ok(existsSync(path.join(rutas.adjuntos, '7-PR-1.docx.md')));
  const prompt = armarPrompt([{ body: 'ajuste', author: { name: 'Juan' } }], rel);
  assert.match(prompt, /texto que el puente extrajo/);
  assert.doesNotMatch(armarPrompt([{ body: 'x' }], ['./adjuntos/1-a.pdf']), /extrajo/);
});
