import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SGC_EVALUATION_REPORT_HEADERS,
  attemptRecordHash,
  bankHash,
  bankMaxScore,
  consolidateAttempts,
  gradeAttempt,
  nextAttempt,
  normalizeAnswers,
  normalizeQuestionBank,
  publicQuestions,
  reportRows,
  type SgcBankQuestion,
} from '../training/evaluation';
import { normalizeTrainingConfig } from '../training/results';

/**
 * S17–S18 (plan sgc-plan-sprints-requerimientos-2026-10-13, R30): evaluaciones
 * propias en SynerLink que conviven con Microsoft Forms y Google Forms. La
 * calificación es del servidor y las respuestas correctas nunca viajan al
 * navegador; 2 intentos y recapacitación; intentos inmutables con huella.
 */

const root = join(__dirname, '../../..');
const src = (p: string) => readFileSync(join(root, p), 'utf8');

const bank: SgcBankQuestion[] = [
  { id: 10, kind: 'unica', text: '¿Quién aprueba el documento?', points: 2, sortOrder: 1, options: [{ id: 101, text: 'El líder', correct: true, sortOrder: 1 }, { id: 102, text: 'Cualquiera', correct: false, sortOrder: 2 }] },
  { id: 20, kind: 'multiple', text: '¿Qué firmas lleva el documento?', points: 3, sortOrder: 2, options: [{ id: 201, text: 'Elaboró', correct: true, sortOrder: 1 }, { id: 202, text: 'Revisó', correct: true, sortOrder: 2 }, { id: 203, text: 'Ninguna', correct: false, sortOrder: 3 }] },
  { id: 30, kind: 'vf', text: 'La copia controlada se descarga libremente.', points: 5, sortOrder: 3, options: [{ id: 301, text: 'Verdadero', correct: false, sortOrder: 1 }, { id: 302, text: 'Falso', correct: true, sortOrder: 2 }] },
];

describe('SGC · S17 · banco de preguntas (R30)', () => {
  it('[SGC-REQ-167] valida opción única (una correcta), múltiple (al menos una) y verdadero o falso; normaliza textos y puntajes', () => {
    const b = normalizeQuestionBank([
      { kind: 'unica', text: '  ¿Pregunta   uno? ', points: '2', options: [{ text: 'A', correct: true }, { text: 'B' }] },
      { kind: 'multiple', text: 'Pregunta dos', options: [{ text: 'A', correct: true }, { text: 'B', correct: true }, { text: 'C' }] },
      { kind: 'vf', text: 'Afirmación tres', correct: false },
    ]);
    expect(b[0]).toEqual({ kind: 'unica', text: '¿Pregunta uno?', points: 2, options: [{ text: 'A', correct: true }, { text: 'B', correct: false }] });
    expect(b[1].points).toBe(1);
    expect(b[2].options).toEqual([{ text: 'Verdadero', correct: false }, { text: 'Falso', correct: true }]);
    expect(() => normalizeQuestionBank([])).toThrow(/al menos una pregunta/);
    expect(() => normalizeQuestionBank([{ kind: 'abierta', text: 'Pregunta x', options: [] }])).toThrow(/no permitido/);
    expect(() => normalizeQuestionBank([{ kind: 'unica', text: 'Pregunta x', options: [{ text: 'A', correct: true }, { text: 'B', correct: true }] }])).toThrow(/exactamente una/);
    expect(() => normalizeQuestionBank([{ kind: 'multiple', text: 'Pregunta x', options: [{ text: 'A' }, { text: 'B' }] }])).toThrow(/al menos una respuesta correcta/);
    expect(() => normalizeQuestionBank([{ kind: 'unica', text: 'Pregunta x', options: [{ text: 'A', correct: true }, { text: 'a' }] }])).toThrow(/repetidas/);
    expect(() => normalizeQuestionBank([{ kind: 'unica', text: 'Pregunta x', options: [{ text: 'A', correct: true }] }])).toThrow(/al menos 2/);
    expect(() => normalizeQuestionBank([{ kind: 'vf', text: 'Afirmación' }])).toThrow(/verdadera o falsa/);
    expect(() => normalizeQuestionBank([{ kind: 'unica', text: 'abc', options: [] }])).toThrow(/mínimo 5/);
    expect(() => normalizeQuestionBank([{ kind: 'vf', text: 'Afirmación', correct: true, points: 0 }])).toThrow(/puntaje/);
    expect(() => normalizeQuestionBank(Array.from({ length: 51 }, () => ({ kind: 'vf', text: 'Afirmación', correct: true })))).toThrow(/máximo 50/);
    expect(bankMaxScore(bank)).toBe(10);
  });

  it('[SGC-REQ-168] las respuestas correctas NUNCA llegan al lector: las preguntas públicas no traen «correct»', () => {
    const pub = publicQuestions(bank);
    expect(JSON.stringify(pub)).not.toMatch(/correct/i);
    expect(pub[2]).toEqual({ id: 30, kind: 'vf', text: 'La copia controlada se descarga libremente.', points: 5, options: [{ id: 301, text: 'Verdadero' }, { id: 302, text: 'Falso' }] });
  });
});

describe('SGC · S17 · calificación en el servidor, intentos y huella (R30)', () => {
  it('[SGC-REQ-168] califica todo o nada por pregunta y aprueba con la nota mínima', () => {
    const all = normalizeAnswers({ 10: 101, 20: [202, 201], 30: [302] }, bank);
    expect(gradeAttempt(bank, all, 80)).toMatchObject({ score: 10, maxScore: 10, percent: 100, passed: true });
    const partial = normalizeAnswers({ 10: '101', 20: [201], 30: 301 }, bank);
    const g = gradeAttempt(bank, partial, 80);
    expect(g).toMatchObject({ score: 2, percent: 20, passed: false });
    expect(g.answers.map((a) => [a.idQuestion, a.correct, a.points])).toEqual([
      [10, true, 2],
      [20, false, 0],
      [30, false, 0],
    ]);
    expect(gradeAttempt(bank, normalizeAnswers({ 10: 101, 20: [201, 202], 30: 301 }, bank), 50)).toMatchObject({ score: 5, percent: 50, passed: true });
  });

  it('[SGC-REQ-168] exige responder todo con opciones de su pregunta; una sola opción en única y verdadero o falso; no acepta preguntas ajenas', () => {
    expect(() => normalizeAnswers({ 10: 101, 20: [201] }, bank)).toThrow(/Responda todas/);
    expect(() => normalizeAnswers({ 10: 201, 20: [201], 30: 302 }, bank)).toThrow(/no corresponde/);
    expect(() => normalizeAnswers({ 10: [101, 102], 20: [201], 30: 302 }, bank)).toThrow(/una sola respuesta/);
    expect(() => normalizeAnswers({ 10: 101, 20: [201], 30: 302, 99: 1 }, bank)).toThrow(/recárguela/);
    expect(() => normalizeAnswers(null, bank)).toThrow(/Responda todas/);
  });

  it('[SGC-REQ-169] respeta los intentos: quien aprueba ya no presenta; quien los agota sin aprobar queda en recapacitación', () => {
    expect(nextAttempt([], 2)).toEqual({ allowed: true, attemptNumber: 1 });
    expect(nextAttempt([{ attemptNumber: 1, passed: false }], 2)).toEqual({ allowed: true, attemptNumber: 2 });
    expect(nextAttempt([{ attemptNumber: 1, passed: true }], 2)).toMatchObject({ allowed: false, retrainingRequired: false });
    expect(nextAttempt([{ attemptNumber: 1, passed: false }, { attemptNumber: 2, passed: false }], 2)).toMatchObject({ allowed: false, retrainingRequired: true, reason: expect.stringMatching(/recapacitación/) });
  });

  it('[SGC-REQ-169] la huella del intento cambia con cualquier dato (respuestas, puntaje, banco o fecha)', () => {
    const graded = gradeAttempt(bank, normalizeAnswers({ 10: 101, 20: [201, 202], 30: 302 }, bank), 80);
    const base = { idTraining: 1, email: 'A@olp.co', attemptNumber: 1, graded, bankSha256: bankHash(bank), submittedAt: '2026-10-14T10:00:00.000Z' };
    const h = attemptRecordHash(base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(attemptRecordHash({ ...base, email: 'a@olp.co' })).toBe(h);
    expect(attemptRecordHash({ ...base, attemptNumber: 2 })).not.toBe(h);
    expect(attemptRecordHash({ ...base, submittedAt: '2026-10-14T10:00:01.000Z' })).not.toBe(h);
    expect(attemptRecordHash({ ...base, graded: { ...graded, score: 9 } })).not.toBe(h);
    const otherBank = bank.map((q) => (q.id === 30 ? { ...q, points: 4 } : q));
    expect(bankHash(otherBank)).not.toBe(bankHash(bank));
  });
});

describe('SGC · S18 · consolidación y reporte para la auditoría (R30)', () => {
  it('[SGC-REQ-170] cuenta el primer intento aprobado (o el último), marca la recapacitación y arma las filas del Excel', () => {
    const at = (n: number, percent: number, passed: boolean) => ({ attemptNumber: n, score: percent / 10, percent, passed, submittedAt: new Date(`2026-10-1${n}T15:00:00Z`) });
    const res = consolidateAttempts(
      [
        { email: 'B@olp.co', name: 'B', attempts: [at(1, 40, false), at(2, 90, true)] },
        { email: 'a@olp.co', name: null, attempts: [at(1, 30, false), at(2, 50, false)] },
        { email: 'c@olp.co', name: 'C', attempts: [at(1, 60, false)] },
        { email: 'd@olp.co', name: 'D', attempts: [] },
      ],
      2
    );
    expect(res.map((r) => [r.email, r.attemptNumber, r.passed, r.retrainingRequired, r.attempts])).toEqual([
      ['a@olp.co', 2, false, true, 2],
      ['b@olp.co', 2, true, false, 2],
      ['c@olp.co', 1, false, false, 1],
    ]);
    expect(res[1].completedAt).toBe('2026-10-12 15:00');
    expect(reportRows(res, 10)[1]).toEqual(['b@olp.co', 'B', 9, 10, 90, 'Aprobó', 2, 2, 'No', '2026-10-12 15:00']);
    expect(SGC_EVALUATION_REPORT_HEADERS).toHaveLength(10);
  });

  it('[SGC-REQ-167] la capacitación elige el proveedor: Forms (con enlace) o SynerLink (sin enlace; el puntaje sale del banco)', () => {
    const base = { mode: 'video', title: 'Capacitación del formato', videoUrl: 'https://www.youtube.com/watch?v=x' };
    expect(normalizeTrainingConfig({ ...base, evaluationProvider: 'synerlink' })).toMatchObject({ evaluationProvider: 'synerlink', formsUrl: null, maxScore: 1 });
    expect(() => normalizeTrainingConfig({ ...base, evaluationProvider: 'synerlink', formsUrl: 'https://forms.office.com/r/x' })).toThrow(/no se usa un enlace de Forms/);
    expect(normalizeTrainingConfig({ ...base, formsUrl: 'https://forms.office.com/r/x', maxScore: 10 })).toMatchObject({ evaluationProvider: 'microsoft' });
    expect(() => normalizeTrainingConfig({ ...base, maxScore: 10 })).toThrow(/enlace de la evaluación/);
  });

  it('[SGC-REQ-168] la pantalla del lector no recibe ni importa la calificación del servidor (aislamiento de las respuestas)', () => {
    const taker = src('components/sgc/tareas/SgcEvaluationTaker.tsx');
    expect(taker).not.toMatch(/training\/evaluation'/);
    expect(taker).toContain("from '../../../lib/sgc/training/evaluationKinds'");
    expect(src('lib/sgc/training/evaluationKinds.ts')).not.toMatch(/node:crypto|correct:/);
    expect(src('lib/sgc/db/evaluation.ts')).toMatch(/questions: reason && rec\.status !== 'leido' \? \[\] : publicQuestions\(bank\)/);
    const mig = src('prisma/migrations/20261014120000_sgc_s17_evaluaciones/migration.sql');
    expect(mig).toContain('training_attempt_solo_insercion');
    expect(mig).toContain('proteccion_registros_training_attempt_fk');
  });
});
