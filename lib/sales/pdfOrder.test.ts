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

import { bestCandidate, nitBase, similarity } from './pdfOrder';
describe('montar la oferta desde el PDF', () => {
  it('NIT base sin dígito de verificación', () => {
    expect(nitBase('900.123.456-7')).toBe('900123456');
    expect(nitBase('1015435914')).toBe('1015435914');
  });
  it('elige el infusor con la medida correcta', () => {
    const c = [
      { ItemCode: '10220', ItemName: 'INFUSOR MED HOMEPUMP 270ML - 10ML/H-1D  CAJA X 6' },
      { ItemCode: '10223', ItemName: 'INFUSOR MED HOMEPUMP 270ML - 5ML/H-2D  CAJA X 6' },
      { ItemCode: '10605', ItemName: 'MINICANGURO PARA INFUSOR HOMEPUMP UNIDAD (4042078)' },
    ];
    const b = bestCandidate('Infusor Homepump 270 ml 5ml/h', c);
    expect(b?.ItemCode).toBe('10223');
    expect(similarity('Infusor Homepump 270 ml 5ml/h', c[1].ItemName)).toBeGreaterThan(similarity('Infusor Homepump 270 ml 5ml/h', c[0].ItemName));
  });
  it('la talla cuenta: no cambia talla M por L', () => {
    const c = [
      { ItemCode: 'L', ItemName: 'GUANTES DE NITRILO NO ESTERIL AZUL TALLA - L CAJA X 100' },
      { ItemCode: 'M', ItemName: 'GUANTES DE NITRILO NO ESTERIL AZUL TALLA - M CAJA X 100' },
    ];
    expect(bestCandidate('GUANTES DE NITRILO TALLA M', c)?.ItemCode).toBe('M');
    expect(bestCandidate('GUANTES DE NITRILO TALLA M', [c[0]])).toBeNull();
  });
  it('sin parecido suficiente no elige nada', () => {
    expect(bestCandidate('GUANTES DE NITRILO', [{ ItemCode: '1', ItemName: 'EPINEFRINA 1MG' }])).toBeNull();
  });
});
