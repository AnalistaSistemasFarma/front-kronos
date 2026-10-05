import { SgcError } from '../errors';
import type { SgcFlowDefinition, SgcTaskDefinition } from './definition';

/**
 * SELECCIÓN de revisores, aprobadores y alcance de divulgación — funciones PURAS.
 *
 * Cambio pedido por Nicolás el 2026-10-05 (demo PiSA). Reemplaza la regla del
 * 2026-09-30/10-02 («el elaborador/solicitante asigna»):
 *  - quien hace la solicitud SUGIERE usuarios con la misma pantalla de siempre:
 *    lo que elige queda «Sugerido» (no definitivo) hasta que se confirme;
 *  - la selección la hace quien ejecuta la PRIMERA TAREA del flujo (la que
 *    sigue a la solicitud: hoy, la elaboración, «quien crea el documento»,
 *    p. ej. Juan Mora de Calidad) y/o quien tiene el permiso de Calidad del
 *    SGC, según la política configurada (SGC_ASIGNACION_PERMISO);
 *  - el solicitante nunca selecciona en su propia solicitud, aunque ejecute la
 *    primera tarea o tenga el permiso de Calidad;
 *  - ni el solicitante ni el elaborador pueden quedar como revisores ni
 *    aprobadores de su propia solicitud (lo valida normalizeSigners).
 */

export const SGC_ASSIGNMENT_POLICIES = ['tarea', 'calidad', 'tarea_o_calidad', 'tarea_y_calidad'] as const;
export type SgcAssignmentPolicy = (typeof SGC_ASSIGNMENT_POLICIES)[number];

/**
 * Política por defecto: la MÁS SEGURA (quien ejecuta la primera tarea Y tiene
 * el permiso de Calidad). Se cambia con la variable de entorno
 * SGC_ASIGNACION_PERMISO (tarea | calidad | tarea_o_calidad | tarea_y_calidad).
 */
export const SGC_DEFAULT_ASSIGNMENT_POLICY: SgcAssignmentPolicy = 'tarea_y_calidad';

export function parseAssignmentPolicy(raw: string | null | undefined): SgcAssignmentPolicy {
  const v = (raw ?? '').trim().toLowerCase();
  return (SGC_ASSIGNMENT_POLICIES as readonly string[]).includes(v) ? (v as SgcAssignmentPolicy) : SGC_DEFAULT_ASSIGNMENT_POLICY;
}

/** La primera tarea de trabajo: la primera habilitada después de la solicitud (orden de pasos). */
export function firstWorkTask(def: SgcFlowDefinition): SgcTaskDefinition | null {
  const enabled = def.tasks.filter((t) => t.isEnabled).sort((a, b) => a.stepOrder - b.stepOrder);
  const start = [...def.tasks].sort((a, b) => a.stepOrder - b.stepOrder)[0];
  return enabled.find((t) => t !== start && t.key !== start?.key) ?? null;
}

export interface SgcAssignerInput {
  email: string;
  /** Permiso «Aseguramiento de Calidad» del SGC en la empresa. */
  isQuality: boolean;
  /** Grupos de autorización a los que pertenece la persona en la empresa. */
  poolTypeCodes: readonly string[];
  requesterEmail: string;
  elaboratorEmail: string;
  /** Correos que tienen (o tuvieron y resolvieron) la primera tarea asignada a su nombre. */
  firstTaskPeople?: readonly string[];
}

/** true si la persona ejecuta la primera tarea de trabajo del flujo de esta solicitud. */
export function executesFirstTask(def: SgcFlowDefinition, input: SgcAssignerInput): boolean {
  const first = firstWorkTask(def);
  if (!first) return false;
  const me = input.email.trim().toLowerCase();
  if (first.assignment === 'elaborador') return me === input.elaboratorEmail.trim().toLowerCase();
  if (first.assignment === 'calidad') {
    return Boolean(first.poolAuthorizationTypeCode && input.poolTypeCodes.includes(first.poolAuthorizationTypeCode)) || (input.firstTaskPeople ?? []).some((e) => e.trim().toLowerCase() === me);
  }
  return false;
}

/** Motivo por el que la persona NO puede seleccionar firmantes ni alcance, o null si puede. */
export function assignmentDenial(def: SgcFlowDefinition, input: SgcAssignerInput, policy: SgcAssignmentPolicy = SGC_DEFAULT_ASSIGNMENT_POLICY): string | null {
  const me = input.email.trim().toLowerCase();
  if (me === input.requesterEmail.trim().toLowerCase()) {
    return 'Quien hace la solicitud solo sugiere a los revisores, los aprobadores y la divulgación: los confirma o reasigna quien ejecuta la primera tarea (Aseguramiento de Calidad).';
  }
  const task = executesFirstTask(def, input);
  const quality = input.isQuality;
  const ok = policy === 'tarea' ? task : policy === 'calidad' ? quality : policy === 'tarea_o_calidad' ? task || quality : task && quality;
  if (ok) return null;
  const first = firstWorkTask(def);
  const who =
    policy === 'tarea'
      ? `quien ejecuta la tarea «${first?.name ?? 'primera tarea'}»`
      : policy === 'calidad'
        ? 'Aseguramiento de Calidad'
        : policy === 'tarea_o_calidad'
          ? `quien ejecuta la tarea «${first?.name ?? 'primera tarea'}» o Aseguramiento de Calidad`
          : `quien ejecuta la tarea «${first?.name ?? 'primera tarea'}» con el permiso de Aseguramiento de Calidad`;
  return `Solo ${who} confirma o reasigna a los revisores, los aprobadores y la divulgación.`;
}

export function canAssignParticipants(def: SgcFlowDefinition, input: SgcAssignerInput, policy?: SgcAssignmentPolicy): boolean {
  return assignmentDenial(def, input, policy) === null;
}

/** Lanza 403 si la persona no puede seleccionar firmantes ni alcance. */
export function assertCanAssignParticipants(def: SgcFlowDefinition, input: SgcAssignerInput, policy?: SgcAssignmentPolicy): void {
  const denial = assignmentDenial(def, input, policy);
  if (denial) throw new SgcError(denial, 403);
}

/**
 * Lo que falta para completar la selección: los pasos de firmantes sin nadie
 * asignado y, solo si se pide (requireScope), el alcance vacío. Por defecto el
 * alcance NO se exige: el requisito validado SGC-REQ-053 toma el departamento
 * dueño del proceso cuando nadie lo define.
 */
export function assignmentGaps(def: SgcFlowDefinition, signersByStep: ReadonlyMap<string, number>, activeScopeEntries: number, opts: { requireScope?: boolean } = {}): string[] {
  const gaps: string[] = [];
  for (const t of def.tasks.filter((x) => x.assignment === 'firmantes' && x.isEnabled).sort((a, b) => a.stepOrder - b.stepOrder)) {
    if (!signersByStep.get(t.key)) gaps.push(`los firmantes de «${t.name}»`);
  }
  if (opts.requireScope && def.tasks.some((t) => t.assignment === 'alcance' && t.isEnabled) && activeScopeEntries === 0) gaps.push('el alcance de divulgación');
  return gaps;
}

/**
 * SUGERIDO frente a CONFIRMADO, sin migración (2026-10-05): en
 * sgc.request_signer y sgc.dissemination_scope una fila con is_active = 0 y
 * SIN removed_at es una sugerencia pendiente; al confirmarla pasa a
 * is_active = 1; si se reasigna o se reemplaza, se le pone removed_at (queda
 * en el historial). Solo las filas activas entran a las tareas.
 */
export const SGC_PENDING_SUGGESTION = { is_active: false, removed_at: null } as const;

export function isPendingSuggestion(row: { is_active: boolean; removed_at: Date | null }): boolean {
  return !row.is_active && row.removed_at === null;
}

/**
 * Quien no puede seleccionar, pero es el solicitante o el elaborador, SUGIERE
 * con la misma pantalla de siempre (queda pendiente de confirmación).
 */
export function canSuggestParticipants(input: SgcAssignerInput): boolean {
  const me = input.email.trim().toLowerCase();
  return me === input.requesterEmail.trim().toLowerCase() || me === input.elaboratorEmail.trim().toLowerCase();
}

/** Política vigente, leída del entorno del servidor (SGC_ASIGNACION_PERMISO). */
export function sgcAssignmentPolicy(): SgcAssignmentPolicy {
  return parseAssignmentPolicy(typeof process !== 'undefined' ? process.env.SGC_ASIGNACION_PERMISO : undefined);
}

/** Personas que tuvieron a su nombre (o resolvieron) la primera tarea de trabajo. */
export function firstTaskPeopleOf(
  def: SgcFlowDefinition,
  tasks: readonly { task_key: string; resolved_by?: string | null; assignees?: readonly { user_email: string | null; decided_by?: string | null }[] }[]
): string[] {
  const first = firstWorkTask(def);
  if (!first) return [];
  const out = new Set<string>();
  for (const t of tasks.filter((x) => x.task_key === first.key)) {
    if (t.resolved_by) out.add(t.resolved_by.toLowerCase());
    for (const a of t.assignees ?? []) {
      if (a.user_email) out.add(a.user_email.toLowerCase());
      if (a.decided_by) out.add(a.decided_by.toLowerCase());
    }
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Papeles excluyentes y aprobador de Calidad (PIC/S PE 009 cap. 6.6.4 y
// 21 CFR 211.22, investigación normativa del 2026-10-05)
// ---------------------------------------------------------------------------

/**
 * (1) Una misma persona no tiene dos papeles en la misma solicitud:
 * elaborador, revisor y aprobador se excluyen entre sí, y el solicitante no
 * revisa ni aprueba. Devuelve el choque de quien se quiere poner como firmante
 * del paso `stepKey` con un firmante activo de OTRO paso de firmantes, o null.
 * (El elaborador y el solicitante los rechaza normalizeSigners.)
 */
export function exclusiveRoleClash(
  desired: readonly { email: string }[],
  stepKey: string,
  otherActive: readonly { email: string; stepKey: string }[]
): { email: string; stepKey: string } | null {
  for (const d of desired) {
    const hit = otherActive.find((o) => o.stepKey !== stepKey && o.email.toLowerCase() === d.email.toLowerCase());
    if (hit) return { email: d.email, stepKey: hit.stepKey };
  }
  return null;
}

/**
 * Para tomar un cupo de GRUPO dentro de un paso de firmantes (p. ej. la
 * verificación de Calidad de la aprobación): no puede ser el solicitante, el
 * elaborador ni un firmante de OTRO paso (sería revisor y aprobador a la vez).
 * Devuelve el motivo o null.
 */
export function poolSlotRoleDenial(
  me: string,
  stepKey: string,
  ctx: { requesterEmail: string; elaboratorEmail: string; signers: readonly { email: string; stepKey: string }[] }
): string | null {
  const m = me.toLowerCase();
  if (m === ctx.requesterEmail.toLowerCase()) return 'Quien hizo la solicitud no revisa ni aprueba su propia solicitud.';
  if (m === ctx.elaboratorEmail.toLowerCase()) return 'El elaborador no puede revisar ni aprobar su propio documento.';
  if (ctx.signers.some((s) => s.stepKey !== stepKey && s.email.toLowerCase() === m)) {
    return 'Usted ya tiene otro papel en esta solicitud (revisor o aprobador): elaborador, revisor y aprobador son excluyentes. Otra persona del grupo debe tomar este cupo.';
  }
  return null;
}

/**
 * (2) Al menos un aprobador de Calidad: los pasos de aprobación (firma
 * «Aprobó») que NO traen el cupo fijo del grupo de Calidad. En el flujo
 * documental (v1–v3) la aprobación siempre lleva el grupo SGC-VERIF-CALIDAD,
 * así que la lista sale vacía; si un flujo futuro lo quitara, el motor exige
 * que entre los aprobadores nombrados haya alguien con el permiso de Calidad.
 */
export function approvalStepsWithoutQualityPool(def: SgcFlowDefinition): SgcTaskDefinition[] {
  return def.tasks.filter((t) => t.isEnabled && t.assignment === 'firmantes' && t.signatureMeaning === 'aprobo' && !t.poolAuthorizationTypeCode);
}
