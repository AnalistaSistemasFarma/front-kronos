import { describe, expect, it } from 'vitest';
import { nestDraftPdfRows } from '../attachmentNesting';

const rows = [
  { id: 'pdf-1', name: 'Contrato.pdf', source: 'word-1' },
  { id: 'anexo', name: 'Anexo.xlsx', source: null },
  { id: 'word-1', name: 'Contrato.docx', source: null },
  { id: 'pdf-huerfano', name: 'Viejo.pdf', source: 'word-borrado' },
];

describe('adjuntos: PDF del Word como sub-fila', () => {
  it('pone el PDF debajo de su Word y numera 1, 1.1, 2…', () => {
    const out = nestDraftPdfRows(rows, (r) => r.source);
    expect(out.map((r) => [r.file.id, r.rowNumber, r.nested])).toEqual([
      ['anexo', '1', false],
      ['word-1', '2', false],
      ['pdf-1', '2.1', true],
      ['pdf-huerfano', '3', false],
    ]);
  });
});
