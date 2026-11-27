import { describe, expect, it } from 'vitest';
import { decideMode, pctChange, priceRequestSubject, sanitizePriceLines } from './rules';

describe('listas de precios por socio de negocio', () => {
  it('lista propia → se cambia la lista; compartida o sin asignar → precio especial', () => {
    expect(decideMode(250, 1)).toBe('lista');
    expect(decideMode(1, 80)).toBe('especial');
    expect(decideMode(null, 0)).toBe('especial');
    expect(decideMode(1, 1, true)).toBe('especial');
  });
  it('variación porcentual', () => {
    expect(pctChange(5000, 6000)).toBe(20);
    expect(pctChange(0, 6000)).toBeNull();
    expect(pctChange(null, 6000)).toBeNull();
  });
  it('limpia líneas: precio > 0 y sin repetidos', () => {
    const r = sanitizePriceLines([{ itemCode: 'A', newPrice: '4800' }, { itemCode: 'B', newPrice: 0 }, { itemCode: 'A', newPrice: 6000 }, {}]);
    expect(r.lines).toEqual([{ itemCode: 'A', newPrice: 6000 }]);
    expect(r.errors).toHaveLength(1);
  });
  it('asunto', () => {
    expect(priceRequestSubject('COPIDROGAS', '890', 2)).toBe('LP - COPIDROGAS - 890 - 2 artículos');
  });
});
