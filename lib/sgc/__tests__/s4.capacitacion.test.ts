import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { SgcError } from '../errors';
import {
  SGC_TRAINING_DEFAULT_MIN_PCT,
  detectResultColumns,
  evaluateTrainingResults,
  normalizeHeader,
  normalizeHttpsUrl,
  normalizeTrainingConfig,
  parseScore,
  trainingNeedsJustification,
} from '../training/results';
import { SGC_TRAINING_MAX_XLSX_BYTES, isXlsx, readFirstSheetRows } from '../training/xlsx';

/** Sprint 4 — capacitación: configuración y Excel de resultados de Microsoft Forms (reglas puras). */

const FORMS_ES = ['Id', 'Hora de inicio', 'Hora de finalización', 'Correo electrónico', 'Nombre', 'Total de puntos', 'Comentarios del cuestionario'];
const base = { mode: 'mixta', title: 'Capacitación del procedimiento', videoUrl: 'https://stream.example/v/1', formsUrl: 'https://forms.office.com/r/abc', sessionDate: '2026-10-05', maxScore: 10 };

async function xlsxOf(rows: unknown[][]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hoja1');
  rows.forEach((r) => ws.addRow(r));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe('SGC · S4 · configuración de la capacitación', () => {
  it('[SGC-REQ-058] valida modalidad, enlaces https, fecha, puntaje máximo y nota mínima (80 % por defecto)', () => {
    const cfg = normalizeTrainingConfig({ ...base, instructor: ' Calidad OLP ', notes: '' });
    expect(cfg).toMatchObject({ mode: 'mixta', maxScore: 10, minScorePct: SGC_TRAINING_DEFAULT_MIN_PCT, instructor: 'Calidad OLP', notes: null, sessionDate: '2026-10-05' });
    expect(normalizeTrainingConfig({ ...base, mode: 'video', sessionDate: '', minScorePct: '70' })).toMatchObject({ sessionDate: null, minScorePct: 70 });
    expect(normalizeTrainingConfig({ ...base, mode: 'sesion', videoUrl: '' }).videoUrl).toBeNull();
    const bad: [Record<string, unknown>, RegExp][] = [
      [{ ...base, mode: 'otro' }, /modalidad/],
      [{ ...base, title: 'x' }, /tema/],
      [{ ...base, mode: 'video', videoUrl: '' }, /video/],
      [{ ...base, mode: 'sesion', sessionDate: '' }, /fecha de la sesión/],
      [{ ...base, sessionDate: '05/10/2026' }, /AAAA-MM-DD/],
      [{ ...base, formsUrl: '' }, /Forms/],
      [{ ...base, formsUrl: 'http://forms.office.com/r/abc' }, /https/],
      [{ ...base, videoUrl: 'no es url' }, /no es válido/],
      [{ ...base, maxScore: 0 }, /puntaje máximo/],
      [{ ...base, minScorePct: 120 }, /nota mínima/],
      [{ ...base, instructor: 'x'.repeat(201) }, /máximo 200/],
    ];
    for (const [input, msg] of bad) expect(() => normalizeTrainingConfig(input)).toThrow(msg);
    expect(() => normalizeTrainingConfig(null)).toThrow(SgcError);
    expect(normalizeHttpsUrl('', 'x')).toBeNull();
  });
});

describe('SGC · S4 · Excel de resultados de Forms', () => {
  it('[SGC-REQ-059] reconoce los encabezados de Forms en español e inglés (sin tildes ni mayúsculas) y explica cuáles faltan', () => {
    expect(normalizeHeader('  Correo   Electrónico ')).toBe('correo electronico');
    expect(detectResultColumns(FORMS_ES)).toEqual({ email: 3, score: 5, name: 4, completedAt: 2 });
    expect(detectResultColumns(['ID', 'Start time', 'Completion time', 'Email', 'Name', 'Total points'])).toEqual({ email: 3, score: 5, name: 4, completedAt: 2 });
    expect(detectResultColumns(['Correo', 'Nota'])).toEqual({ email: 0, score: 1, name: null, completedAt: null });
    expect(() => detectResultColumns(['Nombre', 'Total de puntos'])).toThrow(/Correo electrónico/);
    expect(() => detectResultColumns(['Correo', 'Nombre'])).toThrow(/Total de puntos/);
  });

  it('[SGC-REQ-059] lee puntajes numéricos, con coma, «8 / 10» y resultados de fórmula; rechaza lo demás', () => {
    expect(parseScore(8)).toBe(8);
    expect(parseScore('8,5')).toBe(8.5);
    expect(parseScore('9.25')).toBe(9.25);
    expect(parseScore(' 7 / 10 ')).toBe(7);
    expect(parseScore({ result: 6 })).toBe(6);
    for (const v of ['', 'ocho', '1/2/3', '8 / diez', '1.2.3', Number.NaN, null]) expect(parseScore(v)).toBeNull();
  });

  it('[SGC-REQ-059] evalúa contra el alcance y la nota mínima, toma el mejor intento e informa rechazados, faltantes y fuera del alcance', () => {
    const rows: unknown[][] = [
      FORMS_ES,
      [1, 'a', new Date('2026-10-05T14:00:00Z'), 'ANA@olp.co', 'Ana', 7, ''],
      [2, 'a', '2026-10-05', 'ana@olp.co', null, 9, ''],
      [3, 'a', 'x', 'beto@olp.co', 'Beto', '6,5', ''],
      [4, 'a', 'x', { text: 'mailto:caro@olp.co' }, { richText: [{ text: 'Ca' }, { text: 'ro' }] }, 8, ''],
      [5, 'a', 'x', 'externo@otra.co', 'Externo', 10, ''],
      [6, 'a', 'x', 'sin-correo', 'X', 5, ''],
      [7, 'a', 'x', 'eva@olp.co', 'Eva', 'n/a', ''],
      [8, 'a', 'x', 'fer@olp.co', 'Fer', 11, ''],
      [9, 'a', 'x', 'ana@olp.co', 'Ana', 5, ''],
      [],
      ['', '', '', '', '', '', ''],
    ];
    const ev = evaluateTrainingResults(rows, { maxScore: 10, minScorePct: 80, scopeEmails: ['ana@olp.co', 'beto@olp.co', 'caro@olp.co', 'dani@olp.co'] });
    const ana = ev.results.find((r) => r.email === 'ana@olp.co')!;
    expect(ana).toMatchObject({ score: 9, percent: 90, passed: true, attempts: 3, inScope: true, name: 'Ana' });
    expect(ev.results.find((r) => r.email === 'beto@olp.co')).toMatchObject({ score: 6.5, passed: false });
    expect(ev.results.find((r) => r.email === 'caro@olp.co')).toMatchObject({ name: 'Caro', passed: true });
    expect(ev.summary).toMatchObject({ rows: 9, people: 4, inScope: 3, passed: 2, failed: 1, outOfScope: 1, missing: ['dani@olp.co'] });
    expect(ev.summary.rejected.map((r) => r.row)).toEqual([7, 8, 9]);
    expect(ev.summary.rejected[2].reason).toMatch(/supera el máximo/);
    expect(trainingNeedsJustification(ev.summary)).toBe(true);
    const clean = evaluateTrainingResults([['Correo', 'Puntaje'], ['ana@olp.co', 10]], { maxScore: 10, minScorePct: 80, scopeEmails: ['ana@olp.co'] });
    expect(trainingNeedsJustification(clean.summary)).toBe(false);
    expect(() => evaluateTrainingResults([FORMS_ES], { maxScore: 10, minScorePct: 80, scopeEmails: [] })).toThrow(/no tiene respuestas/);
    expect(() => evaluateTrainingResults([FORMS_ES, []], { maxScore: 10, minScorePct: 80, scopeEmails: [] })).toThrow(/no tiene respuestas/);
    expect(() => evaluateTrainingResults(Array.from({ length: 5002 }, () => ['a']), { maxScore: 10, minScorePct: 80, scopeEmails: [] })).toThrow(/5.000/);
  });

  it('[SGC-REQ-059] lee la primera hoja de un .xlsx real (exceljs) y rechaza archivos que no son Excel', async () => {
    const bytes = await xlsxOf([FORMS_ES, [1, 'x', 'y', 'ana@olp.co', 'Ana', 9, '']]);
    expect(isXlsx(bytes)).toBe(true);
    const rows = await readFirstSheetRows(bytes);
    expect(rows[0]).toEqual(FORMS_ES);
    expect(rows[1][3]).toBe('ana@olp.co');
    expect(evaluateTrainingResults(rows, { maxScore: 10, minScorePct: 80, scopeEmails: ['ana@olp.co'] }).summary.passed).toBe(1);
    await expect(readFirstSheetRows(new Uint8Array())).rejects.toThrow(/vacío/);
    await expect(readFirstSheetRows(new TextEncoder().encode('correo,nota\nana@olp.co,9'))).rejects.toThrow(/Excel \(\.xlsx\)/);
    await expect(readFirstSheetRows(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).rejects.toThrow(/No se pudo leer/);
    const big = new Uint8Array(SGC_TRAINING_MAX_XLSX_BYTES + 1);
    await expect(readFirstSheetRows(big)).rejects.toThrow(/10 MB/);
    const empty = new ExcelJS.Workbook();
    const noSheets = new Uint8Array(await empty.xlsx.writeBuffer());
    await expect(readFirstSheetRows(noSheets)).rejects.toThrow(/no tiene hojas/);
  });
});
