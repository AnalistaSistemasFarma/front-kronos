import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import {
  ajustarPaginaUnaDeAncho,
  filasFirmaJefe,
  assertMismoLote,
  elegirOpBatchRecord,
  buildBatchRecordXlsx,
  nombreArchivoBatchRecord,
  parseBatchRecordInput,
  sugerirConcentracion,
  sugerirLoteMp,
} from '../batchRecord';
import { isOtError } from '../rules';
import type { OrdenDetalle } from '../db';

function errorOf(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    if (isOtError(e)) return e;
    throw e;
  }
  throw new Error('no lanzó');
}

function orden(consecutivo: number, abiertaEn: string, extra: Partial<OrdenDetalle> = {}): OrdenDetalle {
  return {
    id: consecutivo, idCompany: 1, consecutivo, producto: 'MEROPENEM 500 mg', itemCode: 'PPMP0503', lote: '2421626', turno: 'MANANA', area: 'Envase y grafado',
    sapOp: { AbsoluteEntry: 14332, DocumentNumber: 14118 }, sapOpDocNum: 14118, estado: 'CERRADA', abiertaEn, abiertaPor: 'Sandra Supervisora',
    cerradaEn: '2026-11-03T19:00:00.000Z', cerradaPor: 'Sandra Supervisora', observacionCierre: null, operarios: [],
    operadores: [{ id: 7, nombre: 'Pepito Pérez', activo: true }], inspector: null, jefe: { id: 'j', name: 'Natalia Velandia' },
    registros: [
      { id: '1', actividad: 'Control de peso', operador: 'Pepito Pérez', usuario: 'Producción Planta', registradoEn: '2026-11-03T12:00:05.000Z', observacion: null, textoLibre: false },
      { id: '2', actividad: 'Otra', operador: 'Pepito Pérez', usuario: 'Producción Planta', registradoEn: '2026-11-03T13:10:00.000Z', observacion: 'Cambio de rollo de agrafes', textoLibre: true },
    ],
    firmas: [],
    vistos: [
      { rol: 'SUPERVISOR', estado: 'dado', designado: null, firma: { rol: 'SUPERVISOR', significado: 'Cerró', nombre: 'Sandra Supervisora', email: 's@x', firmadoEn: '2026-11-03T19:00:00.000Z', contentSha256: 'a', metodo: 'pin_tablet' }, nota: null },
      { rol: 'JEFE_PROD', estado: 'pendiente', designado: 'Natalia Velandia', firma: null, nota: null },
    ],
    siguiente: 'JEFE_PROD', completa: false, idUsuarioSesion: 'u', puedeRegistrar: false, puedeGestionar: true, puedeCerrar: false, puedeVerificar: true,
    abiertaComo: 'SUPERVISOR', cierre: { nombre: 'Sandra Supervisora', como: 'SUPERVISOR', en: '2026-11-03T19:00:00.000Z', metodo: 'pin_tablet', cuentaComoVistoJefe: false },
    puedeVistoOperario: false,
    ...extra,
  } as OrdenDetalle;
}

describe('Bitácora de Proceso · Excel del batch record (2026-11-24)', () => {
  it('sugiere la concentración desde la descripción del producto', () => {
    expect(sugerirConcentracion('MEROPENEM 500 mg')).toBe('500 mg');
    expect(sugerirConcentracion('CEFTRIAXONA 1 g POLVO')).toBe('1 g');
    expect(sugerirConcentracion('VANCOMICINA 500mg/10 mL')).toBe('500 mg/10 mL');
    expect(sugerirConcentracion('AGUA ESTERIL')).toBe('');
    expect(sugerirConcentracion(null)).toBe('');
  });

  it('sugiere el lote de materia prima desde las observaciones de la OP (sin repetir)', () => {
    expect(sugerirLoteMp('0629MP15596 - 8MT2606117-(9.8300)\r0629MP15688 - 8MT2606117- (29.8530)')).toBe('8MT2606117');
    expect(sugerirLoteMp('0629MP1 - L1-(1)\n0629MP2 - L2-(2)')).toBe('L1 / L2');
    expect(sugerirLoteMp('texto libre sin formato')).toBe('');
    expect(sugerirLoteMp(null)).toBe('');
  });

  it('valida el cuerpo: incluye siempre la bitácora base, exige producto y lote, limita largos', () => {
    const ok = parseBatchRecordInput({ ids: [3, 2, 2], producto: ' MEROPENEM ', concentracion: '500 mg', lote: '2421626', op: '14118', loteMp: '8MT2606117' }, 2);
    expect(ok.ids).toEqual([2, 3]);
    expect(ok.producto).toBe('MEROPENEM');
    expect(parseBatchRecordInput({ producto: 'X', lote: 'L', op: '1' }, 5).ids).toEqual([5]);
    expect(errorOf(() => parseBatchRecordInput({ producto: 'X', lote: 'L' }, 1)).message).toMatch(/O\.P\./);
    expect(errorOf(() => parseBatchRecordInput({ producto: '', lote: 'L', op: '1' }, 1)).status).toBe(400);
    expect(errorOf(() => parseBatchRecordInput({ producto: 'X', lote: '', op: '1' }, 1)).status).toBe(400);
    expect(errorOf(() => parseBatchRecordInput({ producto: 'X', lote: 'L', op: '1', loteMp: 'x'.repeat(121) }, 1)).status).toBe(400);
    expect(errorOf(() => parseBatchRecordInput({ producto: 'X', lote: 'L', op: '1', ids: ['a'] }, 1)).status).toBe(400);
    expect(errorOf(() => parseBatchRecordInput(null, 1)).status).toBe(400);
  });

  it('OP del encabezado (2026-11-25): la de la bitácora, la de otra del lote o la de SAP por el lote; nunca adivina', () => {
    const sin = { sapOpDocNum: null, sapOpAbsEntry: null };
    const base = { ...sin, itemCode: 'PPSB0103' };
    expect(elegirOpBatchRecord({ sapOpDocNum: 14212, sapOpAbsEntry: 14426, itemCode: null }, [], null)).toEqual({ op: '14212', absEntry: 14426, origen: 'bitacora' });
    // BP-0094 (sin OP) junto a BP-0096 (con OP 14212), mismo lote.
    expect(elegirOpBatchRecord(base, [sin, { sapOpDocNum: 14212, sapOpAbsEntry: 14426 }], null)).toEqual({ op: '14212', absEntry: 14426, origen: 'lote' });
    const sap = [{ AbsoluteEntry: 14426, DocumentNumber: 14212, ItemNo: 'PPSB0103' }];
    expect(elegirOpBatchRecord(base, [sin], sap)).toEqual({ op: '14212', absEntry: 14426, origen: 'sap' });
    // Varias OP con el lote: la del mismo artículo; si no se puede decidir, vacía.
    const dos = [...sap, { AbsoluteEntry: 1, DocumentNumber: 99, ItemNo: 'PTSB0103' }];
    expect(elegirOpBatchRecord(base, [], dos).op).toBe('14212');
    expect(elegirOpBatchRecord({ ...base, itemCode: null }, [], dos)).toEqual({ op: '', absEntry: null, origen: null });
    expect(elegirOpBatchRecord(base, [], null)).toEqual({ op: '', absEntry: null, origen: null });
  });

  it('firma del jefe de producción al final (2026-11-25): nombre precargado si hay un solo jefe; firma y fecha en blanco', () => {
    const e = { seccion: 1, linea: 2, encabezadoTabla: 3, celda: 4, pie: 5 };
    const [titulo, firma] = filasFirmaJefe([orden(1, '2026-11-03T11:00:00.000Z'), orden(2, '2026-11-03T19:00:00.000Z')], e);
    expect(titulo.celdas[0].texto).toBe('Revisión del jefe de producción');
    expect(firma.celdas.map((c) => c.texto)).toEqual(['Nombre: Natalia Velandia', 'Firma:', 'Fecha:']);
    expect(firma.alto).toBeGreaterThanOrEqual(50);
    // Columnas A–J completas, sin huecos.
    expect(firma.celdas.map((c) => [c.desde, c.hasta])).toEqual([[1, 4], [5, 6], [7, 10]]);
    // Dos jefes distintos: no se adivina el nombre.
    const otro = orden(3, '2026-11-04T11:00:00.000Z', { jefe: { id: 'x', name: 'Otra Persona' } });
    expect(filasFirmaJefe([orden(1, '2026-11-03T11:00:00.000Z'), otro], e)[1].celdas[0].texto).toBe('Nombre: ');
  });

  it('todas las bitácoras del archivo son del mismo lote', () => {
    expect(() => assertMismoLote([orden(1, '2026-11-03T11:00:00.000Z'), orden(2, '2026-11-03T19:00:00.000Z')])).not.toThrow();
    expect(errorOf(() => assertMismoLote([orden(1, '2026-11-03T11:00:00.000Z'), orden(2, '2026-11-03T19:00:00.000Z', { lote: 'OTRO' })])).status).toBe(400);
  });

  it('nombre del archivo con el lote y el rango de bitácoras', () => {
    expect(nombreArchivoBatchRecord('2421626', [12, 9, 10])).toBe('BatchRecord_2421626_BP-0009-BP-0012.xlsx');
    expect(nombreArchivoBatchRecord('24/21 6', [3])).toBe('BatchRecord_24216_BP-0003.xlsx');
  });

  it('genera el Excel sobre la plantilla: encabezado del lote en cada página y bitácoras en orden de apertura', async () => {
    const enc = { producto: 'MEROPENEM', concentracion: '500 mg', lote: '2421626', op: '14118', loteMp: '8MT2606117' };
    const buf = await buildBatchRecordXlsx(enc, [orden(2, '2026-11-03T19:00:00.000Z', { turno: 'TARDE' }), orden(1, '2026-11-03T11:00:00.000Z')], new Date('2026-11-24T16:00:00.000Z'));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws.getCell('B4').value).toBe('MEROPENEM');
    expect(ws.getCell('F4').value).toBe('500 mg');
    expect(ws.getCell('J4').value).toBe('2421626');
    expect(ws.getCell('F6').value).toBe('14118');
    expect(ws.getCell('C7').value).toBe('8MT2606117');
    expect(ws.getCell('C9').value).toBe('BITACORA DE AREA ENVASE Y GRAFADO');
    expect(ws.getCell('C1').value).toBe('BATCH RECORD');
    expect(ws.pageSetup.printTitlesRow).toBe('1:8');
    expect(ws.getImages()).toHaveLength(1); // logo de la plantilla
    expect(String(ws.getCell('A10').value)).toMatch(/^Bitácora BP-0001 · OP 14118 · Turno Mañana/);
    const textos: string[] = [];
    ws.eachRow((row) => row.eachCell((c) => textos.push(String(c.value ?? ''))));
    const todo = textos.join('\n');
    expect(todo.indexOf('BP-0001')).toBeLessThan(todo.indexOf('BP-0002'));
    expect(todo).toContain('Texto libre: Cambio de rollo de agrafes');
    expect(todo).toContain('Registró en SynerLink: Producción Planta');
    expect(todo).not.toContain('(registró:');
    expect(todo).toContain('07:00:05'); // hora del servidor en Colombia (UTC−5)
    expect(todo).toMatch(/Supervisor \(cerró\): Sandra Supervisora — 03\/11\/2026 14:00 \(PIN en tablet\)/);
    expect(todo).toContain('Jefe de producción: pendiente — Natalia Velandia');
    // Bloque de firma antes del pie.
    expect(todo.indexOf('Revisión del jefe de producción')).toBeGreaterThan(todo.lastIndexOf('Vistos buenos'));
    expect(todo.indexOf('Revisión del jefe de producción')).toBeLessThan(todo.indexOf('Generado por SynerLink'));
    expect(ws.pageSetup.printArea).toMatch(/^A1:K\d+$/);
    expect(wb.creator).toBe('SynerLink');
    // Estilos propios agregados al final (no se reescriben los de la plantilla): borde y negrita.
    expect(ws.getCell('A10').font?.bold).toBe(true);
    expect(ws.getCell('A10').border?.top?.style).toBe('thin');
  });

  it('edita el XML de la plantilla sin reescribirla: logo, filas 1–9 y títulos de impresión intactos', async () => {
    const JSZip = (await import('jszip')).default;
    const { BATCH_RECORD_PLANTILLA_BASE64 } = await import('../batchRecordPlantilla');
    const original = await JSZip.loadAsync(Buffer.from(BATCH_RECORD_PLANTILLA_BASE64, 'base64'));
    const enc = { producto: 'A & B <x>', concentracion: '500 mg', lote: 'L1', op: '1', loteMp: 'M1' };
    const salida = await JSZip.loadAsync(await buildBatchRecordXlsx(enc, [orden(1, '2026-11-03T11:00:00.000Z')]));
    // Archivos que no se tocan: idénticos byte a byte.
    for (const p of ['xl/media/image1.jpeg', 'xl/drawings/drawing1.xml', 'xl/theme/theme1.xml', 'xl/printerSettings/printerSettings1.bin']) {
      expect(await salida.file(p)!.async('base64')).toBe(await original.file(p)!.async('base64'));
    }
    const sheet = await salida.file('xl/worksheets/sheet1.xml')!.async('string');
    const sheetOrig = await original.file('xl/worksheets/sheet1.xml')!.async('string');
    // Filas 1–3 (logo, título, información general) idénticas; el texto va escapado.
    const filas13 = (x: string) => /<row r="1"[\s\S]*?<row r="4"/.exec(x)![0];
    expect(filas13(sheet)).toBe(filas13(sheetOrig));
    expect(sheet).toContain('A &amp; B &lt;x&gt;');
    expect(sheet).not.toContain('<sheetProtection');
    expect(sheet).not.toMatch(/<f>/);
    const wbXml = await salida.file('xl/workbook.xml')!.async('string');
    expect(wbXml).toContain("'P-16-1,'!$1:$8");
    expect(wbXml).toMatch(/Print_Area[^>]*>'P-16-1,'!\$A\$1:\$K\$\d+</);
    // Los estilos de la plantilla siguen en su sitio: solo se agregan al final.
    const st = await salida.file('xl/styles.xml')!.async('string');
    const stOrig = await original.file('xl/styles.xml')!.async('string');
    const xfs = (x: string) => /<cellXfs count="(\d+)"/.exec(x)![1];
    expect(Number(xfs(st))).toBe(Number(xfs(stOrig)) + 5);
  });

  it('muchas bitácoras y registros: sigue siendo una sola hoja con el encabezado repetido', async () => {
    const enc = { producto: 'MEROPENEM', concentracion: '500 mg', lote: '2421626', op: '14118', loteMp: '8MT2606117' };
    const registros = Array.from({ length: 60 }, (_, i) => ({
      id: String(i), actividad: i % 3 ? 'Alimentación de tapones' : 'Control de material particulado en frasco vacío', operador: 'Pepito Pérez', usuario: 'Producción Planta',
      registradoEn: new Date(Date.UTC(2026, 10, 3, 11, i)).toISOString(), observacion: i % 7 ? null : 'Observación larga del operario para revisar el alto de la fila en la impresión', textoLibre: false,
    }));
    const ordenes = [1, 2, 3].map((n) => orden(n, `2026-11-0${n}T11:00:00.000Z`, { registros }));
    const buf = await buildBatchRecordXlsx(enc, ordenes);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets).toHaveLength(1);
    expect(wb.worksheets[0].rowCount).toBeGreaterThan(190);
  });

  it('prints one page wide: portrait Letter, fit to 1 page wide and unlimited pages tall (2026-11-25)', async () => {
    const enc = { producto: 'PIPERACILINA Y TAZOBACTAM 4.5g (10 UNID. X PLEGADIZA)', concentracion: '4.5 g', lote: '1271126', op: '14062', loteMp: '' };
    const buf = await buildBatchRecordXlsx(enc, [orden(1, '2026-11-03T11:00:00.000Z')]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ps = wb.worksheets[0].pageSetup;
    expect(ps.orientation).toBe('portrait');
    expect(ps.paperSize).toBe(1);
    expect(ps.fitToPage).toBe(true);
    expect(ps.fitToWidth).toBe(1);
    expect(ps.fitToHeight).toBe(0);
    expect(ps.scale ?? 100).toBe(100); // no fixed 63 % scale anymore
    expect(ps.printTitlesRow).toBe('1:8');
    expect(ps.printArea).toMatch(/^A1:K\d+$/);
    expect(ps.margins?.left).toBeGreaterThan(0);
    expect(ps.margins?.right).toBeGreaterThan(0);

    const JSZip = (await import('jszip')).default;
    const sheet = await (await JSZip.loadAsync(buf)).file('xl/worksheets/sheet1.xml')!.async('string');
    // <sheetPr> is the first child of <worksheet> (schema order) and keeps the printer settings link.
    expect(sheet).toMatch(/<worksheet\b[^>]*><sheetPr><pageSetUpPr fitToPage="1"\/><\/sheetPr><dimension /);
    expect(sheet).toMatch(/<pageSetup paperSize="1" fitToWidth="1" fitToHeight="0" orientation="portrait" r:id="rId1"\/>/);
    expect(sheet).not.toContain('scale="63"');
    expect(sheet.match(/<pageSetup\b/g)).toHaveLength(1);
  });

  it('page fit also works when the sheet already has <sheetPr>', () => {
    const base = '<worksheet xmlns="x"><sheetPr codeName="H"><pageSetUpPr fitToPage="0" autoPageBreaks="0"/></sheetPr><pageMargins left="0" right="0" top="0" bottom="0" header="0" footer="0"/><pageSetup scale="63" orientation="portrait"/></worksheet>';
    const out = ajustarPaginaUnaDeAncho(base);
    expect(out).toContain('<pageSetUpPr autoPageBreaks="0" fitToPage="1"/>');
    expect(out).toContain('<pageSetup paperSize="1" fitToWidth="1" fitToHeight="0" orientation="portrait"/>');
    expect(ajustarPaginaUnaDeAncho('<worksheet><sheetPr codeName="H"/><pageSetup/></worksheet>')).toContain('<sheetPr codeName="H"><pageSetUpPr fitToPage="1"/></sheetPr>');
    expect(ajustarPaginaUnaDeAncho('<worksheet><sheetPr><tabColor rgb="FF000000"/></sheetPr></worksheet>')).toContain('<tabColor rgb="FF000000"/><pageSetUpPr fitToPage="1"/></sheetPr>');
  });
});
