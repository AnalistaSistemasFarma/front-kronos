import { describe, expect, it, vi } from 'vitest';
import { customerOrdersPath, filterByItems, sortCustomerOrderLines, toCustomerOrderLines } from './customerOrders';

const calls: string[] = [];
vi.mock('../sap/serviceLayer', () => ({
  sapGet: async () => ({ value: [] }),
  sapGetAll: async (_s: unknown, p: string) => {
    calls.push(p);
    const doc = p.match(/^\$crossjoin\((\w+),/)![1];
    if (doc === 'Invoices') return [{ Invoices: { DocEntry: 91000, DocNum: 81000, DocDate: '2026-10-07', NumAtCard: '11500' }, 'Invoices/DocumentLines': { ItemCode: 'PTPT0121', ItemDescription: 'PIPERACILINA Y TAZOBACTAM 4.5g', Quantity: 2000, UnitPrice: 6300 } }];
    if (doc === 'Orders') return [{ Orders: { DocEntry: 5000, DocNum: 4000, DocDate: '2026-10-09', NumAtCard: '11530' }, 'Orders/DocumentLines': { ItemCode: 'PTCZ0121', ItemDescription: 'CEFAZOLINA 1g', Quantity: 6000, UnitPrice: 1450 } }];
    return [];
  },
}));

describe('customer previous documents', () => {
  it('path is bounded by customer and date, newest first', () => {
    const p = customerOrdersPath('Orders', "9017'14987", '2026-05-27');
    expect(p).toContain("Orders/CardCode eq '9017''14987'");
    expect(p).toContain("Orders/DocDate ge '2026-05-27'");
    expect(p).toContain("Orders/Cancelled eq 'tNO'");
    expect(p).toContain('NumAtCard');
    expect(p).toContain('$orderby=Orders/DocEntry desc');
  });

  it('maps, sorts and filters by item', () => {
    const a = toCustomerOrderLines('Invoices', [{ Invoices: { DocEntry: 1, DocNum: 10, DocDate: '2026-10-07', NumAtCard: 'OC1' }, 'Invoices/DocumentLines': { ItemCode: 'A', ItemDescription: 'a', Quantity: 2, UnitPrice: 5 } }]);
    const b = toCustomerOrderLines('Orders', [{ Orders: { DocEntry: 2, DocNum: 20, DocDate: '2026-10-09', NumAtCard: '' }, 'Orders/DocumentLines': { ItemCode: 'B', ItemDescription: 'b', Quantity: 1, UnitPrice: 7 } }]);
    const all = sortCustomerOrderLines([...a, ...b]);
    expect(all.map((x) => x.itemCode)).toEqual(['B', 'A']);
    expect(all[1]).toMatchObject({ type: 'Invoices', docNum: 10, numAtCard: 'OC1', quantity: 2, unitPrice: 5 });
    expect(filterByItems(all, ['A']).map((x) => x.itemCode)).toEqual(['A']);
    expect(filterByItems(all, [])).toHaveLength(2);
  });

  it('reads the three document types once and caches them', async () => {
    const { customerOrders } = await import('./customerOrders');
    const s = { baseUrl: 'x', companyDB: 'FARMA' } as never;
    const r = await customerOrders(s, '901714987', '2026-11-27');
    expect(r.map((x) => `${x.type}:${x.itemCode}`)).toEqual(['Orders:PTCZ0121', 'Invoices:PTPT0121']);
    expect(calls).toHaveLength(3);
    await customerOrders(s, '901714987', '2026-11-27');
    expect(calls).toHaveLength(3);
  });
});
