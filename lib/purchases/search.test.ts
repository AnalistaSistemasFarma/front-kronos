import { describe, expect, it } from 'vitest';
import { PAGE_SIZE, searchPath, searchRows } from './search';

describe('searchPath', () => {
  it('artículos: busca por código o nombre, escapa el texto y pagina', () => {
    const p = searchPath('item', "o'neil", 2);
    expect(p).toContain("contains(ItemCode,'o''neil')");
    expect(p).toContain(`$skip=${2 * PAGE_SIZE}`);
  });
  it('sin texto trae todos (solo el filtro base)', () => {
    expect(searchPath('vendor', '', 0)).toContain("$filter=CardType eq 'cSupplier' and Frozen eq 'tNO'");
    expect(searchPath('vendor', '', 0)).not.toContain('contains(');
  });
  it('cuentas activas de nivel 5 u 8, por código o nombre', () => {
    expect(searchPath('account', 'papel', 0)).toContain(
      "(AccountLevel eq 5 or AccountLevel eq 8) and ActiveAccount eq 'tYES' and (startswith(Code,'papel') or contains(Name,'papel'))"
    );
  });
});

describe('searchRows', () => {
  it('cada fila trae la opción que se aplica al elegir', () => {
    const { rows } = searchRows('vendor', [{ CardCode: 'P01', CardName: 'ACME' }], '', 0);
    expect(rows[0].option).toEqual({ value: 'P01', label: 'P01 · ACME', fill: { LineVendor: 'P01', U_NombreProveedor: 'ACME' } });
  });
  it('normas de reparto: filtra y pagina en memoria', () => {
    const data = Array.from({ length: 60 }, (_, i) => ({ FactorCode: String(1000 + i), FactorDescription: i % 2 ? 'ADMIN' : 'TEC' }));
    const r = searchRows('costing', data, 'tec', 0);
    expect(r.rows).toHaveLength(30);
    expect(r.rows[0].option.value).toBe('1000');
    expect(r.hasMore).toBe(false);
  });
});
