import { describe, expect, it } from 'vitest';
import {
  isOrionDocumentDeleted,
  parseOrionSignatureBagBag,
  serializeOrionSignatureBagBag,
  setOrionDocumentInBag,
} from '../formValue';

describe('documentos eliminados en el bag', () => {
  const bag = {
    documents: { keep: { fileId: 'keep', status: 'BORRADOR' } },
    deletedDocuments: [
      {
        fileId: 'gone',
        fileName: 'contrato.pdf',
        orionDocumentIds: ['orion-1', 'orion-0'],
        deletedAt: '2026-09-28T00:00:00.000Z',
        deletedByEmail: 'a@b.com',
      },
    ],
  };

  it('se conservan al serializar y al actualizar otro documento', () => {
    const roundTrip = parseOrionSignatureBagBag(serializeOrionSignatureBagBag(bag));
    expect(roundTrip.deletedDocuments).toEqual(bag.deletedDocuments);
    const updated = setOrionDocumentInBag(roundTrip, 'keep', { status: 'PENDIENTE_FIRMA' });
    expect(updated.deletedDocuments).toEqual(bag.deletedDocuments);
  });

  it('detecta por fileId o por cualquier versión de Orion', () => {
    expect(isOrionDocumentDeleted(bag, { fileId: 'gone' })).toBe(true);
    expect(isOrionDocumentDeleted(bag, { orionDocumentId: 'orion-0' })).toBe(true);
    expect(isOrionDocumentDeleted(bag, { fileId: 'keep', orionDocumentId: 'x' })).toBe(false);
  });
});
