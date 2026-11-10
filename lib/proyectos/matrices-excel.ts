/**
 * MATRICES — lectura y escritura de libros (servidor). Reglas puras en ./matrices-rules.ts.
 *
 * - .xlsx/.xlsm con exceljs (la misma dependencia del visor del chat; si exceljs no puede
 *   abrir un libro hecho con openpyxl, se repara la copia como en lib/chat/visor-servidor.ts).
 * - .csv/.txt con el lector propio (separador autodetectado).
 * - Exportar: una matriz vuelve a .xlsx para descargarla.
 */
import { construirHoja, leerCsv, MATRIZ_MAX_HOJAS, type ColumnaMatriz, type Celda, type HojaMatriz } from './matrices-rules';

export type ResultadoLibro = { ok: true; hojas: HojaMatriz[] } | { ok: false; error: string };

export function esArchivoMatriz(fileName: string): 'xlsx' | 'csv' | null {
  if (/\.(xlsx|xlsm)$/i.test(fileName)) return 'xlsx';
  if (/\.(csv|txt)$/i.test(fileName)) return 'csv';
  return null;
}

/** Grilla cruda (filas × columnas, base 0) de una hoja de exceljs. */
function grillaDeHoja(ws: { eachRow: (o: { includeEmpty: boolean }, cb: (row: unknown, n: number) => void) => void }): unknown[][] {
  const grilla: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    const fila: unknown[] = [];
    (
      row as {
        eachCell: (o: { includeEmpty: boolean }, cb: (cell: { value: unknown }, c: number) => void) => void;
      }
    ).eachCell({ includeEmpty: false }, (cell, c) => {
      fila[c - 1] = cell.value;
    });
    grilla[n - 1] = fila;
  });
  for (let i = 0; i < grilla.length; i += 1) if (!grilla[i]) grilla[i] = [];
  return grilla;
}

async function abrirXlsx(bytes: Uint8Array) {
  const ExcelJS = (await import('exceljs')).default;
  const cargar = async (b: Uint8Array) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(b) as unknown as ArrayBuffer);
    return wb;
  };
  try {
    return await cargar(bytes);
  } catch {
    const { repararXlsxParaExceljs } = await import('../chat/xlsx-reparar');
    const copia = await repararXlsxParaExceljs(bytes).catch(() => null);
    if (!copia || copia.cambios === 0) throw new Error('no se pudo abrir');
    return cargar(copia.bytes);
  }
}

/**
 * Lee un archivo y arma sus hojas. `filaEncabezados` (base 1) aplica a todas las hojas
 * si la persona la indicó; si no, se detecta por hoja.
 */
export async function leerLibro(fileName: string, bytes: Uint8Array, filaEncabezados?: number): Promise<ResultadoLibro> {
  const tipo = esArchivoMatriz(fileName);
  if (!tipo) return { ok: false, error: 'Suba un archivo de Excel (.xlsx) o CSV.' };

  const crudas: { nombre: string; grilla: unknown[][] }[] = [];
  if (tipo === 'csv') {
    const texto = new TextDecoder('utf-8').decode(bytes);
    crudas.push({
      nombre: fileName.replace(/\.(csv|txt)$/i, '').slice(0, 150) || 'Hoja 1',
      grilla: leerCsv(texto),
    });
  } else {
    let wb;
    try {
      wb = await abrirXlsx(bytes);
    } catch {
      return {
        ok: false,
        error: 'No se pudo leer el Excel. Guárdelo de nuevo como .xlsx e intente otra vez.',
      };
    }
    const hojas = wb.worksheets.filter((ws) => ws.state !== 'hidden' && ws.state !== 'veryHidden');
    if (hojas.length > MATRIZ_MAX_HOJAS)
      return {
        ok: false,
        error: `El archivo tiene ${hojas.length} hojas; el máximo es ${MATRIZ_MAX_HOJAS}.`,
      };
    for (const ws of hojas) crudas.push({ nombre: ws.name, grilla: grillaDeHoja(ws as never) });
  }

  const hojas: HojaMatriz[] = [];
  for (const c of crudas) {
    const r = construirHoja(c.nombre, c.grilla, filaEncabezados);
    if (!r.ok) return r;
    if (r.hoja.columnas.length > 0) hojas.push(r.hoja);
  }
  return { ok: true, hojas };
}

/** Exporta las hojas a un .xlsx (descarga desde la grilla). */
export async function exportarXlsx(hojas: { nombre: string; columnas: ColumnaMatriz[]; filas: Celda[][] }[]): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SynerLink';
  const usados = new Set<string>();
  for (const h of hojas) {
    let nombre = h.nombre.replace(/[\\/*?:[\]]/g, ' ').slice(0, 31) || 'Hoja';
    for (let i = 2; usados.has(nombre.toLowerCase()); i += 1) nombre = `${nombre.slice(0, 27)} (${i})`;
    usados.add(nombre.toLowerCase());
    const ws = wb.addWorksheet(nombre);
    ws.addRow(h.columnas.map((c) => c.nombre)).font = { bold: true };
    for (const f of h.filas) ws.addRow(f.map((v) => v ?? null));
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
