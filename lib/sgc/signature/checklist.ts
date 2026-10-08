import { SgcError } from '../errors';
import type { SgcFormFieldDefinition } from '../flows/definition';
import { SGC_CHECK_ANSWERS, SGC_CHECK_ANSWER_LABELS, type SgcCheckAnswer } from './consent';

/**
 * Lista de chequeo de ESTRUCTURA DOCUMENTAL de Calidad dentro de la
 * Aprobación (plan, paso 3: «dentro de esta misma aprobación Calidad verifica
 * la estructura documental: guía de codificación, formato, anexos»).
 *
 * Es CONFIGURABLE en el flujo: son los campos de la tarea marcados
 * «Chequeo Calidad» en el administrador de flujos validados. Los responde el
 * cupo del grupo de verificación al firmar. Funciones PURAS.
 */

export interface SgcChecklistItem {
  key: string;
  label: string;
  required: boolean;
  answer: SgcCheckAnswer;
  answerLabel: string;
  observation: string | null;
}

export interface SgcChecklistResult {
  items: SgcChecklistItem[];
  result: 'conforme' | 'no_conforme';
}

/** Puntos de la lista de chequeo de una tarea (en su orden). */
export function checklistFieldsFor(fields: readonly SgcFormFieldDefinition[], taskKey: string): SgcFormFieldDefinition[] {
  return fields.filter((f) => f.qualityCheck && f.taskKey === taskKey).sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Valida las respuestas: todas las preguntas contestadas, «No aplica» no vale
 * en las obligatorias y un «No cumple» exige observación. El resultado es
 * «no_conforme» si algún punto no cumple.
 */
export function normalizeChecklist(fields: readonly SgcFormFieldDefinition[], raw: unknown): SgcChecklistResult {
  const answers = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const items: SgcChecklistItem[] = fields.map((f) => {
    const entry = answers[f.key];
    const obj = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : { answer: entry };
    const answer = obj.answer;
    if (typeof answer !== 'string' || !(SGC_CHECK_ANSWERS as readonly string[]).includes(answer)) {
      throw new SgcError(`Lista de chequeo de Calidad: responda «${f.label}».`);
    }
    if (answer === 'no_aplica' && f.required) throw new SgcError(`Lista de chequeo de Calidad: «${f.label}» es obligatorio (no admite «No aplica»).`);
    const observation = typeof obj.observation === 'string' ? obj.observation.trim().slice(0, 500) : '';
    if (answer === 'no_cumple' && observation.length < 5) {
      throw new SgcError(`Lista de chequeo de Calidad: explique por qué «${f.label}» no cumple (mínimo 5 caracteres).`);
    }
    return {
      key: f.key,
      label: f.label,
      required: f.required,
      answer: answer as SgcCheckAnswer,
      answerLabel: SGC_CHECK_ANSWER_LABELS[answer as SgcCheckAnswer],
      observation: observation || null,
    };
  });
  return { items, result: items.some((i) => i.answer === 'no_cumple') ? 'no_conforme' : 'conforme' };
}
