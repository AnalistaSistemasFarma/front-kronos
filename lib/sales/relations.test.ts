import { describe, expect, it } from 'vitest';
import { quotationOf, targetsPath, toDoc, uniqueDocs } from './relations';

describe('mapa de relaciones', () => {
  it('ruta de entregas de un pedido por $crossjoin', () => {
    expect(targetsPath('DeliveryNotes', 17, [2761, 2761])).toBe(
      '$crossjoin(DeliveryNotes,DeliveryNotes/DocumentLines)?$expand=DeliveryNotes($select=DocEntry,DocNum,DocDate,DocTotal,DocumentStatus,Cancelled)&$filter=DeliveryNotes/DocEntry eq DeliveryNotes/DocumentLines/DocEntry and DeliveryNotes/DocumentLines/BaseType eq 17 and (DeliveryNotes/DocumentLines/BaseEntry eq 2761)'
    );
    expect(targetsPath('Invoices', 15, [])).toBeNull();
  });
  it('deduplica los documentos del crossjoin', () => {
    const rows = [{ DeliveryNotes: { DocEntry: 5, DocNum: 50, DocumentStatus: 'bost_Open' } }, { DeliveryNotes: { DocEntry: 5, DocNum: 50 } }];
    expect(uniqueDocs('delivery', 'DeliveryNotes', rows)).toHaveLength(1);
  });
  it('estado legible y cancelados', () => {
    expect(toDoc('order', { DocEntry: 1, DocumentStatus: 'bost_Close' }).status).toBe('Cerrado');
    expect(toDoc('order', { DocEntry: 1, DocumentStatus: 'bost_Close', Cancelled: 'tYES' }).status).toBe('Cancelado');
  });
  it('cotización base del borrador', () => {
    expect(quotationOf({ DocumentLines: [{ BaseType: 23, BaseEntry: 40 }] })).toBe(40);
    expect(quotationOf({ DocumentLines: [{ BaseType: -1, BaseEntry: null }] })).toBeNull();
  });
});
