import { SgcError } from '../errors';
import type {
  SgcConditionKey,
  SgcFlowAction,
  SgcFlowDefinition,
  SgcSigningMode,
  SgcTaskDefinition,
  SgcTerminalStatus,
} from './definition';

/**
 * Reglas de EJECUCIÓN del motor de flujos validados — funciones PURAS.
 * La capa de base de datos (lib/sgc/db/requests.ts) solo lee, llama a estas
 * reglas y escribe lo que ellas deciden, dentro de una transacción.
 */

export type SgcTaskStatus = 'sin_empezar' | 'abierta' | 'resuelta' | 'devuelta' | 'cancelada' | 'en_espera';
export type SgcRequestStatus = 'abierta' | 'en_espera' | 'completada' | 'cancelada';
export type SgcAssigneeStatus = 'pendiente' | 'aprobado' | 'devuelto' | 'reemplazado' | 'anulado';

/** Vocabulario visible IDÉNTICO al de SynerLink («ni se note la diferencia»). */
export const SGC_TASK_STATUS_LABELS: Record<SgcTaskStatus, string> = {
  sin_empezar: 'Sin Empezar',
  abierta: 'Abierto',
  resuelta: 'Resuelto',
  devuelta: 'Devuelto',
  cancelada: 'Cancelado',
  en_espera: 'En espera',
};

export const SGC_REQUEST_STATUS_LABELS: Record<SgcRequestStatus, string> = {
  abierta: 'Abierto',
  en_espera: 'En espera',
  completada: 'Resuelto',
  cancelada: 'Cancelado',
};

export const SGC_ASSIGNEE_STATUS_LABELS: Record<SgcAssigneeStatus, string> = {
  pendiente: 'Pendiente',
  aprobado: 'Aprobado',
  devuelto: 'Devuelto',
  reemplazado: 'Reemplazado',
  anulado: 'Anulado',
};

/** Colores de estado copiados de SynerLink (getStatusColor de las vistas de solicitudes). */
export function sgcStatusColor(label: string | null | undefined): string {
  switch ((label ?? '').toLowerCase()) {
    case 'sin empezar':
      return 'gray';
    case 'abierto':
      return 'blue';
    case 'resuelto':
      return 'green';
    case 'en espera':
      return 'yellow';
    case 'devuelto':
      return 'orange';
    default:
      return 'red';
  }
}

export interface SgcConditionContext {
  requestType: string;
  requiresTraining: boolean;
}

export function evaluateCondition(conditionKey: SgcConditionKey | null, ctx: SgcConditionContext): boolean {
  switch (conditionKey) {
    case null:
      return true;
    case 'tipo_exige_capacitacion':
    case 'requiere_capacitacion':
      // Sprint 10: requiresTraining ya es la bandera efectiva de la solicitud (lib/sgc/training/flag.ts).
      return ctx.requiresTraining;
    case 'solicitud_es_nueva':
      return ctx.requestType === 'nuevo';
    case 'solicitud_sobre_documento':
      return ctx.requestType !== 'nuevo';
    default:
      return false;
  }
}

export type SgcNextStep = { kind: 'task'; task: SgcTaskDefinition } | { kind: 'terminal'; status: SgcTerminalStatus };

/**
 * A dónde lleva una acción desde una tarea. Si la tarea destino tiene una
 * condición que no se cumple, se la salta siguiendo su «aprobar».
 */
export function resolveNextStep(
  def: SgcFlowDefinition,
  fromKey: string,
  action: SgcFlowAction,
  ctx: SgcConditionContext
): SgcNextStep {
  const byKey = new Map(def.tasks.map((t) => [t.key, t]));
  let tr = def.transitions.find((t) => t.from === fromKey && t.action === action);
  if (!tr) throw new SgcError(`La acción "${action}" no está disponible en esta tarea.`, 409);
  const visited = new Set<string>();
  for (;;) {
    if (tr.terminalStatus) return { kind: 'terminal', status: tr.terminalStatus };
    const next = byKey.get(tr.to!);
    if (!next) throw new SgcError('La definición del flujo apunta a una tarea inexistente.', 500);
    if (action === 'devolver' || evaluateCondition(next.conditionKey, ctx)) return { kind: 'task', task: next };
    if (visited.has(next.key)) throw new SgcError('La definición del flujo tiene un ciclo de condiciones.', 500);
    visited.add(next.key);
    const skip = def.transitions.find((t) => t.from === next.key && t.action === 'aprobar');
    if (!skip) throw new SgcError(`La tarea "${next.name}" no tiene transición "aprobar".`, 500);
    tr = skip;
  }
}

/** Primera tarea del flujo (la de menor orden). */
export function firstTask(def: SgcFlowDefinition): SgcTaskDefinition {
  return [...def.tasks].sort((a, b) => a.stepOrder - b.stepOrder)[0];
}

export interface SgcAssigneeState {
  id: number;
  userEmail: string | null;
  poolTypeCode: string | null;
  signOrder: number;
  status: SgcAssigneeStatus;
}

const isLive = (a: SgcAssigneeState) => a.status !== 'reemplazado' && a.status !== 'anulado';

/**
 * A quién le toca: en PARALELO, a todos los pendientes; EN ORDEN, solo al
 * primer pendiente según su orden (los anteriores ya aprobaron).
 */
export function assigneesInTurn(assignees: readonly SgcAssigneeState[], mode: SgcSigningMode | null): SgcAssigneeState[] {
  const pending = assignees.filter((a) => a.status === 'pendiente').sort((a, b) => a.signOrder - b.signOrder || a.id - b.id);
  if (mode === 'orden') return pending.slice(0, 1);
  return pending;
}

/** Resultado de la tarea según las decisiones de sus firmantes vigentes. */
export function taskOutcome(assignees: readonly SgcAssigneeState[]): 'resuelta' | 'devuelta' | 'abierta' {
  const live = assignees.filter(isLive);
  if (live.some((a) => a.status === 'devuelto')) return 'devuelta';
  if (live.length > 0 && live.every((a) => a.status === 'aprobado')) return 'resuelta';
  return 'abierta';
}

export interface SgcDecisionActor {
  email: string;
  /** Códigos de tipo de autorización a cuyo grupo pertenece la persona. */
  poolTypeCodes: readonly string[];
}

/**
 * Decide qué cupo de la tarea resuelve la persona, o explica por qué no puede.
 * Reglas: solo firmantes vigentes; en orden, solo cuando es su turno; un cupo
 * de grupo lo toma cualquiera del grupo; el ELABORADOR no revisa ni aprueba su
 * propio documento (segregación de funciones).
 */
export function pickAssigneeForDecision(
  assignees: readonly SgcAssigneeState[],
  mode: SgcSigningMode | null,
  actor: SgcDecisionActor,
  opts: { elaboratorEmail: string | null; allowElaborator: boolean }
): SgcAssigneeState {
  const me = actor.email.toLowerCase();
  const mine = assignees.filter(
    (a) =>
      a.status === 'pendiente' &&
      ((a.userEmail && a.userEmail.toLowerCase() === me) || (!a.userEmail && a.poolTypeCode && actor.poolTypeCodes.includes(a.poolTypeCode)))
  );
  if (mine.length === 0) throw new SgcError('Usted no tiene una decisión pendiente en esta tarea.', 403);
  if (!opts.allowElaborator && opts.elaboratorEmail && opts.elaboratorEmail.toLowerCase() === me) {
    throw new SgcError('El elaborador no puede revisar ni aprobar su propio documento.', 403);
  }
  const turn = new Set(assigneesInTurn(assignees, mode).map((a) => a.id));
  const ready = mine.filter((a) => turn.has(a.id)).sort((a, b) => a.signOrder - b.signOrder);
  if (ready.length === 0) throw new SgcError('Aún no es su turno: esta tarea se firma en orden y falta una decisión anterior.', 409);
  // Si la persona tiene cupo propio y de grupo, primero el propio.
  return ready.find((a) => a.userEmail) ?? ready[0];
}

// ---------------------------------------------------------------------------
// Firmantes (revisores y aprobadores) que asigna el elaborador.
// ---------------------------------------------------------------------------

export interface SgcSignerInput {
  email: string;
  order: number;
}

/**
 * Normaliza la lista de firmantes de un paso: correos en minúscula, sin
 * repetidos, orden 1..n según el orden recibido. Valida que sean personas
 * habilitadas (con permiso de gestión o Calidad en la empresa) y que ni el
 * elaborador ni el solicitante queden como firmantes de su propia solicitud.
 */
export function normalizeSigners(
  raw: unknown,
  opts: { stepName: string; elaboratorEmail: string; requesterEmail?: string | null; eligibleEmails: ReadonlySet<string>; min?: number; max?: number }
): SgcSignerInput[] {
  const list = Array.isArray(raw) ? raw : [];
  const emails = list.map((x) => String((x as { email?: unknown })?.email ?? x ?? '').trim().toLowerCase()).filter(Boolean);
  const min = opts.min ?? 1;
  const max = opts.max ?? 10;
  if (emails.length < min) throw new SgcError(`Asigne al menos ${min} persona(s) para ${opts.stepName}.`);
  if (emails.length > max) throw new SgcError(`${opts.stepName} admite máximo ${max} personas.`);
  const seen = new Set<string>();
  for (const e of emails) {
    if (seen.has(e)) throw new SgcError(`${e} está repetido en ${opts.stepName}.`);
    seen.add(e);
    if (e === opts.elaboratorEmail.toLowerCase()) {
      throw new SgcError(`El elaborador no puede ser firmante de ${opts.stepName} de su propio documento.`);
    }
    // 2026-10-05: quien hizo la solicitud tampoco revisa ni aprueba lo que pidió.
    if (opts.requesterEmail && e === opts.requesterEmail.toLowerCase()) {
      throw new SgcError(`Quien hizo la solicitud no puede ser firmante de ${opts.stepName} de su propia solicitud.`);
    }
    if (!opts.eligibleEmails.has(e)) throw new SgcError(`${e} no tiene permiso de gestión documental en el SGC de esta empresa.`);
  }
  return emails.map((email, i) => ({ email, order: i + 1 }));
}

export interface SgcCurrentSigner {
  email: string;
  order: number;
  /** true si ya decidió en la tarea abierta de este paso (no se puede retirar). */
  decided: boolean;
}

export interface SgcSignerChangePlan {
  add: SgcSignerInput[];
  remove: string[];
  reorder: SgcSignerInput[];
  unchanged: boolean;
}

/**
 * Qué cambia entre los firmantes actuales y los deseados. Quien ya firmó no
 * se puede retirar (su decisión queda); para rehacerla se devuelve el documento.
 */
export function planSignerChange(current: readonly SgcCurrentSigner[], desired: readonly SgcSignerInput[]): SgcSignerChangePlan {
  const cur = new Map(current.map((c) => [c.email, c]));
  const des = new Map(desired.map((d) => [d.email, d]));
  const remove = current.filter((c) => !des.has(c.email)).map((c) => c.email);
  for (const email of remove) {
    if (cur.get(email)!.decided) throw new SgcError(`${email} ya decidió en este paso y no se puede retirar; si hace falta, devuelva el documento.`, 409);
  }
  const add = desired.filter((d) => !cur.has(d.email));
  const reorder = desired.filter((d) => cur.has(d.email) && cur.get(d.email)!.order !== d.order);
  return { add, remove, reorder, unchanged: add.length === 0 && remove.length === 0 && reorder.length === 0 };
}

/** Modo de firma de un paso para una solicitud (elegido en el documento o el de la definición). */
export function signingModeFor(task: SgcTaskDefinition, modes: Record<string, unknown>): SgcSigningMode | null {
  if (!task.multiAssignee) return null;
  const chosen = modes[task.key];
  if (chosen === 'orden' || chosen === 'paralelo') return chosen;
  return task.signingModeDefault ?? 'paralelo';
}

export function parseSigningModes(json: string | null | undefined): Record<string, 'orden' | 'paralelo'> {
  try {
    const v = JSON.parse(json || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, 'orden' | 'paralelo'> = {};
    for (const [k, m] of Object.entries(v)) if (m === 'orden' || m === 'paralelo') out[k] = m;
    return out;
  } catch {
    return {};
  }
}

/** Fecha objetivo de una tarea (días calendario desde su inicio). */
export function dueDate(start: Date, targetDays: number | null): Date | null {
  if (!targetDays) return null;
  return new Date(start.getTime() + targetDays * 24 * 60 * 60 * 1000);
}
