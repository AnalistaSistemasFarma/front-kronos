import { describe, expect, it } from 'vitest';
import { purchaseDescription, purchaseSubject } from './subject';

describe('purchaseSubject', () => {
  it('arma «SC - PROVEEDOR - primera línea (+N)»', () => {
    expect(
      purchaseSubject({
        DocumentLines: [
          { ItemDescription: 'RESMA PAPEL CARTA', U_NombreProveedor: 'Papelería Andina' },
          { ItemDescription: 'TONER' },
        ],
      })
    ).toBe('SC - PAPELERÍA ANDINA - RESMA PAPEL CARTA (+1 línea)');
  });
  it('omite el proveedor si ninguna línea lo tiene y usa el código si no hay descripción', () => {
    expect(purchaseSubject({ DocumentLines: [{ ItemCode: 'A001' }] })).toBe('SC - A001');
  });
  it('sin líneas queda «SC»', () => {
    expect(purchaseSubject({})).toBe('SC');
  });
});

describe('purchaseDescription', () => {
  it('comentarios + total', () => {
    expect(purchaseDescription({ Comments: 'PARA OFICINA', DocTotal: 1500, DocCurrency: 'COP' })).toBe('PARA OFICINA · Total 1.500 COP');
  });
});
