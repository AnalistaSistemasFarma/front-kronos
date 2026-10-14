/**
 * S17 (R30): tipos de pregunta de la evaluación propia de SynerLink — sin
 * dependencias del servidor, para que también los use la pantalla (la
 * calificación y las huellas están en lib/sgc/training/evaluation.ts).
 */
export const SGC_QUESTION_KINDS = ['unica', 'multiple', 'vf'] as const;
export type SgcQuestionKind = (typeof SGC_QUESTION_KINDS)[number];

export const SGC_QUESTION_KIND_LABELS: Record<SgcQuestionKind, string> = {
  unica: 'Opción única',
  multiple: 'Opción múltiple (todas las correctas)',
  vf: 'Verdadero o falso',
};

export const SGC_EVALUATION_MAX_QUESTIONS = 50;
export const SGC_EVALUATION_MAX_OPTIONS = 8;

/** Pregunta tal como la ve el LECTOR: sin respuestas correctas. */
export interface SgcPublicQuestion {
  id: number;
  kind: SgcQuestionKind;
  text: string;
  points: number;
  options: { id: number; text: string }[];
}
