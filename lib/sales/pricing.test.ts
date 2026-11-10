import { describe, expect, it, vi } from 'vitest';
vi.mock('../sap/serviceLayer', () => ({ sapGet: vi.fn() }));
import { pickPrice } from './pricing';

describe('precio de lista', () => {
  const prices = [{ PriceList: 1, Price: 0 }, { PriceList: 32, Price: 104061 }, { PriceList: 7, Price: 500 }];
  it('usa la lista del cliente si tiene precio', () => {
    expect(pickPrice(prices, 7, 32)).toEqual({ price: 500, source: 'lista', priceList: 7 });
  });
  it('cliente en «SIN ASIGNAR» (precio 0): usa la lista por defecto de la empresa', () => {
    expect(pickPrice(prices, 1, 32)).toEqual({ price: 104061, source: 'lista_defecto', priceList: 32 });
  });
  it('sin lista por defecto: 0 como SAPSEND', () => {
    expect(pickPrice(prices, 1, null)).toEqual({ price: 0, source: 'lista', priceList: 1 });
    expect(pickPrice(prices, 99, null)).toEqual({ price: null, source: 'sin_precio', priceList: null });
  });
});
