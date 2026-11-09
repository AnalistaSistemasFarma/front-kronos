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

import { chunkOrderText, mergePdfOrders, tableHeaderRow } from './pdfOrder';
describe('OC larga: por fragmentos (ventana de contexto pequeña)', () => {
  const rows = Array.from({ length: 36 }, (_, i) => `${10000 + i} | ARTICULO ${i} | ${i + 1} | 1000`);
  const pages = [`--- Página 1 ---\nORDEN DE COMPRA 55\nCODIGO | DESCRIPCION | CANTIDAD | PRECIO\n${rows.slice(0, 20).join('\n')}`, `--- Página 2 ---\n${rows.slice(20).join('\n')}`];
  it('parte en fragmentos de renglones completos sin perder ninguno', () => {
    const c = chunkOrderText(pages, 3000, 15);
    expect(c.length).toBeGreaterThan(2);
    const all = c.join('\n');
    rows.forEach((r) => expect(all).toContain(r));
  });
  it('encuentra el renglón de encabezados de la tabla', () => {
    expect(tableHeaderRow(pages)).toBe('CODIGO | DESCRIPCION | CANTIDAD | PRECIO');
  });
  it('une los resultados: cabecera del primero que la traiga y todas las líneas renumeradas', () => {
    const l = (code: string) => ({ row: 1, ItemCode: code, Quantity: 1, UnitPrice: null, WarehouseCode: '', ItemDescription: code });
    const m = mergePdfOrders([
      { numeroOrdenCompra: '', nitCliente: '900', fechaEntrega: '', lineas: [l('A'), l('B')] },
      { numeroOrdenCompra: 'OC-1', nitCliente: '', fechaEntrega: '2026-12-01', lineas: [l('C')] },
    ]);
    expect(m).toMatchObject({ numeroOrdenCompra: 'OC-1', nitCliente: '900', fechaEntrega: '2026-12-01' });
    expect(m.lineas.map((x) => `${x.row}${x.ItemCode}`)).toEqual(['1A', '2B', '3C']);
  });
});
