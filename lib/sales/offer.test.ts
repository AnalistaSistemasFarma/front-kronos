import { describe, expect, it } from 'vitest';
import { buildOfferDraftPayload, buildQuotationPayload, sanitizeOfferLine, validateOffer } from './offer';

const h = { CardCode: 'C001', DocDueDate: '2026-11-05', NumAtCard: 'OC-9', Comments: 'Pedido' };
const l = [sanitizeOfferLine({ ItemCode: 'A1', Quantity: '2', UnitPrice: '1500,5', ListPrice: 1500, WarehouseCode: 'B1101', TaxCode: 'IVA19' })];

describe('validateOffer', () => {
  it('acepta una oferta completa', () => {
    expect(validateOffer(h, l, '2026-10-30')).toEqual([]);
  });
  it('exige cliente, fecha futura, líneas, cantidad > 0, precio >= 0 y bodega', () => {
    const e = validateOffer({ CardCode: '', DocDueDate: '2026-10-01' }, [sanitizeOfferLine({ ItemCode: '', Quantity: 0, UnitPrice: -1 })], '2026-10-30');
    expect(e.map((x) => x.field)).toEqual(['CardCode', 'DocDueDate', 'DocumentLines[0].ItemCode', 'DocumentLines[0].Quantity', 'DocumentLines[0].UnitPrice', 'DocumentLines[0].WarehouseCode']);
    expect(validateOffer(h, [], '2026-10-30')[0].field).toBe('DocumentLines');
  });
});

describe('payloads de SAP', () => {
  it('cotización en ER con precio de lista en la línea', () => {
    const q = buildQuotationPayload(h, l, '2026-10-30', 'traza');
    expect(q).toMatchObject({ CardCode: 'C001', DocDate: '2026-10-30', U_SEND_State: 'ER', U_SEND_TraCreatedBy: 'traza' });
    // El IVA que mande el navegador se ignora: SAP aplica el parametrizado.
    expect(q.DocumentLines[0]).toEqual({ ItemCode: 'A1', Quantity: 2, UnitPrice: 1500.5, U_SEND_PriceLP: 1500, WarehouseCode: 'B1101' });
  });
  it('borrador en B enlazado a la línea REAL de la cotización', () => {
    const d = buildOfferDraftPayload(h, l, { DocEntry: 77, DocumentLines: [{ LineNum: 3 }] }, '2026-10-30', 't');
    expect(d).toMatchObject({ DocObjectCode: 'oOrders', U_SEND_State: 'B' });
    expect(d.DocumentLines[0]).toMatchObject({ BaseType: 23, BaseEntry: 77, BaseLine: 3 });
  });
  it('sin precio de lista usa el precio digitado (no dispara autorización por vacío)', () => {
    const q = buildQuotationPayload(h, [sanitizeOfferLine({ ItemCode: 'A', Quantity: 1, UnitPrice: 10, WarehouseCode: 'B' })], '2026-10-30', 't');
    expect(q.DocumentLines[0].U_SEND_PriceLP).toBe(10);
  });
});

import { offerSubject } from './offer';
describe('asunto automático', () => {
  it('OV - nombre - NIT - primera línea', () => {
    expect(offerSubject('DISTRIBUCIONES AXA SAS', '800052534R', 'EPINEFRINA 1MG/1ML  AMP')).toBe('OV - DISTRIBUCIONES AXA SAS - 800052534R - EPINEFRINA 1MG/1ML AMP');
    expect(offerSubject(null, 'C1', '')).toBe('OV - C1');
  });
});

import { buildDraftUpdate, buildQuotationUpdate, mapQuotationLines } from './offer';
describe('editar oferta en borrador', () => {
  const h = { CardCode: 'C1', DocDueDate: '2026-11-20', Comments: 'x', ShipToCode: 'BOGOTÁ' };
  const lines = [
    { ...sanitizeOfferLine({ ItemCode: 'A', Quantity: 2, UnitPrice: 10, WarehouseCode: 'B1' }), BaseLine: 0 },
    { ...sanitizeOfferLine({ ItemCode: 'B', Quantity: 1, UnitPrice: 5, WarehouseCode: 'B1' }), BaseLine: null },
  ];
  it('cotización: existentes con su LineNum, nuevas sin él, sin cambiar el cliente', () => {
    const q = buildQuotationUpdate(h, lines);
    expect(q).not.toHaveProperty('CardCode');
    expect((q as Record<string, unknown>).ShipToCode).toBe('BOGOTÁ');
    expect(q.DocumentLines[0]).toMatchObject({ LineNum: 0, ItemCode: 'A', Quantity: 2 });
    expect(q.DocumentLines[1]).not.toHaveProperty('LineNum');
  });
  it('las líneas nuevas toman los LineNum que aparecieron en la cotización', () => {
    expect(mapQuotationLines(lines, [0, 1], [0, 2])).toEqual([0, 2]);
  });
  it('borrador enlazado a cada línea real de la cotización', () => {
    const d = buildDraftUpdate(h, lines, 25, [0, 2]);
    expect(d.DocumentLines.map((l) => [(l as Record<string, unknown>).ItemCode, l.BaseEntry, l.BaseLine])).toEqual([['A', 25, 0], ['B', 25, 2]]);
  });
});
