/**
 * Plantilla Excel + cargue masivo de filas para los campos de tipo "Tabla" de
 * Solicitudes Generales (ver tableField.ts).
 *
 * - `downloadTableTemplate` genera un .xlsx con una columna por columna de la
 *   tabla (con validación de lista para select/Sí-No) y una hoja de instrucciones.
 * - `parseTableExcelFile` lee un .xlsx diligenciado y lo convierte a TableRow[]
 *   tipadas según la definición de columnas, reportando errores por fila.
 *
 * Se usa solo desde componentes de cliente (exceljs corre en el navegador, igual
 * que en los BulkModal de health-records/articles).
 */

import ExcelJS from 'exceljs';
import {
  TABLE_COLUMN_TYPES,
  isRowEmpty,
  type TableColumn,
  type TableRow,
} from './tableField';

const COLUMN_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  TABLE_COLUMN_TYPES.map((t) => [t.value, t.label])
);

const DATA_SHEET = 'Datos';
const MAX_TEMPLATE_ROWS = 500; // filas con validación de lista en la plantilla

function columnHint(col: TableColumn): string {
  switch (col.type) {
    case 'number':
      return 'Número (sin puntos ni comas de miles)';
    case 'money':
      return 'Moneda: número sin puntos ni símbolos (ej: 400000)';
    case 'date':
      return 'Fecha en formato AAAA-MM-DD (ej: 2026-01-31) o celda de fecha de Excel';
    case 'select':
      return `Solo estos valores: ${(col.options || []).join(' | ')}`;
    case 'yesno':
      return 'Sí o No';
    case 'url':
      return 'Dirección web que empiece por http:// o https://';
    case 'sap_items':
    case 'sap_business_partners':
      return 'Escriba "código - nombre" tal como aparece en el buscador SAP del formulario';
    default:
      return 'Texto libre';
  }
}

/** Genera y descarga la plantilla .xlsx para diligenciar las filas de la tabla. */
export async function downloadTableTemplate(fieldLabel: string, columns: TableColumn[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(DATA_SHEET);

  ws.addRow(columns.map((c) => c.label));
  const header = ws.getRow(1);
  header.font = { bold: true };

  columns.forEach((col, i) => {
    const excelCol = ws.getColumn(i + 1);
    excelCol.width = Math.max(18, col.label.length + 4);
    // Fechas y SAP/URL como texto para que Excel no "ayude" reformateando.
    if (col.type !== 'number' && col.type !== 'money') {
      excelCol.numFmt = '@';
    }

    // Validación de lista para select y Sí/No (límite de Excel: fórmula < 255 chars).
    let listValues: string[] | null = null;
    if (col.type === 'select' && (col.options || []).length > 0) listValues = col.options!;
    if (col.type === 'yesno') listValues = ['Sí', 'No'];
    if (listValues) {
      const formula = `"${listValues.join(',')}"`;
      if (formula.length < 255) {
        for (let r = 2; r <= MAX_TEMPLATE_ROWS; r++) {
          ws.getCell(r, i + 1).dataValidation = {
            type: 'list',
            allowBlank: !col.required,
            formulae: [formula],
            showErrorMessage: true,
            errorTitle: 'Valor inválido',
            error: `Valores permitidos: ${listValues.join(', ')}`,
          };
        }
      }
    }
  });

  const info = wb.addWorksheet('Instrucciones');
  info.addRow(['Columna', 'Tipo', 'Obligatoria', 'Cómo diligenciarla']);
  info.getRow(1).font = { bold: true };
  columns.forEach((c) => {
    info.addRow([
      c.label,
      COLUMN_TYPE_LABELS[c.type] || c.type,
      c.required ? 'Sí' : 'No',
      columnHint(c),
    ]);
  });
  info.addRow([]);
  info.addRow([
    `Diligencie la hoja "${DATA_SHEET}" (una fila por registro, sin cambiar los encabezados) y cárguela con el botón "Cargar Excel".`,
  ]);
  info.columns.forEach((c) => {
    c.width = 40;
  });

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `plantilla-${fieldLabel.replace(/[^\w\dáéíóúñÁÉÍÓÚÑ -]/gi, '').trim() || 'tabla'}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

/** Valor crudo de una celda de exceljs → string plano. */
function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const obj = value as unknown as Record<string, unknown>;
    if ('text' in obj) return String(obj.text).trim(); // rich text / hipervínculo
    if ('result' in obj) return String(obj.result ?? '').trim(); // fórmula
    if ('hyperlink' in obj) return String(obj.hyperlink).trim();
  }
  return String(value).trim();
}

function parseNumberCell(value: ExcelJS.CellValue): number | null {
  if (typeof value === 'number') return value;
  const s = cellToString(value);
  if (!s) return null;
  // Acepta "1.234.567,89" (es-CO) y "1234567.89".
  const cleaned = /,\d+$/.test(s)
    ? s.replace(/\./g, '').replace(',', '.')
    : s.replace(/,/g, '');
  const n = Number(cleaned.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

function parseDateCell(value: ExcelJS.CellValue): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = cellToString(value);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // dd/mm/aaaa o dd-mm-aaaa (formato local)
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return 'invalid';
}

export interface TableExcelResult {
  rows: TableRow[];
  errors: string[];
}

/**
 * Lee un .xlsx diligenciado con la plantilla y devuelve las filas tipadas.
 * Las columnas se emparejan por ETIQUETA (insensible a mayúsculas/tildes); las
 * filas totalmente vacías se ignoran; los valores inválidos generan errores con
 * número de fila y NO se cargan (la fila válida parcial tampoco, para no meter
 * datos a medias).
 */
export async function parseTableExcelFile(
  file: File,
  columns: TableColumn[]
): Promise<TableExcelResult> {
  const errors: string[] = [];
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch {
    return { rows: [], errors: ['No se pudo leer el archivo. Use la plantilla .xlsx descargada.'] };
  }

  const ws = wb.getWorksheet(DATA_SHEET) || wb.worksheets[0];
  if (!ws) return { rows: [], errors: ['El archivo no tiene hojas.'] };

  // Encabezado → columna definida
  const byLabel = new Map(columns.map((c) => [normalize(c.label), c]));
  const colAt: (TableColumn | null)[] = [];
  ws.getRow(1).eachCell((cell, colNumber) => {
    colAt[colNumber] = byLabel.get(normalize(cellToString(cell.value))) || null;
  });

  const matched = new Set(colAt.filter(Boolean).map((c) => (c as TableColumn).key));
  if (matched.size === 0) {
    return {
      rows: [],
      errors: ['Los encabezados del archivo no coinciden con las columnas de la tabla. Use la plantilla.'],
    };
  }

  const rows: TableRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const excelRow = ws.getRow(r);
    const row: TableRow = {};
    const rowErrors: string[] = [];

    excelRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const col = colAt[colNumber];
      if (!col) return;
      const raw = cell.value;
      const asString = cellToString(raw);
      if (!asString && typeof raw !== 'number' && typeof raw !== 'boolean') return;

      switch (col.type) {
        case 'number':
        case 'money': {
          const n = parseNumberCell(raw);
          if (n === null) return;
          if (Number.isNaN(n)) {
            rowErrors.push(`Fila ${r}: "${col.label}" no es un número válido (${asString})`);
          } else {
            row[col.key] = n;
          }
          break;
        }
        case 'date': {
          const d = parseDateCell(raw);
          if (d === null) return;
          if (d === 'invalid') {
            rowErrors.push(`Fila ${r}: "${col.label}" no es una fecha válida (${asString})`);
          } else {
            row[col.key] = d;
          }
          break;
        }
        case 'select': {
          const match = (col.options || []).find((o) => normalize(o) === normalize(asString));
          if (match) {
            row[col.key] = match;
          } else {
            rowErrors.push(
              `Fila ${r}: "${col.label}" debe ser uno de: ${(col.options || []).join(', ')} (recibido: ${asString})`
            );
          }
          break;
        }
        case 'yesno': {
          const v = normalize(asString);
          if (raw === true || ['si', 'sí', 'yes', 'true', '1', 'x'].includes(v)) {
            row[col.key] = true;
          } else if (raw === false || ['no', 'false', '0'].includes(v)) {
            row[col.key] = false;
          } else {
            rowErrors.push(`Fila ${r}: "${col.label}" debe ser Sí o No (recibido: ${asString})`);
          }
          break;
        }
        case 'url': {
          if (!/^https?:\/\/\S+$/i.test(asString)) {
            rowErrors.push(
              `Fila ${r}: "${col.label}" debe ser una URL que empiece por http:// o https:// (recibido: ${asString})`
            );
          } else {
            row[col.key] = asString;
          }
          break;
        }
        default:
          row[col.key] = asString;
      }
    });

    if (isRowEmpty(row, columns) && rowErrors.length === 0) continue;

    // Columnas obligatorias vacías en filas con datos
    for (const col of columns) {
      if (!matched.has(col.key)) continue;
      const v = row[col.key];
      const empty = v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
      if (col.required && empty && !rowErrors.some((e) => e.includes(`"${col.label}"`))) {
        rowErrors.push(`Fila ${r}: "${col.label}" es obligatoria y está vacía`);
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
    } else {
      rows.push(row);
    }
  }

  return { rows, errors };
}
