import { describe, expect, it } from 'vitest';
import { agentPatchInstruction, cleanPatch, parseLineCommand, parseNumber, patchContext } from './linePatch';

const rows = [1, 2, 3];

describe('parseLineCommand', () => {
  it('sets the item of a line and remembers it by default', () => {
    const p = parseLineCommand('la línea 2 es PTCZ0111, siempre que este cliente pida cefazolina', rows)!;
    expect(p.cambios).toEqual([{ linea: 2, itemCode: 'PTCZ0111', recordar: true }]);
    expect(p.mensaje).toContain('se recuerda');
  });
  it('does not remember with «solo esta vez»', () => {
    expect(parseLineCommand('Línea 1 = ptpt0121 solo esta vez', rows)!.cambios).toEqual([{ linea: 1, itemCode: 'PTPT0121', recordar: false }]);
  });
  it('removes and includes lines, several commands', () => {
    const p = parseLineCommand('quita la línea 3; incluye la línea 1', rows)!;
    expect(p.cambios).toEqual([{ linea: 3, incluir: false }, { linea: 1, incluir: true }]);
  });
  it('removes a list of lines', () => {
    expect(parseLineCommand('elimina las líneas 1, 2 y 3', rows)!.cambios.map((c) => c.linea)).toEqual([1, 2, 3]);
  });
  it('boxes for all lines or one line', () => {
    expect(parseLineCommand('las cantidades vienen en cajas de 10', rows)!.cambios).toEqual(rows.map((n) => ({ linea: n, factor: 10 })));
    expect(parseLineCommand('la línea 2 viene en cajas de 25', rows)!.cambios).toEqual([{ linea: 2, factor: 25 }]);
  });
  it('quantity and price with Spanish numbers', () => {
    expect(parseLineCommand('la cantidad de la línea 2 es 6.000. El precio de la línea 2 es $ 1.450,5', rows)!.cambios)
      .toEqual([{ linea: 2, cantidad: 6000 }, { linea: 2, precio: 1450.5 }]);
  });
  it('returns null when something is not understood or the line does not exist', () => {
    expect(parseLineCommand('busca un genérico más barato para la línea 2', rows)).toBeNull();
    expect(parseLineCommand('quita la línea 3. y dime algo', rows)).toBeNull();
    expect(parseLineCommand('quita la línea 9', rows)).toBeNull();
    expect(parseLineCommand('', rows)).toBeNull();
  });
});

describe('cleanPatch', () => {
  it('keeps only valid lines and fields', () => {
    const p = cleanPatch({ mensaje: 'ok', cambios: [{ linea: 2, itemCode: 'ptcz0111', factor: '10', recordar: true }, { linea: 7, incluir: false }, { linea: 1, itemCode: 'DROP TABLE x' }, { linea: 3 }] }, rows);
    expect(p).toEqual({ mensaje: 'ok', cambios: [{ linea: 2, itemCode: 'PTCZ0111', factor: 10, recordar: true }] });
  });
  it('tolerates garbage', () => {
    expect(cleanPatch(null, rows)).toEqual({ cambios: [], mensaje: '' });
  });
});

describe('helpers', () => {
  it('parseNumber', () => {
    expect(parseNumber('1.450')).toBe(1450);
    expect(parseNumber('1,450')).toBe(1450);
    expect(parseNumber('0,5')).toBe(0.5);
    expect(parseNumber('x')).toBeNull();
  });
  it('patchContext and instruction', () => {
    const ctx = patchContext([{ row: 2, ItemCode: 'A', ItemDescription: 'X', Quantity: 1, UnitPrice: 2, include: true, match: { confidence: 'media', source: { barcode: '', clientCode: '99', description: 'CEFA', quantity: 1, price: 2 }, candidates: [{ ItemCode: 'A', ItemName: 'X' }] } }]);
    expect(ctx[0]).toMatchObject({ linea: 2, oc: { ref: '99' }, sap: { itemCode: 'A' }, candidatos: ['A X'], incluida: true });
    const t = agentPatchInstruction('Farmalogica', { CardCode: 'C1', CardName: 'Cliente' }, 'la "línea" 2');
    expect(t).toContain('contexto-oferta.json');
    expect(t).not.toMatch(/[«»]/);
  });
});
