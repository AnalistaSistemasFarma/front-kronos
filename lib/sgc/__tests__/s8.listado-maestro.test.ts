import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  SGC_MASTER_LIST_COLUMNS,
  SGC_MASTER_LIST_MAX_ROWS,
  canonicalRows,
  cellText,
  fieldOfHeader,
  getMasterListRowsError,
  masterListFieldLabel,
  normalizeHeader,
  parseListDate,
  parseMasterListTable,
  validateMasterList,
  type SgcMasterListContext,
  type SgcMasterListRawRow,
} from '../masterListImport';
import { SGC_MASTER_LIST_SHEET, buildMasterListTemplate, readMasterListWorkbook } from '../masterListWorkbook';

/**
 * Sprint 8 — importación del LISTADO MAESTRO (Excel de Calidad OLP): formato
 * documentado, lectura de la plantilla, validación por fila (errores y
 * advertencias) y plantilla descargable. Datos de EJEMPLO (Calidad aún no
 * entrega el listado real).
 */
const HEADERS = SGC_MASTER_LIST_COLUMNS.map((c) => c.header);

const ctx = (over: Partial<SgcMasterListContext> = {}): SgcMasterListContext => ({
  guide: { prefix: 'OLP', pattern: '{PREFIJO}-{PROCESO}-{CONSECUTIVO}', sequenceDigits: 2, childPattern: '{CODIGO_PADRE}-{TIPO}{CONSECUTIVO}', childTypeCodes: ['FO', 'IN'], childSequenceDigits: 2 },
  processes: new Map([
    ['GCC', { id: 10, processTypeCode: 'M', idDepartment: 5 }],
    ['DT', { id: 11, processTypeCode: 'E', idDepartment: null }],
  ]),
  documentTypes: new Map([
    ['PR', { id: 100 }],
    ['FO', { id: 101 }],
    ['MA', { id: 102 }],
  ]),
  existing: new Map([['OLP-DT-01', { sequence: 1, processCode: 'DT', processTypeCode: 'E', documentTypeCode: 'MA' }]]),
  today: '2026-10-08',
  ...over,
});
const row = (rowNumber: number, values: SgcMasterListRawRow['values']): SgcMasterListRawRow => ({ rowNumber, values });
const ok = (n: number, code: string, extra: SgcMasterListRawRow['values'] = {}) =>
  row(n, { code, title: `Documento ${code}`, documentTypeCode: 'PR', processCode: 'GCC', versionNumber: '2', effectiveDate: '2024-05-10', ...extra });

describe('SGC · S8 · formato del Excel del listado maestro', () => {
  it('[SGC-REQ-114] reconoce los encabezados sin importar mayúsculas, tildes ni sinónimos; ignora los desconocidos y avisa los obligatorios que faltan', () => {
    expect(normalizeHeader('  Código   del Documento ')).toBe('codigo del documento');
    expect(fieldOfHeader('TÍTULO')).toBe('title');
    expect(fieldOfHeader('Vigente desde')).toBe('effectiveDate');
    expect(fieldOfHeader('Observaciones')).toBeNull();
    expect(masterListFieldLabel('parentCode')).toBe('Código del documento padre');
    const t = parseMasterListTable([
      ['Código', 'Nombre', 'Observaciones', 'Código', 'Proceso'],
      ['OLP-GCC-02', 'Almacenamiento', 'x', 'OTRO', 'GCC'],
      [null, '', undefined],
      ['OLP-GCC-03', { richText: [{ text: 'Recepción ' }, { text: 'técnica' }] }],
    ]);
    expect(t.missingColumns).toEqual(['documentTypeCode', 'versionNumber', 'effectiveDate']);
    expect(t.ignoredHeaders).toEqual(['Observaciones', 'Código']);
    expect(t.rows).toEqual([
      { rowNumber: 2, values: { code: 'OLP-GCC-02', title: 'Almacenamiento', processCode: 'GCC' } },
      { rowNumber: 4, values: { code: 'OLP-GCC-03', title: 'Recepción técnica' } },
    ]);
    expect(parseMasterListTable([]).rows).toEqual([]);
  });

  it('[SGC-REQ-114] lee celdas de texto, número, fecha, fórmula, enlace y texto enriquecido', () => {
    expect(cellText(null)).toBe('');
    expect(cellText(3)).toBe('3');
    expect(cellText(' a ')).toBe('a');
    expect(cellText(new Date(Date.UTC(2024, 4, 10)))).toBe('2024-05-10');
    expect(cellText(new Date('x'))).toBe('');
    expect(cellText({ formula: 'A1', result: 7 })).toBe('7');
    expect(cellText({ text: 'OLP-GCC-02', hyperlink: 'https://x' })).toBe('OLP-GCC-02');
    expect(cellText({ richText: [{ text: 'a' }, {}] })).toBe('a');
    expect(cellText({ error: '#N/A' })).toBe('');
  });

  it('[SGC-REQ-114] fechas: AAAA-MM-DD, DD/MM/AAAA, DD-MM-AAAA y número de serie de Excel; lo demás no es fecha', () => {
    expect(parseListDate('2024-05-10')).toBe('2024-05-10');
    expect(parseListDate('2024-5-1T00:00:00Z')).toBe('2024-05-01');
    expect(parseListDate('10/05/2024')).toBe('2024-05-10');
    expect(parseListDate('1-2-2023')).toBe('2023-02-01');
    expect(parseListDate('45422')).toBe('2024-05-10');
    expect(parseListDate('45422.5')).toBe('2024-05-10');
    expect(parseListDate('31/02/2024')).toBeNull();
    expect(parseListDate('1900-01-01')).toBeNull();
    expect(parseListDate('mayo 2024')).toBeNull();
    expect(parseListDate('')).toBeNull();
  });

  it('[SGC-REQ-114] la API exige filas bien formadas y un máximo de filas', () => {
    expect(getMasterListRowsError(undefined)).toBe('El archivo no tiene filas con datos.');
    expect(getMasterListRowsError([])).toBe('El archivo no tiene filas con datos.');
    expect(getMasterListRowsError(Array.from({ length: SGC_MASTER_LIST_MAX_ROWS + 1 }, (_, i) => ok(i + 2, 'X')))).toContain('máximo 3000');
    expect(getMasterListRowsError([null])).toContain('número');
    expect(getMasterListRowsError([{ rowNumber: 1, values: {} }])).toContain('número');
    expect(getMasterListRowsError([{ rowNumber: 2, values: [] }])).toContain('faltan los valores');
    expect(getMasterListRowsError([{ rowNumber: 2 }])).toContain('faltan los valores');
    expect(getMasterListRowsError([{ rowNumber: 2, values: { otra: 'x' } }])).toContain('columna desconocida «otra»');
    expect(getMasterListRowsError([{ rowNumber: 2, values: { code: 5 } }])).toContain('texto');
    expect(getMasterListRowsError([{ rowNumber: 2, values: { title: 'x'.repeat(1001) } }])).toContain('texto');
    expect(getMasterListRowsError([ok(2, 'OLP-GCC-02')])).toBeNull();
  });

  it('[SGC-REQ-114] la huella de las filas no depende del orden ni de las columnas vacías', () => {
    const a = canonicalRows([ok(3, 'B'), ok(2, 'A')]);
    const b = canonicalRows([ok(2, 'A'), ok(3, 'B')]);
    expect(a).toBe(b);
    expect(canonicalRows([ok(2, 'A', { parentCode: 'P' })])).not.toBe(canonicalRows([ok(2, 'A')]));
  });
});

describe('SGC · S8 · validación del listado maestro por fila', () => {
  it('[SGC-REQ-115] una fila completa y correcta se carga con su código, versión, fecha y consecutivo de la guía', () => {
    const r = validateMasterList([ok(2, 'olp-gcc-02', { confidentiality: 'Pública' }), ok(3, 'OLP-DT-02', { processCode: 'dt', documentTypeCode: 'ma', versionNumber: 'V 1', effectiveDate: '01/02/2023' })], ctx());
    expect(r.summary).toEqual({ total: 2, ok: 2, errors: 0, warnings: 0 });
    expect(r.items[0]).toMatchObject({ code: 'OLP-GCC-02', idProcess: 10, idDocumentType: 100, versionNumber: 2, effectiveDate: '2024-05-10', confidentiality: 'publica', sequence: 2, status: 'ok', errors: [], warnings: [] });
    expect(r.items[1]).toMatchObject({ code: 'OLP-DT-02', idProcess: 11, idDocumentType: 102, versionNumber: 1, effectiveDate: '2023-02-01', sequence: 2 });
  });

  it('[SGC-REQ-115] errores por fila: faltantes, código inválido, repetido o ya existente, tipo o proceso inexistente, versión, fecha futura y confidencialidad', () => {
    const r = validateMasterList(
      [
        row(2, { title: 'Sin código' }),
        ok(3, 'OLP GCC 02'),
        ok(4, 'OLP-GCC-05'),
        ok(5, 'OLP-GCC-05'),
        ok(6, 'OLP-DT-01'),
        ok(7, 'OLP-GCC-06', { documentTypeCode: 'XX', processCode: 'ZZ' }),
        ok(8, 'OLP-GCC-07', { versionNumber: '1.5' }),
        ok(9, 'OLP-GCC-08', { versionNumber: '1000' }),
        ok(10, 'OLP-GCC-09', { effectiveDate: '2099-01-01' }),
        ok(11, 'OLP-GCC-10', { effectiveDate: '32/13/2024' }),
        ok(12, 'OLP-GCC-11', { confidentiality: 'secreto' }),
        ok(13, 'OLP-DT-03', { processCode: 'DT', confidentiality: 'departamento' }),
        ok(14, 'OLP-GCC-12', { title: 'AB' }),
        ok(15, 'OLP-GCC-13', { title: 'T'.repeat(301) }),
        ok(16, 'CON'),
      ],
      ctx()
    );
    const errs = (n: number) => r.items.find((i) => i.rowNumber === n)!.errors.join(' | ');
    expect(errs(2)).toContain('Falta «Código».');
    expect(errs(2)).toContain('Falta «Fecha de vigencia».');
    expect(errs(3)).toContain('solo admite letras');
    expect(errs(4)).toBe('');
    expect(errs(5)).toBe('El código OLP-GCC-05 está repetido (fila 4).');
    expect(errs(6)).toBe('El código OLP-DT-01 ya existe en el SGC de la empresa.');
    expect(errs(7)).toContain('El tipo documental «XX» no existe');
    expect(errs(7)).toContain('El proceso «ZZ» no existe');
    expect(errs(8)).toContain('entero entre 1 y 999');
    expect(errs(9)).toContain('entero entre 1 y 999');
    expect(errs(10)).toBe('La fecha de vigencia 2099-01-01 es futura.');
    expect(r.items.find((i) => i.rowNumber === 10)!.effectiveDate).toBeNull();
    expect(errs(11)).toContain('no es válida (use AAAA-MM-DD');
    expect(errs(12)).toContain('La confidencialidad «secreto» no es válida');
    expect(errs(13)).toContain('necesita que el proceso DT tenga departamento dueño');
    expect(errs(14)).toContain('muy corto');
    expect(errs(15)).toContain('máximo 300');
    expect(errs(16)).toContain('reservado de Windows');
    expect(r.summary.ok).toBe(1);
    expect(r.summary.errors).toBe(14);
  });

  it('[SGC-REQ-115] formatos e instructivos: el padre debe estar en el listado o en el SGC; se avisa si no se indica o si el código no sigue la guía', () => {
    const r = validateMasterList(
      [
        ok(2, 'OLP-GCC-02'),
        ok(3, 'OLP-GCC-02-FO01', { documentTypeCode: 'FO', parentCode: 'OLP-GCC-02' }),
        ok(4, 'OLP-GCC-02-F-2', { documentTypeCode: 'FO', parentCode: 'olp-gcc-02' }),
        ok(5, 'OLP-DT-01-FO01', { documentTypeCode: 'FO', processCode: 'DT', parentCode: 'OLP-DT-01' }),
        ok(6, 'OLP-GCC-99-FO01', { documentTypeCode: 'FO', parentCode: 'OLP-GCC-99' }),
        ok(7, 'OLP-GCC-02-FO03', { documentTypeCode: 'FO' }),
        ok(8, 'OLP-GCC-15', { parentCode: 'OLP-GCC-15' }),
        ok(9, 'GCC-PR-15'),
      ],
      ctx()
    );
    const item = (n: number) => r.items.find((i) => i.rowNumber === n)!;
    expect(item(3)).toMatchObject({ status: 'ok', warnings: [], parentCode: 'OLP-GCC-02', sequence: null });
    expect(item(4)).toMatchObject({ status: 'ok', parentCode: 'OLP-GCC-02' });
    expect(item(4).warnings[0]).toContain('no sigue la guía de codificación');
    expect(item(5)).toMatchObject({ status: 'ok', warnings: [] });
    expect(item(6).errors).toEqual(['El documento padre OLP-GCC-99 no está en el listado ni en el SGC de la empresa.']);
    expect(item(7).warnings).toEqual(['El tipo FO hereda el número de su documento padre: indique el «Código del documento padre» para relacionarlo.']);
    expect(item(8).errors).toEqual(['Un documento no puede ser su propio padre.']);
    expect(item(9)).toMatchObject({ status: 'ok', sequence: null });
    expect(item(9).warnings[0]).toContain('GCC-PR-15 no sigue la guía');
    expect(r.summary.warnings).toBe(3);
  });

  it('[SGC-REQ-115] sin guía de codificación no hay advertencias de código ni consecutivo', () => {
    const r = validateMasterList([ok(2, 'CUALQUIER-COSA-1')], ctx({ guide: null }));
    expect(r.items[0]).toMatchObject({ status: 'ok', warnings: [], sequence: null });
  });
});

describe('SGC · S8 · plantilla descargable y lectura del Excel', () => {
  const catalogs = {
    company: 'ONE LATAM PHARMA',
    processes: [{ code: 'GCC', name: 'Gestión de calidad', processType: 'Misional' }],
    documentTypes: [
      { code: 'PR', name: 'Procedimiento' },
      { code: 'FO', name: 'Formato' },
    ],
  };

  it('[SGC-REQ-114] la plantilla trae la hoja «Listado maestro» solo con encabezados, las instrucciones con ejemplo y los catálogos de la empresa', async () => {
    const buf = await buildMasterListTemplate(catalogs);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(wb.worksheets.map((w) => w.name)).toEqual([SGC_MASTER_LIST_SHEET, 'Instrucciones', 'Catálogos']);
    const data = wb.getWorksheet(SGC_MASTER_LIST_SHEET)!;
    expect(data.rowCount).toBe(1);
    expect((data.getRow(1).values as unknown[]).slice(1)).toEqual(HEADERS);
    const help = wb.getWorksheet('Instrucciones')!;
    expect(String(help.getRow(1).getCell(1).value)).toContain('ONE LATAM PHARMA');
    expect(String(help.getRow(help.rowCount).getCell(1).value)).toBe('OLP-GCC-02-FO01');
    const cat = wb.getWorksheet('Catálogos')!;
    expect(cat.getRow(2).getCell(1).value).toBe('GCC');
    expect(cat.getRow(3).getCell(5).value).toBe('FO');
    // La plantilla vacía no tiene filas que cargar.
    expect((await readMasterListWorkbook(buf)).rows).toEqual([]);
    const custom = new ExcelJS.Workbook();
    await custom.xlsx.load(await buildMasterListTemplate({ ...catalogs, exampleCode: 'OLP-DT-01' }));
    expect(String(custom.getWorksheet('Instrucciones')!.getRow(custom.getWorksheet('Instrucciones')!.rowCount).getCell(1).value)).toBe('OLP-DT-01-FO01');
  });

  it('[SGC-REQ-114] la plantilla llenada se lee como filas del listado (fechas de Excel incluidas); un archivo que no es Excel se rechaza con un mensaje claro', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildMasterListTemplate(catalogs));
    const ws = wb.getWorksheet(SGC_MASTER_LIST_SHEET)!;
    ws.addRow(['OLP-GCC-02', 'Almacenamiento y distribución', 'PR', 'GCC', 3, new Date(Date.UTC(2024, 4, 10)), 'publica', '']);
    ws.addRow(['OLP-GCC-02-FO01', 'Recolección de devoluciones', 'FO', 'GCC', 1, '10/05/2024', '', 'OLP-GCC-02']);
    const table = await readMasterListWorkbook((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    expect(table.missingColumns).toEqual([]);
    expect(table.rows).toEqual([
      { rowNumber: 2, values: { code: 'OLP-GCC-02', title: 'Almacenamiento y distribución', documentTypeCode: 'PR', processCode: 'GCC', versionNumber: '3', effectiveDate: '2024-05-10', confidentiality: 'publica' } },
      { rowNumber: 3, values: { code: 'OLP-GCC-02-FO01', title: 'Recolección de devoluciones', documentTypeCode: 'FO', processCode: 'GCC', versionNumber: '1', effectiveDate: '10/05/2024', parentCode: 'OLP-GCC-02' } },
    ]);
    const v = validateMasterList(table.rows, ctx());
    expect(v.summary).toEqual({ total: 2, ok: 2, errors: 0, warnings: 0 });
    await expect(readMasterListWorkbook(new TextEncoder().encode('no es excel').buffer as ArrayBuffer)).rejects.toThrow('No se pudo leer el archivo');
    // Un libro con otra hoja: se lee la primera.
    const other = new ExcelJS.Workbook();
    other.addWorksheet('Hoja1').addRow(HEADERS);
    other.getWorksheet('Hoja1')!.addRow(['OLP-GCC-04', 'X documento', 'PR', 'GCC', 1, '2024-01-01']);
    expect((await readMasterListWorkbook((await other.xlsx.writeBuffer()) as ArrayBuffer)).rows).toHaveLength(1);
    // Un libro sin hojas.
    const empty = new ExcelJS.Workbook();
    const emptyBuf = (await empty.xlsx.writeBuffer()) as ArrayBuffer;
    await expect(readMasterListWorkbook(emptyBuf)).rejects.toThrow();
  });
});
