import ExcelJS from 'exceljs';
import { SGC_MASTER_LIST_COLUMNS, parseMasterListTable, type SgcMasterListTable } from './masterListImport';

/**
 * Plantilla y lectura del Excel del LISTADO MAESTRO (Sprint 8). Usa ExcelJS,
 * igual que el cargue masivo de SynerLink (Registros sanitarios); corre en el
 * navegador (la persona elige el archivo) y en las pruebas.
 */

export const SGC_MASTER_LIST_SHEET = 'Listado maestro';
export const SGC_MASTER_LIST_TEMPLATE_NAME = 'plantilla-listado-maestro-sgc.xlsx';

export interface SgcTemplateCatalogs {
  company: string;
  processes: { code: string; name: string; processType: string }[];
  documentTypes: { code: string; name: string }[];
  /** Ejemplo de código según la guía (solo se muestra en las instrucciones). */
  exampleCode?: string | null;
}

/**
 * Plantilla: hoja «Listado maestro» SOLO con los encabezados (las filas de
 * ejemplo van en «Instrucciones», para que no se carguen por error) y la hoja
 * «Catálogos» con los códigos de procesos y tipos documentales de la empresa.
 */
export async function buildMasterListTemplate(catalogs: SgcTemplateCatalogs): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SynerLink · SGC documental';
  const data = wb.addWorksheet(SGC_MASTER_LIST_SHEET);
  data.addRow(SGC_MASTER_LIST_COLUMNS.map((c) => c.header));
  data.getRow(1).font = { bold: true };
  data.columns.forEach((col, i) => {
    col.width = [18, 50, 22, 16, 10, 18, 18, 26][i] ?? 18;
  });
  data.views = [{ state: 'frozen', ySplit: 1 }];

  const help = wb.addWorksheet('Instrucciones');
  help.addRow([`Listado maestro de documentos internos · ${catalogs.company}`]).font = { bold: true, size: 13 };
  help.addRow(['Llene la hoja «Listado maestro»: una fila por documento vigente. La fila 1 son los encabezados y no se cambia.']);
  help.addRow(['Cada documento queda «pendiente de archivo» con su código; el PDF se carga después. El código no se puede cambiar una vez cargado.']);
  help.addRow([]);
  help.addRow(['Columna', 'Obligatoria', 'Qué escribir']).font = { bold: true };
  for (const c of SGC_MASTER_LIST_COLUMNS) help.addRow([c.header, c.required ? 'Sí' : 'No', c.help]);
  help.addRow([]);
  help.addRow(['Ejemplo (no se carga desde esta hoja)']).font = { bold: true };
  help.addRow(SGC_MASTER_LIST_COLUMNS.map((c) => c.header)).font = { italic: true };
  const ex = catalogs.exampleCode || 'OLP-GCC-02';
  help.addRow([ex, 'Almacenamiento y distribución de producto acondicionado', 'PR', 'GCC', 3, '2024-05-10', 'publica', '']);
  help.addRow([`${ex}-FO01`, 'Formato de recolección de devoluciones', 'FO', 'GCC', 1, '2024-05-10', 'publica', ex]);
  help.columns.forEach((col, i) => {
    col.width = [30, 50, 80][i] ?? 20;
  });

  const cat = wb.addWorksheet('Catálogos');
  cat.addRow(['Procesos (código)', 'Nombre', 'Tipo de proceso', '', 'Tipos documentales (código)', 'Nombre']).font = { bold: true };
  const n = Math.max(catalogs.processes.length, catalogs.documentTypes.length);
  for (let i = 0; i < n; i++) {
    const p = catalogs.processes[i];
    const t = catalogs.documentTypes[i];
    cat.addRow([p?.code ?? '', p?.name ?? '', p?.processType ?? '', '', t?.code ?? '', t?.name ?? '']);
  }
  cat.columns.forEach((col, i) => {
    col.width = [18, 45, 22, 4, 26, 30][i] ?? 18;
  });
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

/**
 * Lee el Excel: la hoja «Listado maestro» (o la primera) como tabla y la
 * convierte en filas del listado.
 */
export async function readMasterListWorkbook(buffer: ArrayBuffer): Promise<SgcMasterListTable> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new Error('No se pudo leer el archivo: use la plantilla del listado maestro en formato Excel (.xlsx).');
  }
  const ws = wb.getWorksheet(SGC_MASTER_LIST_SHEET) ?? wb.worksheets[0];
  if (!ws) throw new Error('El archivo no tiene hojas.');
  const table: unknown[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: unknown[] = [];
    for (let c = 1; c <= ws.columnCount; c++) cells.push(row.getCell(c).value);
    table.push(cells);
  }
  return parseMasterListTable(table);
}
