/**
 * Puente PURO entre el motor de reglas y los condicionales del flujo diagramado.
 *
 * El flujo «Oferta de venta» usa el «◆ Condicional» que ya existe en SynerLink
 * (tareas condicionadas por opciones del formulario: task_condition_option +
 * request_form_value, evaluado en advanceSequentialTask). La Tarea SAP «Evaluar
 * reglas de venta» marca en la solicitud la opcion que corresponde ANTES de que el
 * flujo avance, y asi se crean u omiten las autorizaciones.
 *
 * El campo vive en el formulario del proceso (process_form_field) y no lo llena el
 * usuario: lo escribe el sistema con locked = 1.
 */

import type { Evaluacion } from './rules';

export const EVAL_FIELD_LABEL = 'Resultado de la evaluación de venta';
export const OPTION_PRICE = 'Requiere autorización de precio';
export const OPTION_CREDIT = 'Excede cupo';

/** Opcion a marcar al evaluar el envio (precio va primero; el cupo se revalua tras aprobar precios). */
export function optionsForSend(ev: Pick<Evaluacion, 'destino'>): string[] {
  if (ev.destino === 'AP') return [OPTION_PRICE];
  if (ev.destino === 'AE') return [OPTION_CREDIT];
  return [];
}

/** Opcion a marcar al revaluar el cupo despues de aprobar precios. */
export function optionsForCreditRecheck(destino: 'AE' | 'PEDIDO'): string[] {
  return destino === 'AE' ? [OPTION_CREDIT] : [];
}

/** Estado SAP que deja un rechazo segun la etapa en la que estaba el borrador. */
export function rejectedStateFor(current: unknown): 'NAP' | 'NADC' | 'NADA' | null {
  const s = String(current ?? '').trim().toUpperCase();
  if (s === 'AP') return 'NAP';
  if (s === 'AE') return 'NADC';
  if (s === 'AEDA') return 'NADA';
  return null;
}

/** Campo de trazabilidad (U_SEND_Tra*) que registra cada decision, como SAPSEND. */
export function traceFieldFor(state: 'AP' | 'AE' | 'AEDA', approved: boolean): string {
  const map = {
    AP: approved ? 'U_SEND_TraAproAP' : 'U_SEND_TraDenAP',
    AE: approved ? 'U_SEND_TraAproAE' : 'U_SEND_TraDenAE',
    AEDA: approved ? 'U_SEND_TraAproAEDA' : 'U_SEND_TraDenAEDA',
  } as const;
  return map[state];
}
