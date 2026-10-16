import { createHash } from 'node:crypto';
import { SgcError } from '../errors';

/**
 * EVALUACIONES PROPIAS EN SYNERLINK (S17–S18, R30; RN 2026-10-13
 * rn-sgc-capacitacion-del-creador-y-evaluacion-propia; D19 recomendada:
 * conviven con Microsoft Forms y Google Forms, se elige el proveedor por
 * capacitación) — funciones PURAS.
 *
 * Reglas de seguridad (condición de Juan Mora: «siempre y cuando no haya una
 * vulnerabilidad»):
 *  - las respuestas correctas NUNCA viajan al navegador: el lector recibe las
 *    preguntas sin «is_correct» (publicQuestions) y la calificación se hace
 *    solo en el servidor (gradeAttempt);
 *  - cada intento es INMUTABLE (solo inserción) y lleva su huella SHA-256
 *    (attemptRecordHash) sobre las respuestas, el puntaje y el banco de
 *    preguntas con que se calificó;
 *  - se respetan los intentos de la capacitación (2 por defecto): quien
 *    aprueba ya no presenta más; quien agota los intentos sin aprobar queda en
 *    recapacitación (el mismo motor de los resultados de Forms).
 * Tipos de pregunta: opción única, opción múltiple (todo o nada) y verdadero
 * o falso.
 */

import { SGC_EVALUATION_MAX_OPTIONS, SGC_EVALUATION_MAX_QUESTIONS, SGC_QUESTION_KINDS, type SgcPublicQuestion, type SgcQuestionKind } from './evaluationKinds';

export { SGC_EVALUATION_MAX_OPTIONS, SGC_EVALUATION_MAX_QUESTIONS, SGC_QUESTION_KINDS, SGC_QUESTION_KIND_LABELS, type SgcPublicQuestion, type SgcQuestionKind } from './evaluationKinds';

export interface SgcQuestionInput {
  kind: SgcQuestionKind;
  text: string;
  points: number;
  options: { text: string; correct: boolean }[];
}

/** Pregunta guardada (con sus ids) — la que conoce el servidor. */
export interface SgcBankQuestion {
  id: number;
  kind: SgcQuestionKind;
  text: string;
  points: number;
  sortOrder: number;
  options: { id: number; text: string; correct: boolean; sortOrder: number }[];
}

function cleanText(raw: unknown, label: string, max: number, min = 1): string {
  const s = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (s.length < min) throw new SgcError(`${label} es obligatorio${min > 1 ? ` (mínimo ${min} caracteres)` : ''}.`);
  if (s.length > max) throw new SgcError(`${label} admite máximo ${max} caracteres.`);
  return s;
}

/** Valida el banco de preguntas que arma el creador (o Calidad). */
export function normalizeQuestionBank(raw: unknown): SgcQuestionInput[] {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length === 0) throw new SgcError('La evaluación necesita al menos una pregunta.');
  if (list.length > SGC_EVALUATION_MAX_QUESTIONS) throw new SgcError(`La evaluación admite máximo ${SGC_EVALUATION_MAX_QUESTIONS} preguntas.`);
  return list.map((q: Record<string, unknown>, i: number) => {
    const label = `Pregunta ${i + 1}`;
    const kind = String(q?.kind ?? '');
    if (!(SGC_QUESTION_KINDS as readonly string[]).includes(kind)) throw new SgcError(`${label}: tipo de pregunta no permitido.`);
    const text = cleanText(q?.text, `${label}: el enunciado`, 1000, 5);
    const points = q?.points === undefined || q?.points === null || q?.points === '' ? 1 : Number(q.points);
    if (!Number.isFinite(points) || points <= 0 || points > 100) throw new SgcError(`${label}: el puntaje debe estar entre 0,01 y 100.`);
    let options: { text: string; correct: boolean }[];
    if (kind === 'vf') {
      const correct = (q as { correct?: unknown }).correct;
      const fromOptions = Array.isArray(q?.options) ? (q.options as { text?: unknown; correct?: unknown }[]) : [];
      const isTrue = typeof correct === 'boolean' ? correct : fromOptions.length === 2 ? Boolean(fromOptions[0]?.correct) : null;
      if (isTrue === null) throw new SgcError(`${label}: indique si la afirmación es verdadera o falsa.`);
      options = [
        { text: 'Verdadero', correct: isTrue },
        { text: 'Falso', correct: !isTrue },
      ];
    } else {
      const raw = Array.isArray(q?.options) ? (q.options as { text?: unknown; correct?: unknown }[]) : [];
      if (raw.length < 2) throw new SgcError(`${label}: escriba al menos 2 opciones.`);
      if (raw.length > SGC_EVALUATION_MAX_OPTIONS) throw new SgcError(`${label}: máximo ${SGC_EVALUATION_MAX_OPTIONS} opciones.`);
      options = raw.map((o, j) => ({ text: cleanText(o?.text, `${label}, opción ${j + 1}`, 500), correct: o?.correct === true }));
      const texts = new Set(options.map((o) => o.text.toLowerCase()));
      if (texts.size !== options.length) throw new SgcError(`${label}: hay opciones repetidas.`);
      const correct = options.filter((o) => o.correct).length;
      if (kind === 'unica' && correct !== 1) throw new SgcError(`${label}: una pregunta de opción única tiene exactamente una respuesta correcta.`);
      if (kind === 'multiple' && correct < 1) throw new SgcError(`${label}: marque al menos una respuesta correcta.`);
    }
    return { kind: kind as SgcQuestionKind, text, points: Math.round(points * 100) / 100, options };
  });
}

/** Puntaje máximo del banco (la suma de los puntajes). */
export function bankMaxScore(bank: readonly Pick<SgcBankQuestion, 'points'>[]): number {
  return Math.round(bank.reduce((s, q) => s + q.points, 0) * 100) / 100;
}

/** Lo que recibe el navegador del LECTOR: nunca «correct». */
export function publicQuestions(bank: readonly SgcBankQuestion[]): SgcPublicQuestion[] {
  return [...bank]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .map((q) => ({ id: q.id, kind: q.kind, text: q.text, points: q.points, options: [...q.options].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id).map((o) => ({ id: o.id, text: o.text })) }));
}

export interface SgcGradedAnswer {
  idQuestion: number;
  selected: number[];
  correct: boolean;
  points: number;
}

export interface SgcGradedAttempt {
  answers: SgcGradedAnswer[];
  score: number;
  maxScore: number;
  percent: number;
  passed: boolean;
}

/** Normaliza las respuestas que llegan: { [idPregunta]: idOpción | idOpción[] }. Toda pregunta debe responderse. */
export function normalizeAnswers(raw: unknown, bank: readonly SgcBankQuestion[]): Map<number, number[]> {
  const obj = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out = new Map<number, number[]>();
  for (const q of bank) {
    const v = obj[String(q.id)];
    const ids = (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]).map(Number).filter((x) => Number.isInteger(x));
    const unique = [...new Set(ids)];
    if (unique.length === 0) throw new SgcError('Responda todas las preguntas antes de enviar la evaluación.');
    const valid = new Set(q.options.map((o) => o.id));
    if (unique.some((id) => !valid.has(id))) throw new SgcError('Una respuesta no corresponde a las opciones de su pregunta.');
    if ((q.kind === 'unica' || q.kind === 'vf') && unique.length !== 1) throw new SgcError('En las preguntas de opción única y de verdadero o falso se elige una sola respuesta.');
    out.set(q.id, unique.sort((a, b) => a - b));
  }
  const known = new Set(bank.map((q) => String(q.id)));
  if (Object.keys(obj).some((k) => !known.has(k))) throw new SgcError('La evaluación cambió: recárguela antes de enviar.');
  return out;
}

/** CALIFICACIÓN EN EL SERVIDOR: todo o nada por pregunta; aprueba con la nota mínima (%). */
export function gradeAttempt(bank: readonly SgcBankQuestion[], answers: ReadonlyMap<number, readonly number[]>, minScorePct: number): SgcGradedAttempt {
  const graded: SgcGradedAnswer[] = [];
  let score = 0;
  for (const q of bank) {
    const selected = [...(answers.get(q.id) ?? [])].sort((a, b) => a - b);
    const correctIds = q.options.filter((o) => o.correct).map((o) => o.id).sort((a, b) => a - b);
    const correct = selected.length === correctIds.length && selected.every((id, i) => id === correctIds[i]);
    const points = correct ? q.points : 0;
    score += points;
    graded.push({ idQuestion: q.id, selected, correct, points });
  }
  const maxScore = bankMaxScore(bank);
  score = Math.round(score * 100) / 100;
  const percent = maxScore > 0 ? Math.round((score / maxScore) * 1000) / 10 : 0;
  return { answers: graded, score, maxScore, percent, passed: percent >= minScorePct };
}

export interface SgcAttemptState {
  attemptNumber: number;
  passed: boolean;
}

/**
 * ¿Puede presentar otro intento? No si ya aprobó o si agotó los intentos
 * (entonces queda en recapacitación). Devuelve el número del siguiente intento.
 */
export function nextAttempt(attempts: readonly SgcAttemptState[], maxAttempts: number): { allowed: true; attemptNumber: number } | { allowed: false; reason: string; retrainingRequired: boolean } {
  if (attempts.some((a) => a.passed)) return { allowed: false, reason: 'Usted ya aprobó esta evaluación.', retrainingRequired: false };
  if (attempts.length >= maxAttempts) return { allowed: false, reason: `Ya presentó los ${maxAttempts} intento(s) permitidos sin aprobar: queda en recapacitación (la registra el creador del documento o Calidad).`, retrainingRequired: true };
  return { allowed: true, attemptNumber: attempts.length + 1 };
}

/** Huella del banco de preguntas (para saber con qué versión se calificó un intento). */
export function bankHash(bank: readonly SgcBankQuestion[]): string {
  const canon = [...bank]
    .sort((a, b) => a.id - b.id)
    .map((q) => ({ id: q.id, kind: q.kind, text: q.text, points: q.points, options: [...q.options].sort((a, b) => a.id - b.id).map((o) => ({ id: o.id, text: o.text, correct: o.correct })) }));
  return createHash('sha256').update(JSON.stringify(canon)).digest('hex');
}

/** Huella del intento (respuestas, puntaje, persona, intento y banco). */
export function attemptRecordHash(input: { idTraining: number; email: string; attemptNumber: number; graded: SgcGradedAttempt; bankSha256: string; submittedAt: string }): string {
  const canon = {
    idTraining: input.idTraining,
    email: input.email.trim().toLowerCase(),
    attemptNumber: input.attemptNumber,
    answers: input.graded.answers.map((a) => ({ q: a.idQuestion, s: a.selected, c: a.correct, p: a.points })),
    score: input.graded.score,
    maxScore: input.graded.maxScore,
    percent: input.graded.percent,
    passed: input.graded.passed,
    bank: input.bankSha256,
    at: input.submittedAt,
  };
  return createHash('sha256').update(JSON.stringify(canon)).digest('hex');
}

export interface SgcPersonAttempts {
  email: string;
  name: string | null;
  attempts: { attemptNumber: number; score: number; percent: number; passed: boolean; submittedAt: Date }[];
}

export interface SgcConsolidatedResult {
  email: string;
  name: string | null;
  score: number;
  percent: number;
  passed: boolean;
  attempts: number;
  attemptNumber: number;
  retrainingRequired: boolean;
  completedAt: string;
}

/**
 * Resultado que CUENTA por persona (igual que con los resultados de Forms): el
 * primer intento aprobado dentro de los permitidos; si no aprobó, el último;
 * con los intentos agotados sin aprobar, recapacitación. Solo las personas con
 * al menos un intento (las demás quedan «sin resultado»).
 */
export function consolidateAttempts(people: readonly SgcPersonAttempts[], maxAttempts: number): SgcConsolidatedResult[] {
  const out: SgcConsolidatedResult[] = [];
  for (const p of people) {
    const sorted = [...p.attempts].sort((a, b) => a.attemptNumber - b.attemptNumber).slice(0, maxAttempts);
    if (!sorted.length) continue;
    const counted = sorted.find((a) => a.passed) ?? sorted[sorted.length - 1];
    out.push({
      email: p.email.trim().toLowerCase(),
      name: p.name,
      score: counted.score,
      percent: counted.percent,
      passed: counted.passed,
      attempts: p.attempts.length,
      attemptNumber: counted.attemptNumber,
      retrainingRequired: !counted.passed && sorted.length >= maxAttempts,
      completedAt: counted.submittedAt.toISOString().slice(0, 16).replace('T', ' '),
    });
  }
  return out.sort((a, b) => a.email.localeCompare(b.email));
}

/** Filas del Excel de resultados (reporte exportable para la auditoría). */
export const SGC_EVALUATION_REPORT_HEADERS = ['Correo electrónico', 'Nombre', 'Total de puntos', 'Puntaje máximo', 'Porcentaje', 'Resultado', 'Intento que cuenta', 'Intentos presentados', 'Recapacitación', 'Hora de finalización'] as const;

export function reportRows(results: readonly SgcConsolidatedResult[], maxScore: number): (string | number)[][] {
  return results.map((r) => [r.email, r.name ?? '', r.score, maxScore, r.percent, r.passed ? 'Aprobó' : 'Reprobó', r.attemptNumber, r.attempts, r.retrainingRequired ? 'Sí' : 'No', r.completedAt]);
}
