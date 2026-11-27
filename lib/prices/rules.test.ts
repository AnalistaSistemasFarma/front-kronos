import { describe, expect, it } from 'vitest';
import { decideMode, pctChange, priceRequestSubject, sanitizePriceLines } from './rules';

describe('customer price list updates', () => {
  it('own list → list update; shared or unassigned → special price', () => {
    expect(decideMode(250, 1)).toBe('list');
    expect(decideMode(1, 80)).toBe('special');
    expect(decideMode(null, 0)).toBe('special');
    expect(decideMode(1, 1, true)).toBe('special');
  });
  it('percentage change', () => {
    expect(pctChange(5000, 6000)).toBe(20);
    expect(pctChange(0, 6000)).toBeNull();
    expect(pctChange(null, 6000)).toBeNull();
  });
  it('cleans lines: price > 0 and no duplicates', () => {
    const r = sanitizePriceLines([{ itemCode: 'A', newPrice: '4800' }, { itemCode: 'B', newPrice: 0 }, { itemCode: 'A', newPrice: 6000 }, {}]);
    expect(r.lines).toEqual([{ itemCode: 'A', newPrice: 6000 }]);
    expect(r.errors).toHaveLength(1);
  });
  it('subject', () => {
    expect(priceRequestSubject('COPIDROGAS', '890', 2)).toBe('LP - COPIDROGAS - 890 - 2 artículos');
  });
});
