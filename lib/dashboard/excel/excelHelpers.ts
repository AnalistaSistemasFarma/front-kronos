import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import type { DashboardDateFilter } from '../dateRange';
import { getFilterLabel, getPeriodRangeLabel } from '../dateRange';

const HEADER_FILL = 'FF113562';
const HEADER_FONT = 'FFFFFFFF';
const SUBTITLE_FILL = 'FFE8F4FC';

export type ExportMeta = {
  module: string;
  dateFilter: DashboardDateFilter;
  selectedMonthDate: Date;
  appliedRange?: string | null;
  /** Cuando es global, el Excel incluye todo el histórico sin filtro de fechas del dashboard. */
  exportScope?: 'global' | 'screen';
  recordCount?: number;
  extra?: { label: string; value: string }[];
};

export async function downloadWorkbook(workbook: ExcelJS.Workbook, filename: string): Promise<void> {
  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename
  );
}

export function stampFilename(
  prefix: string,
  dateFilterOrScope: DashboardDateFilter | 'global'
): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const suffix =
    dateFilterOrScope === 'global'
      ? 'historico-completo'
      : getFilterLabel(dateFilterOrScope);
  return `${prefix}-${suffix}-${stamp}.xlsx`;
}

export function styleHeaderRow(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_FONT }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };
  });
  row.height = 24;
}

export type ResumenSheetResult = {
  sheet: ExcelJS.Worksheet;
  /** Primera fila libre tras el bloque de metadatos (incluye una fila en blanco). */
  contentStartRow: number;
};

export function buildResumenSheet(
  workbook: ExcelJS.Workbook,
  meta: ExportMeta
): ResumenSheetResult {
  const ws = workbook.addWorksheet('Resumen', {
    views: [{ showGridLines: true }],
    properties: { defaultRowHeight: 18 },
  });

  ws.mergeCells('A1:F1');
  const title = ws.getCell('A1');
  title.value = `Dashboard Kronos — ${meta.module}`;
  title.font = { bold: true, size: 16, color: { argb: HEADER_FILL } };
  title.alignment = { vertical: 'middle' };
  ws.getRow(1).height = 28;

  let row = 3;
  const isGlobal = meta.exportScope === 'global';
  const metaLines = isGlobal
    ? [
        { label: 'Módulo', value: meta.module },
        { label: 'Alcance exportación', value: 'Histórico completo (todos los registros)' },
        {
          label: 'Registros exportados',
          value: meta.recordCount != null ? meta.recordCount.toLocaleString('es-CO') : '—',
        },
        {
          label: 'Filtro en pantalla',
          value: `${getFilterLabel(meta.dateFilter)}${
            meta.appliedRange ? ` (${meta.appliedRange})` : ''
          }`,
        },
        {
          label: 'Nota',
          value:
            'Este archivo incluye todos los años disponibles; el periodo del dashboard no limita los datos exportados.',
        },
        { label: 'Generado', value: new Date().toLocaleString('es-CO') },
        ...(meta.extra ?? []),
      ]
    : [
        { label: 'Módulo', value: meta.module },
        { label: 'Periodo', value: getFilterLabel(meta.dateFilter) },
        {
          label: 'Rango',
          value: meta.appliedRange ?? getPeriodRangeLabel(meta.dateFilter, meta.selectedMonthDate),
        },
        { label: 'Generado', value: new Date().toLocaleString('es-CO') },
        ...(meta.extra ?? []),
      ];

  metaLines.forEach(({ label, value }) => {
    ws.getCell(`A${row}`).value = label;
    ws.getCell(`A${row}`).font = { bold: true };
    ws.getCell(`B${row}`).value = value;
    ws.mergeCells(`B${row}:F${row}`);
    row += 1;
  });

  ws.getColumn(1).width = 22;
  ws.getColumn(2).width = 36;
  return { sheet: ws, contentStartRow: row + 1 };
}

export function writeSectionTitle(ws: ExcelJS.Worksheet, row: number, title: string): number {
  ws.mergeCells(`A${row}:F${row}`);
  const cell = ws.getCell(`A${row}`);
  cell.value = title;
  cell.font = { bold: true, size: 12, color: { argb: 'FF1E293B' } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUBTITLE_FILL } };
  ws.getRow(row).height = 22;
  return row + 1;
}

export function writeIndicatorTable(
  ws: ExcelJS.Worksheet,
  startRow: number,
  title: string,
  rows: { label: string; value: string | number }[]
): number {
  let r = writeSectionTitle(ws, startRow, title);
  const header = ws.getRow(r);
  header.getCell(1).value = 'Indicador';
  header.getCell(2).value = 'Valor';
  styleHeaderRow(header);
  r += 1;

  rows.forEach(({ label, value }) => {
    const dataRow = ws.getRow(r);
    dataRow.getCell(1).value = label;
    dataRow.getCell(2).value = value;
    dataRow.getCell(1).alignment = { wrapText: true };
    r += 1;
  });

  return r + 1;
}

export function writeDistributionTable(
  ws: ExcelJS.Worksheet,
  startRow: number,
  title: string,
  items: { label: string; count: number }[],
  total: number
): number {
  if (items.length === 0) return startRow;

  let r = writeSectionTitle(ws, startRow, title);
  const header = ws.getRow(r);
  ['Concepto', 'Cantidad', '% del total', 'Barra (referencia)'].forEach((text, i) => {
    header.getCell(i + 1).value = text;
  });
  styleHeaderRow(header);
  r += 1;

  const firstDataRow = r;
  const lastDataRow = r + items.length - 1;

  items.forEach((item) => {
    const dataRow = ws.getRow(r);
    dataRow.getCell(1).value = item.label;
    dataRow.getCell(2).value = item.count;
    dataRow.getCell(2).numFmt = '#,##0';
    dataRow.getCell(3).value = total > 0 ? item.count / total : 0;
    dataRow.getCell(3).numFmt = '0.0%';
    dataRow.getCell(4).value = {
      formula: `REPT("█",MAX(1,ROUND(B${r}/MAX(B$${firstDataRow}:B$${lastDataRow},1)*18,0)))`,
    };
    r += 1;
  });

  ws.getColumn(4).width = 24;
  return r + 1;
}

export function writeRankingTable(
  ws: ExcelJS.Worksheet,
  startRow: number,
  title: string,
  items: { name: string; value: number }[],
  valueHeader = 'Cantidad'
): number {
  if (items.length === 0) return startRow;

  let r = writeSectionTitle(ws, startRow, title);
  const header = ws.getRow(r);
  header.getCell(1).value = 'Nombre';
  header.getCell(2).value = valueHeader;
  styleHeaderRow(header);
  r += 1;

  const firstDataRow = r;
  const lastDataRow = r + items.length - 1;

  items.forEach((item) => {
    const dataRow = ws.getRow(r);
    dataRow.getCell(1).value = item.name;
    dataRow.getCell(2).value = item.value;
    dataRow.getCell(2).numFmt = '#,##0';
    dataRow.getCell(3).value = {
      formula: `REPT("█",MAX(1,ROUND(B${r}/MAX(B$${firstDataRow}:B$${lastDataRow},1)*18,0)))`,
    };
    r += 1;
  });

  ws.getColumn(3).width = 24;
  return r + 1;
}

export function addDataSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  columns: { header: string; key: string; width?: number }[],
  rows: Record<string, unknown>[]
): ExcelJS.Worksheet {
  const ws = workbook.addWorksheet(sheetName);
  ws.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width ?? 16,
  }));

  const headerRow = ws.getRow(1);
  styleHeaderRow(headerRow);

  rows.forEach((row) => {
    const entry: Record<string, unknown> = {};
    columns.forEach((col) => {
      entry[col.key] = row[col.key] ?? '';
    });
    ws.addRow(entry);
  });

  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, rows.length + 1), column: columns.length },
  };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return ws;
}
