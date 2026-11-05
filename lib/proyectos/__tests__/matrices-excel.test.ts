import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { exportarXlsx, leerLibro } from '../matrices-excel';

/* Matrices (2026-11-05): lectura real de un .xlsx con exceljs, ida y vuelta. */

async function libroDePrueba(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Importaciones');
  ws.addRow(['Matriz de importaciones 2026']);
  ws.addRow([]);
  ws.addRow(['País', 'Proveedor', 'Cantidad', 'Precio', 'Total', 'Llegada']);
  ws.addRow(['México', 'Acme', 10, 2.5, { formula: 'C4*D4', result: 25 }, new Date('2026-11-01T00:00:00Z')]);
  ws.addRow(['Chile', 'Beta', 4, 10, { formula: 'C5*D5', result: 40 }, new Date('2026-12-15T00:00:00Z')]);
  wb.addWorksheet('Oculta').state = 'hidden';
  wb.addWorksheet('Vacía');
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe('leerLibro', () => {
  it('lee el xlsx: detecta encabezados bajo el título, usa el valor de las fórmulas y omite hojas ocultas o vacías', async () => {
    const r = await leerLibro('Matriz.xlsx', await libroDePrueba());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hojas).toHaveLength(1);
    const h = r.hojas[0];
    expect(h.filaEncabezados).toBe(3);
    expect(h.columnas.map((c) => `${c.nombre}:${c.tipo}`)).toEqual([
      'País:texto',
      'Proveedor:texto',
      'Cantidad:numero',
      'Precio:numero',
      'Total:numero',
      'Llegada:fecha',
    ]);
    expect(h.filas[0]).toEqual(['México', 'Acme', 10, 2.5, 25, '2026-11-01']);
  });

  it('lee CSV y rechaza otros formatos', async () => {
    const csv = await leerLibro('datos.csv', new TextEncoder().encode('a;b\n1;x\n2;y\n'));
    expect(csv.ok && csv.hojas[0].filas).toEqual([
      [1, 'x'],
      [2, 'y'],
    ]);
    expect((await leerLibro('foto.png', new Uint8Array([1]))).ok).toBe(false);
    expect((await leerLibro('roto.xlsx', new Uint8Array([1, 2, 3]))).ok).toBe(false);
  });

  it('exportar y volver a leer da lo mismo', async () => {
    const r = await leerLibro('Matriz.xlsx', await libroDePrueba());
    if (!r.ok) throw new Error(r.error);
    const buf = await exportarXlsx(r.hojas);
    const otra = await leerLibro('copia.xlsx', new Uint8Array(buf));
    expect(otra.ok && otra.hojas[0].filas).toEqual(r.hojas[0].filas);
  });
});
