import ExcelJS from 'exceljs';
import { SgcError } from '../errors';

/**
 * Lee la PRIMERA hoja de un Excel (.xlsx) como filas de valores (la primera
 * fila es el encabezado). Usa exceljs, que ya está en el proyecto. Solo lee:
 * no evalúa macros ni fórmulas (toma el resultado guardado de la celda).
 */
export const SGC_TRAINING_MAX_XLSX_BYTES = 10 * 1024 * 1024;

export function isXlsx(bytes: Uint8Array): boolean {
  // Un .xlsx es un ZIP: empieza por «PK\x03\x04».
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export async function readFirstSheetRows(bytes: Uint8Array): Promise<unknown[][]> {
  if (!bytes.length) throw new SgcError('El archivo está vacío.');
  if (bytes.length > SGC_TRAINING_MAX_XLSX_BYTES) throw new SgcError('El Excel supera 10 MB.');
  if (!isXlsx(bytes)) throw new SgcError('El archivo de resultados debe ser un Excel (.xlsx) exportado de Microsoft Forms.');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  } catch {
    throw new SgcError('No se pudo leer el Excel: verifique que sea un .xlsx válido.');
  }
  const sheet = wb.worksheets[0];
  if (!sheet) throw new SgcError('El Excel no tiene hojas.');
  const rows: unknown[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as unknown[];
    // exceljs deja la posición 0 vacía (las columnas empiezan en 1).
    rows.push(Array.isArray(values) ? values.slice(1) : []);
  });
  return rows;
}
