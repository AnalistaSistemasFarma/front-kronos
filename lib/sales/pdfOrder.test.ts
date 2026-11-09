import { describe, expect, it } from 'vitest';
import { parsePdfOrder, searchTerms } from './pdfOrder';

describe('PDF de la OC con IA del navegador', () => {
  it('normaliza la respuesta y descarta líneas inválidas', () => {
    const r = parsePdfOrder('Aquí está: {"numeroOrdenCompra":"OC-123","nitCliente":"900.123.456-7","fechaEntrega":"2026-11-20","lineas":[' +
      '{"codigo":"10223","descripcion":"INFUSOR HOMEPUMP","cantidad":10,"precioUnitario":104060},' +
      '{"descripcion":"EPINEFRINA 1MG","cantidad":"1.200","precioUnitario":"2.500,5"},' +
      '{"descripcion":"TOTAL","cantidad":0}]}');
    expect(r.numeroOrdenCompra).toBe('OC-123');
    expect(r.nitCliente).toBe('900123456-7');
    expect(r.lineas).toEqual([
      { row: 1, ItemCode: '10223', Quantity: 10, UnitPrice: 104060, WarehouseCode: '', ItemDescription: 'INFUSOR HOMEPUMP' },
      { row: 2, ItemCode: '', Quantity: 1200, UnitPrice: 2500.5, WarehouseCode: '', ItemDescription: 'EPINEFRINA 1MG' },
    ]);
  });
  it('respuesta ilegible da un error claro', () => {
    expect(() => parsePdfOrder('no sé')).toThrow(/legible/);
  });
  it('palabras de búsqueda de la descripción', () => {
    expect(searchTerms('Epinefrina 1mg/1ml amp caja x 100')).toEqual(['EPINEFRINA']);
    expect(searchTerms('INFUSOR MED HOMEPUMP 270ML')).toEqual(['INFUSOR', 'HOMEPUMP']);
  });
});
