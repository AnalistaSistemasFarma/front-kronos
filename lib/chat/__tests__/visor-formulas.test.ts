import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { contarFormulasSinCalcular } from '../visor-servidor';

/*
 * 2026-10-24 — «el Excel no se ve» (excel-prueba-visor.xlsx, adjunto 4431 de
 * prod). El libro lo generó openpyxl: guarda la FÓRMULA sin el resultado, y
 * el motor de hojas (que toma el valor guardado) pintaba esas celdas vacías.
 * El servidor ahora las cuenta y el visor abre el PDF de Microsoft.
 */
async function libro(armar: (wb: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  armar(wb);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe('contarFormulasSinCalcular', () => {
  it('cuenta las fórmulas sin resultado guardado (como las deja openpyxl)', async () => {
    const bytes = await libro((wb) => {
      const h = wb.addWorksheet('Ventas');
      h.addRow(['Cant', 'Precio', 'Total']);
      h.addRow([2, 1000, { formula: 'A2*B2' }]);
      h.addRow([3, 2000, { formula: 'A3*B3' }]);
      wb.addWorksheet('Resumen').getCell('A1').value = { formula: 'SUM(Ventas!C2:C3)' } as ExcelJS.CellFormulaValue;
    });
    expect(await contarFormulasSinCalcular(bytes)).toBe(3);
  });

  it('no cuenta las que traen el resultado (lo que guarda Excel) ni las de hojas ocultas', async () => {
    const bytes = await libro((wb) => {
      const h = wb.addWorksheet('Ventas');
      h.addRow([2, 1000, { formula: 'A1*B1', result: 2000 }]);
      const oculta = wb.addWorksheet('Calc', { state: 'hidden' });
      oculta.getCell('A1').value = { formula: '1+1' } as ExcelJS.CellFormulaValue;
    });
    expect(await contarFormulasSinCalcular(bytes)).toBe(0);
  });
});
