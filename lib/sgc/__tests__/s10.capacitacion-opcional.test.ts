import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { normalizeFlowDefinition } from '../flows/definition';
import { SGC_DOCUMENT_FLOW_TRAINING_FIRST } from '../flows/documentFlow';
import { evaluateCondition, resolveNextStep } from '../flows/engine';
import { pendingGroupOf } from '../pendings';
import { effectiveRequiresTraining, parseTrainingChoice, trainingFlagSource } from '../training/flag';
import { SGC_EVALUATION_HOSTS, attemptTime, evaluateTrainingResults, evaluationProviderOf, normalizeTrainingConfig } from '../training/results';
import { parseCsv, readTrainingRows } from '../training/xlsx';

/**
 * Sprint 10 — capacitación OPCIONAL por solicitud y preparada ANTES de la
 * divulgación; evaluación solo en Microsoft Forms o Google Forms (también su
 * exportación); 2 intentos y recapacitación.
 */

describe('SGC · S10 · capacitación opcional por solicitud', () => {
  it('[SGC-REQ-122] la sugiere el solicitante, la confirma quien crea el documento o Calidad; sin nada, manda el tipo documental', () => {
    expect(effectiveRequiresTraining({ confirmed: false, suggested: true, typeDefault: true })).toBe(false);
    expect(effectiveRequiresTraining({ confirmed: null, suggested: false, typeDefault: true })).toBe(false);
    expect(effectiveRequiresTraining({ confirmed: null, suggested: null, typeDefault: false })).toBe(false);
    expect(effectiveRequiresTraining({ confirmed: undefined, suggested: undefined, typeDefault: undefined })).toBe(true);
    expect(trainingFlagSource({ confirmed: true, suggested: null, typeDefault: false })).toBe('confirmada');
    expect(trainingFlagSource({ confirmed: null, suggested: true, typeDefault: false })).toBe('sugerida');
    expect(trainingFlagSource({ confirmed: null, suggested: null, typeDefault: false })).toBe('tipo');
    expect([true, 'si', 'sí', 'true'].map(parseTrainingChoice)).toEqual([true, true, true, true]);
    expect([false, 'no', 'false'].map(parseTrainingChoice)).toEqual([false, false, false]);
    expect(['tipo', undefined, null, 1].map(parseTrainingChoice)).toEqual([null, null, null, null]);
  });

  it('[SGC-REQ-123] flujo con capacitación previa: aprobación → preparación del material → divulgación → capacitación; sin capacitación se salta la preparación y la capacitación', () => {
    const def = normalizeFlowDefinition(SGC_DOCUMENT_FLOW_TRAINING_FIRST);
    expect(def.tasks.map((t) => [t.key, t.stepOrder])).toEqual([
      ['solicitud', 0],
      ['elaboracion', 1],
      ['revision', 2],
      ['aprobacion', 3],
      ['preparacion_capacitacion', 4],
      ['divulgacion', 5],
      ['capacitacion', 6],
    ]);
    const con = { requestType: 'nuevo', requiresTraining: true };
    const sin = { requestType: 'nuevo', requiresTraining: false };
    expect(resolveNextStep(def, 'aprobacion', 'aprobar', con)).toMatchObject({ kind: 'task', task: { key: 'preparacion_capacitacion', role: 'material' } });
    expect(resolveNextStep(def, 'preparacion_capacitacion', 'aprobar', con)).toMatchObject({ kind: 'task', task: { key: 'divulgacion' } });
    expect(resolveNextStep(def, 'divulgacion', 'aprobar', con)).toMatchObject({ kind: 'task', task: { key: 'capacitacion' } });
    expect(resolveNextStep(def, 'aprobacion', 'aprobar', sin)).toMatchObject({ kind: 'task', task: { key: 'divulgacion' } });
    expect(resolveNextStep(def, 'divulgacion', 'aprobar', sin)).toEqual({ kind: 'terminal', status: 'completada' });
    expect(evaluateCondition('requiere_capacitacion', con)).toBe(true);
    expect(evaluateCondition('requiere_capacitacion', sin)).toBe(false);
    expect(pendingGroupOf({ role: 'material', taskKey: 'preparacion_capacitacion', isAuthorization: true })).toBe('capacitaciones');
  });
});

describe('SGC · S10 · evaluación en Microsoft Forms o Google Forms', () => {
  const base = { mode: 'video', title: 'Capacitación del formato', videoUrl: 'https://www.youtube.com/watch?v=x', maxScore: 10 };

  it('[SGC-REQ-124] solo se aceptan enlaces de Microsoft Forms o Google Forms; se guarda el proveedor y el máximo de intentos (2 por defecto)', () => {
    expect(evaluationProviderOf('https://forms.office.com/r/abc')).toBe('microsoft');
    expect(evaluationProviderOf('https://forms.cloud.microsoft/r/abc')).toBe('microsoft');
    expect(evaluationProviderOf('https://docs.google.com/forms/d/e/1FAIp/viewform')).toBe('google');
    expect(evaluationProviderOf('https://forms.gle/AbC123')).toBe('google');
    expect(evaluationProviderOf('https://docs.google.com/document/d/1')).toBeNull();
    expect(evaluationProviderOf('https://www.surveymonkey.com/r/x')).toBeNull();
    expect(evaluationProviderOf('no es url')).toBeNull();
    expect(SGC_EVALUATION_HOSTS.google).toContain('forms.gle');
    expect(normalizeTrainingConfig({ ...base, formsUrl: 'https://forms.office.com/r/abc' })).toMatchObject({ evaluationProvider: 'microsoft', maxAttempts: 2 });
    expect(normalizeTrainingConfig({ ...base, formsUrl: 'https://docs.google.com/forms/d/e/x/viewform', maxAttempts: 3 })).toMatchObject({ evaluationProvider: 'google', maxAttempts: 3 });
    expect(() => normalizeTrainingConfig({ ...base, formsUrl: 'https://kahoot.it/x' })).toThrow(/Microsoft Forms o en Google Forms/);
    expect(() => normalizeTrainingConfig({ ...base, formsUrl: 'https://forms.office.com/r/abc', maxAttempts: 0 })).toThrow(/entre 1 y 5/);
    expect(() => normalizeTrainingConfig({ ...base, formsUrl: 'https://forms.office.com/r/abc', maxAttempts: 1.5 })).toThrow(/entre 1 y 5/);
    expect(() => normalizeTrainingConfig({ ...base, formsUrl: '' })).toThrow(/Google Forms/);
  });

  it('[SGC-REQ-125] lee la exportación de Google Forms («Marca temporal», «Dirección de correo electrónico», «Puntuación» 8 / 10) en Excel o CSV', async () => {
    const rows = [
      ['Marca temporal', 'Dirección de correo electrónico', 'Puntuación', 'Nombre'],
      ['8/10/2026 10:15:00', 'a@olp.co', '9 / 10', 'Ana'],
      ['8/10/2026 10:20:00', 'b@olp.co', '6 / 10', 'Beto'],
    ];
    const r = evaluateTrainingResults(rows, { maxScore: 10, minScorePct: 80, scopeEmails: ['a@olp.co', 'b@olp.co'], maxAttempts: 2 });
    expect(r.results.map((x) => [x.email, x.score, x.passed, x.attemptNumber, x.retrainingRequired])).toEqual([
      ['a@olp.co', 9, true, 1, false],
      ['b@olp.co', 6, false, 1, false],
    ]);
    const csv = 'Marca temporal,Dirección de correo electrónico,Puntuación\r\n"8/10/2026 10:15:00",a@olp.co,"9 / 10"\r\n';
    expect(parseCsv(csv)).toEqual([['Marca temporal', 'Dirección de correo electrónico', 'Puntuación'], ['8/10/2026 10:15:00', 'a@olp.co', '9 / 10']]);
    expect(parseCsv('﻿a;b\n"x;y";"di ""hola"""\n\n"multi\nlínea";z')).toEqual([['a', 'b'], ['x;y', 'di "hola"'], ['multi\nlínea', 'z']]);
    expect(await readTrainingRows(new TextEncoder().encode(csv), 'respuestas.csv')).toHaveLength(2);
    await expect(readTrainingRows(new Uint8Array(), 'r.csv')).rejects.toThrow(/vacío/);
    await expect(readTrainingRows(new Uint8Array(10 * 1024 * 1024 + 1), 'r.csv')).rejects.toThrow(/10 MB/);
    await expect(readTrainingRows(new Uint8Array([0x50, 0x4b, 3, 4, 0]), 'r.csv')).rejects.toThrow(/es un Excel/);
    const wb = new ExcelJS.Workbook();
    rows.forEach((x) => (wb.getWorksheet('G') ?? wb.addWorksheet('G')).addRow(x));
    expect(await readTrainingRows(new Uint8Array(await wb.xlsx.writeBuffer()), 'respuestas.xlsx')).toHaveLength(3);
    await expect(readTrainingRows(new TextEncoder().encode('x'), 'r.xlsx')).rejects.toThrow(/CSV exportado de Microsoft Forms o Google Forms/);
  });
});

describe('SGC · S10 · dos intentos y recapacitación', () => {
  const HEAD = ['Correo electrónico', 'Total de puntos', 'Hora de finalización'];
  it('[SGC-REQ-126] cuentan los dos primeros intentos (en orden de respuesta); el tercero no cuenta y quien no aprobó queda en recapacitación', () => {
    const rows = [
      HEAD,
      ['c@olp.co', 10, '2026-10-08T12:00:00Z'], // tercer intento (más tardío): no cuenta
      ['c@olp.co', 5, '2026-10-08T10:00:00Z'],
      ['c@olp.co', 6, '2026-10-08T11:00:00Z'],
      ['d@olp.co', 6, '2026-10-08T10:00:00Z'],
      ['d@olp.co', 9, '2026-10-08T11:00:00Z'],
      ['e@olp.co', 4, '2026-10-08T10:00:00Z'],
    ];
    const r = evaluateTrainingResults(rows, { maxScore: 10, minScorePct: 80, scopeEmails: ['c@olp.co', 'd@olp.co', 'e@olp.co'], maxAttempts: 2 });
    const by = Object.fromEntries(r.results.map((x) => [x.email, x]));
    expect(by['c@olp.co']).toMatchObject({ score: 6, passed: false, attempts: 3, attemptNumber: 2, extraAttempts: 1, retrainingRequired: true });
    expect(by['d@olp.co']).toMatchObject({ score: 9, passed: true, attemptNumber: 2, extraAttempts: 0, retrainingRequired: false });
    expect(by['e@olp.co']).toMatchObject({ passed: false, attempts: 1, retrainingRequired: false });
    expect(r.summary).toMatchObject({ passed: 1, failed: 2, retraining: 1 });
    // Sin hora de respuesta en todas las filas, manda el orden del archivo.
    const noTime = evaluateTrainingResults([HEAD, ['c@olp.co', 10, ''], ['c@olp.co', 5, ''], ['c@olp.co', 6, '']], { maxScore: 10, minScorePct: 80, scopeEmails: ['c@olp.co'], maxAttempts: 2 });
    expect(noTime.results[0]).toMatchObject({ score: 10, passed: true, attemptNumber: 1, extraAttempts: 1 });
    // Sin límite (capacitaciones anteriores al S10): cuenta el mejor intento.
    const old = evaluateTrainingResults(rows, { maxScore: 10, minScorePct: 80, scopeEmails: ['c@olp.co'] });
    expect(old.results.find((x) => x.email === 'c@olp.co')).toMatchObject({ score: 10, passed: true, extraAttempts: 0, retrainingRequired: false });
  });

  it('[SGC-REQ-126] hora de la respuesta: fecha de Excel, ISO o «d/m/aaaa h:mm»', () => {
    expect(attemptTime(new Date('2026-10-08T10:00:00Z'))).toBe(Date.parse('2026-10-08T10:00:00Z'));
    expect(attemptTime(new Date('x'))).toBeNull();
    expect(attemptTime('8/10/2026 10:15')).toBe(Date.UTC(2026, 9, 8, 10, 15, 0));
    expect(attemptTime('8/10/2026')).toBe(Date.UTC(2026, 9, 8));
    expect(attemptTime('2026-10-08T10:00:00Z')).toBe(Date.parse('2026-10-08T10:00:00Z'));
    expect(attemptTime('ayer')).toBeNull();
    expect(attemptTime('')).toBeNull();
  });
});
