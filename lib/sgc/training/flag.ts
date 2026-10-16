/**
 * CAPACITACIÓN OPCIONAL POR SOLICITUD (Sprint 10, socialización con Calidad
 * OLP del 2026-10-07) — funciones PURAS.
 *
 * No todo documento necesita capacitación (sí los formatos y los manuales de
 * uso). El SOLICITANTE la sugiere al crear la solicitud; la CONFIRMA quien
 * crea el documento o Calidad (decisión D7, igual que los firmantes). Mientras
 * nadie la confirme manda la sugerencia y, si tampoco hay, el valor del tipo
 * documental (como hasta el S9). Las solicitudes anteriores no tienen ni
 * sugerencia ni confirmación: siguen con el valor del tipo.
 */

export type SgcTrainingFlagSource = 'confirmada' | 'sugerida' | 'tipo';

export interface SgcTrainingFlagState {
  confirmed: boolean | null | undefined;
  suggested: boolean | null | undefined;
  typeDefault: boolean | null | undefined;
}

/** ¿La solicitud requiere capacitación? */
export function effectiveRequiresTraining(s: SgcTrainingFlagState): boolean {
  if (typeof s.confirmed === 'boolean') return s.confirmed;
  if (typeof s.suggested === 'boolean') return s.suggested;
  return s.typeDefault ?? true;
}

export function trainingFlagSource(s: SgcTrainingFlagState): SgcTrainingFlagSource {
  if (typeof s.confirmed === 'boolean') return 'confirmada';
  if (typeof s.suggested === 'boolean') return 'sugerida';
  return 'tipo';
}

export const SGC_TRAINING_FLAG_SOURCE_LABELS: Record<SgcTrainingFlagSource, string> = {
  confirmada: 'confirmada',
  sugerida: 'sugerida por el solicitante, falta confirmarla',
  tipo: 'según el tipo documental',
};

/** Valor que llega del formulario: true/false, «si»/«no» o vacío («según el tipo»). */
export function parseTrainingChoice(raw: unknown): boolean | null {
  if (raw === true || raw === 'si' || raw === 'sí' || raw === 'true') return true;
  if (raw === false || raw === 'no' || raw === 'false') return false;
  return null;
}

/** Pasos desde los que ya no se cambia la bandera (empezó la preparación, la divulgación o la capacitación). */
export const SGC_TRAINING_LOCKED_ROLES: readonly string[] = ['material', 'alcance', 'capacitacion'];
