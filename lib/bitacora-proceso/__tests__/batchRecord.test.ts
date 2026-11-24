import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import {
  assertMismoLote,
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
    expect(parseBatchRecordInput({ producto: 'X', lote: 'L' }, 5).ids).toEqual([5]);
    expect(errorOf(() => parseBatchRecordInput({ producto: '', lote: 'L' }, 1)).status).toBe(400);
    expect(errorOf(() => parseBatchRecordInput({ producto: 'X', lote: '' }, 1)).status).toBe(400);
    expect(errorOf(() => parseBatchRecordInput({ producto: 'X', lote: 'L', loteMp: 'x'.repeat(121) }, 1)).status).toBe(400);
    expect(errorOf(() => parseBatchRecordInput({ producto: 'X', lote: 'L', ids: ['a'] }, 1)).status).toBe(400);
    expect(errorOf(() => parseBatchRecordInput(null, 1)).status).toBe(400);
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
    expect(String(ws.getCell('A10').value)).toMatch(/^Bitácora BP-0001 · Turno Mañana/);
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
    expect(ws.pageSetup.printArea).toMatch(/^A1:K\d+$/);
    expect(wb.creator).toBe('SynerLink');
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
});
