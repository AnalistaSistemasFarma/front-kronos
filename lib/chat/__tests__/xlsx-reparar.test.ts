import { readFileSync } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { dibujoConPrefijoXdr, relsConRutasRelativas, repararXlsxParaExceljs, rutaRelativa } from '../xlsx-reparar';
import { leerHojasDeExcel } from '../visor-servidor';

/*
 * 2026-10-26 — «bugs constantes con la previsualización del chat». En prod,
 * los Excel que generan los agentes con openpyxl caían en «Hojas» (422) por
 * tres diferencias de formato que exceljs 4.4 no tolera. Los tres archivos de
 * fixtures/ los generó openpyxl 3.1.5 (el mismo de los agentes) con lo mínimo
 * para reproducir cada falla: una tabla, un gráfico y un comentario.
 */
const fixture = (n: string) => new Uint8Array(readFileSync(path.join(__dirname, 'fixtures', n)));

async function leeExceljs(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  return wb;
}

describe('repararXlsxParaExceljs (libros de openpyxl)', () => {
  it.each([
    ['openpyxl-tabla.xlsx', "reading 'name'"],
    ['openpyxl-grafico.xlsx', "reading 'anchors'"],
    ['openpyxl-comentario.xlsx', "reading 'comments'"],
  ])('%s: exceljs falla con el original y lee la copia reparada', async (archivo, error) => {
    const original = fixture(archivo);
    await expect(leeExceljs(original)).rejects.toThrow(error);
    const { bytes, cambios } = await repararXlsxParaExceljs(original);
    expect(cambios).toBeGreaterThan(0);
    const wb = await leeExceljs(bytes);
    const hoja = wb.worksheets[0];
    expect(hoja.getCell('A2').value).toBe('Gasa');
    expect(hoja.getCell('C3').value).toBe(4500);
  });

  it('un libro que exceljs ya lee no cambia', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('A').getCell('A1').value = 1;
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
    const r = await repararXlsxParaExceljs(bytes);
    expect(r.cambios).toBe(0);
    expect(r.bytes).toBe(bytes);
  });
});

describe('ayudantes de la reparación', () => {
  it('rutaRelativa', () => {
    expect(rutaRelativa('xl/worksheets', 'xl/tables/table1.xml')).toBe('../tables/table1.xml');
    expect(rutaRelativa('xl', 'xl/worksheets/sheet1.xml')).toBe('worksheets/sheet1.xml');
    expect(rutaRelativa('', 'xl/workbook.xml')).toBe('xl/workbook.xml');
  });

  it('relsConRutasRelativas respeta los enlaces externos', () => {
    const xml =
      '<Relationships><Relationship Id="rId1" Type="t" Target="/xl/tables/table1.xml"/>' +
      '<Relationship Id="rId2" Type="hyperlink" Target="/http-no" TargetMode="External"/></Relationships>';
    const r = relsConRutasRelativas(xml, 'xl/worksheets/_rels/sheet1.xml.rels');
    expect(r).toContain('Target="../tables/table1.xml"');
    expect(r).toContain('Target="/http-no" TargetMode="External"');
  });

  it('dibujoConPrefijoXdr solo toca las etiquetas sin prefijo', () => {
    const xml =
      '<?xml version="1.0"?><wsDr xmlns="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">' +
      '<oneCellAnchor><from><col>4</col></from><a:graphic xmlns:a="x"/></oneCellAnchor></wsDr>';
    const r = dibujoConPrefijoXdr(xml);
    expect(r).toContain('<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing">');
    expect(r).toContain('<xdr:oneCellAnchor><xdr:from><xdr:col>4</xdr:col></xdr:from><a:graphic xmlns:a="x"/></xdr:oneCellAnchor></xdr:wsDr>');
    expect(r.startsWith('<?xml')).toBe(true);
    // Un dibujo de Excel (ya con xdr:) no cambia.
    const deExcel = '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"/>';
    expect(dibujoConPrefijoXdr(deExcel)).toBe(deExcel);
  });
});

describe('leerHojasDeExcel', () => {
  it('muestra las hojas de un libro de openpyxl con tabla (antes: 422)', async () => {
    const r = await leerHojasDeExcel(fixture('openpyxl-tabla.xlsx'));
    expect(r.hojas.map((h) => h.nombre)).toEqual(['Items']);
    expect(r.hojas[0].html).toContain('Jeringa');
    expect(r.reparado).toBe(true);
  });

  it('un libro normal se lee sin reparar', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Ventas').addRow(['Total', 10]);
    const r = await leerHojasDeExcel(new Uint8Array(await wb.xlsx.writeBuffer()));
    expect(r.reparado).toBe(false);
    expect(r.hojas[0].html).toContain('Total');
  });

  it('un archivo que no es un Excel sigue fallando (el visor cae al PDF)', async () => {
    await expect(leerHojasDeExcel(new TextEncoder().encode('no soy un zip'))).rejects.toThrow();
  });
});
