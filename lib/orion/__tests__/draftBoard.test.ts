import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  alignBlocks,
  countChangeRuns,
  diffText,
  findAnchor,
  findAnchorLoose,
  isCorrectionApplied,
  mapBlockIndex,
  type DraftBlock,
} from '../draftDiff';
import { htmlToDraftBlocks } from '../draftBlocks';
import { addCommentsToDocx } from '../docxComments';
import { inspectDocxMarkup } from '../docxClean';

const p = (text: string, lead?: string): DraftBlock => ({ kind: 'p', text, ...(lead ? { lead } : {}) });

const V3 = [
  p('CONTRATO DE PRESTACIÓN DE SERVICIOS'),
  p('TERCERA. FORMA DE PAGO. Se pagará dentro de los treinta (30) días calendario siguientes.', 'TERCERA. FORMA DE PAGO.'),
  p('QUINTA. GARANTÍAS. Póliza por el diez por ciento (10%) del valor.', 'QUINTA. GARANTÍAS.'),
  p('SEXTA. TERMINACIÓN. Podrá terminarse sin previo aviso.', 'SEXTA. TERMINACIÓN.'),
];
const V4 = [
  p('CONTRATO DE PRESTACIÓN DE SERVICIOS'),
  p('NUEVA. Cláusula agregada en la v0.4.'),
  p('TERCERA. FORMA DE PAGO. Se pagará dentro de los sesenta (60) días calendario siguientes.', 'TERCERA. FORMA DE PAGO.'),
  p('QUINTA. GARANTÍAS. Póliza por el diez por ciento (10%) del valor.', 'QUINTA. GARANTÍAS.'),
  p('SEXTA. TERMINACIÓN. Podrá terminarse con preaviso de treinta (30) días calendario.', 'SEXTA. TERMINACIÓN.'),
];

describe('tablero: control de cambios', () => {
  it('compara palabra por palabra y cuenta los tramos cambiados', () => {
    const ops = diffText('dentro de los treinta (30) días', 'dentro de los sesenta (60) días');
    expect(ops.filter((o) => o.t === 'del').map((o) => o.v).join('')).toBe('treinta (30)');
    expect(ops.filter((o) => o.t === 'ins').map((o) => o.v).join('')).toBe('sesenta (60)');
    expect(countChangeRuns(ops)).toBe(1);
  });

  it('empareja párrafos: iguales, modificados y agregados', () => {
    const rows = alignBlocks(V3, V4);
    expect(rows.map((r) => r.type)).toEqual(['eq', 'ins', 'mod', 'eq', 'mod']);
    expect(mapBlockIndex(rows, 1)).toBe(2);
    expect(mapBlockIndex(rows, 3)).toBe(4);
  });

  it('un párrafo quitado no tiene equivalente', () => {
    const rows = alignBlocks(V3, [V3[0], V3[2], V3[3]]);
    expect(rows.some((r) => r.type === 'del' && r.oldIndex === 1)).toBe(true);
    expect(mapBlockIndex(rows, 1)).toBeNull();
  });
});

describe('tablero: marcas y detección automática', () => {
  it('ubica la cita en el párrafo sugerido o en el más cercano', () => {
    expect(findAnchor(V3, 'diez por ciento (10%)', 2)).toMatchObject({ index: 2 });
    expect(findAnchor(V3, 'diez por ciento (10%)', 0)).toMatchObject({ index: 2 });
    expect(findAnchor(V3, 'no existe', 1)).toBeNull();
  });

  it('una selección de la hoja con espacios o saltos distintos cae en el párrafo y cita exactos', () => {
    // La hoja (PDF) puede traer el texto con saltos de renglón y sin algunos espacios.
    const hit = findAnchorLoose(V3, 'dentro de los treinta(30)\ndías   calendario', 0);
    expect(hit).toMatchObject({ index: 1, quote: 'dentro de los treinta (30) días calendario' });
    expect(findAnchorLoose(V3, 'texto que no está', 0)).toBeNull();
  });

  it('detecta la corrección en el párrafo equivalente, no en todo el documento', () => {
    const rows = alignBlocks(V3, V4);
    const idx = mapBlockIndex(rows, 1)!;
    // "treinta (30) días calendario" sigue existiendo en la SEXTA, pero la TERCERA sí se corrigió.
    expect(isCorrectionApplied(V4[idx].text, 'treinta (30) días calendario', 'sesenta (60) días calendario')).toBe(true);
    const garantia = mapBlockIndex(rows, 2)!;
    expect(isCorrectionApplied(V4[garantia].text, 'diez por ciento (10%)', 'veinte por ciento (20%)')).toBe(false);
  });
});

describe('tablero: lectura del Word', () => {
  it('convierte el HTML de mammoth en párrafos con la negrilla inicial', () => {
    const blocks = htmlToDraftBlocks(
      '<h1>CONTRATO</h1><p><strong>PRIMERA. OBJETO.</strong> Prestar servicios &amp; soporte.</p>' +
        '<ul><li>Bogotá</li></ul><table><tr><td><p>Tarifa</p></td></tr></table><p></p>'
    );
    expect(blocks).toEqual([
      { kind: 'h', text: 'CONTRATO' },
      { kind: 'p', text: 'PRIMERA. OBJETO. Prestar servicios & soporte.', lead: 'PRIMERA. OBJETO.' },
      { kind: 'li', text: 'Bogotá' },
      { kind: 'cell', text: 'Tarifa' },
    ]);
  });
});

describe('tablero: Word con comentarios', () => {
  async function docx(paragraphs: string[]): Promise<Uint8Array> {
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'
    );
    zip.file(
      'word/_rels/document.xml.rels',
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
    );
    const body = paragraphs
      .map((t) => `<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`)
      .join('');
    zip.file(
      'word/document.xml',
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:p/></w:body></w:document>`
    );
    return zip.generateAsync({ type: 'uint8array' });
  }

  it('pone cada marca como comentario en el párrafo que tiene el texto', async () => {
    const out = await addCommentsToDocx(await docx(['Plazo de treinta (30) días.', 'Póliza del 10%.']), [
      { author: 'Beto Ramírez', quote: 'Póliza del 10%', lines: ['[Corrección 4] Dice: "10%"', 'Por qué: comité de riesgos'] },
    ]);
    const zip = await JSZip.loadAsync(out);
    const doc = await zip.file('word/document.xml')!.async('string');
    const second = doc.split('</w:p>')[1];
    expect(second).toContain('<w:commentRangeStart w:id="0"/>');
    expect(second).toContain('<w:commentReference w:id="0"/>');
    const comments = await zip.file('word/comments.xml')!.async('string');
    expect(comments).toContain('w:author="Beto Ramírez"');
    expect(comments).toContain('w:initials="BR"');
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('/word/comments.xml');
    expect(await zip.file('word/_rels/document.xml.rels')!.async('string')).toContain('comments.xml');
    // La revisión de limpieza del paso a PDF reconoce esos comentarios.
    expect((await inspectDocxMarkup(out)).comments).toBe(1);
  });

  it('si el texto ya no está, lo avisa dentro del comentario', async () => {
    const out = await addCommentsToDocx(await docx(['Texto nuevo.']), [
      { author: 'Ana Torres', quote: 'texto viejo', lines: ['Dice: "texto viejo"'] },
    ]);
    const comments = await (await JSZip.loadAsync(out)).file('word/comments.xml')!.async('string');
    expect(comments).toContain('No se encontró el texto marcado');
  });
});
