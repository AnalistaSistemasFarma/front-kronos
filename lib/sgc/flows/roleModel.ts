import { requesterElaborates, type SgcFlowDefinition, type SgcTaskDefinition } from './definition';
import type { SgcSignerStepKind } from './segregation';

/**
 * S15 — NUEVO MODELO DE ROLES del flujo documental (DOC v7) — funciones PURAS.
 *
 * RN de la primera prueba en producción con Calidad OLP (2026-10-13; memoria
 * rn-sgc-solicitante-elabora-y-asigna-firmantes) y decisiones de Nicolás del
 * 2026-10-13 14:44 (D14, D15 y D16):
 *  - R16 · quien hace la solicitud la ELABORA (D15: sin la restricción de
 *    segregación solicitante ≠ elaborador). La redirección de la elaboración
 *    queda solo como excepción de Calidad, con motivo.
 *  - R17 · el elaborador asigna revisores y aprobadores de SU MISMO
 *    DEPARTAMENTO (dbo.department_user de SynerLink); no hay sugerencia ni
 *    confirmación de Calidad.
 *  - R18 · revisa alguien del área o de Aseguramiento de Calidad, nunca el
 *    elaborador (D14: el ajuste por empresa «Calidad revisa lo que elaboró»
 *    se conserva; en OLP sigue encendido).
 *  - R19 · aprueba el líder del departamento, según la lista de líderes por
 *    departamento (D16: la lista existe pero NO restringe hasta que la empresa
 *    encienda el ajuste; apagado por defecto).
 * Las versiones anteriores (calidad_asigna) no cambian.
 */

const low = (e: string | null | undefined) => (e ?? '').trim().toLowerCase();

/** Paso de ELABORACIÓN del flujo (asignación «elaborador»). */
export function elaborationStep(def: SgcFlowDefinition): SgcTaskDefinition | null {
  return def.tasks.filter((t) => t.assignment === 'elaborador' && t.isEnabled).sort((a, b) => a.stepOrder - b.stepOrder)[0] ?? null;
}

/**
 * Paso en el que deben quedar completos los firmantes antes de avanzar:
 * en el DOC v7, la ELABORACIÓN (los asigna el propio elaborador); antes, la
 * primera tarea de trabajo (quien la ejecuta confirma lo sugerido).
 */
export function assignmentStepKey(def: SgcFlowDefinition, firstWorkKey: string | null): string | null {
  if (requesterElaborates(def)) return elaborationStep(def)?.key ?? null;
  return firstWorkKey;
}

/** DOC v7: ¿quién asigna revisores, aprobadores y alcance? El elaborador o Aseguramiento de Calidad. */
export function roleModelAssignmentDenial(input: { email: string; elaboratorEmail: string; isQuality: boolean }): string | null {
  if (low(input.email) === low(input.elaboratorEmail) || input.isQuality) return null;
  return 'Los revisores, los aprobadores y la divulgación los asigna quien elabora el documento (de su mismo departamento) o, como excepción, Aseguramiento de Calidad.';
}

export interface SgcDepartmentContext {
  /** Departamentos del ELABORADOR (dbo.department_user). */
  elaboratorDepartments: ReadonlySet<number>;
  /** Departamentos de cada persona (en minúscula). */
  departmentsOf: ReadonlyMap<string, ReadonlySet<number>>;
  /** Personas con el permiso de Aseguramiento de Calidad del SGC (en minúscula). */
  quality: ReadonlySet<string>;
  /** Nombres de los departamentos (para los mensajes). */
  departmentNames?: ReadonlyMap<number, string>;
}

function sharesDepartment(email: string, ctx: SgcDepartmentContext): boolean {
  const mine = ctx.departmentsOf.get(low(email));
  if (!mine) return false;
  for (const d of mine) if (ctx.elaboratorDepartments.has(d)) return true;
  return false;
}

function departmentsLabel(ctx: SgcDepartmentContext): string {
  const names = [...ctx.elaboratorDepartments].map((d) => ctx.departmentNames?.get(d) ?? `#${d}`);
  return names.length ? names.join(', ') : 'sin departamento';
}

/**
 * R17/R18 · Motivo por el que la persona NO puede ser firmante del paso por
 * DEPARTAMENTO (o null si puede): revisor del mismo departamento del
 * elaborador o de Aseguramiento de Calidad; aprobador del mismo departamento.
 */
export function departmentSignerDenial(email: string, kind: SgcSignerStepKind, stepName: string, ctx: SgcDepartmentContext): string | null {
  if (ctx.elaboratorDepartments.size === 0) {
    return `Quien elabora no tiene departamento asignado en SynerLink: sin él no se pueden asignar firmantes de «${stepName}». Pídale a TI que le asigne su departamento (R40).`;
  }
  if (sharesDepartment(email, ctx)) return null;
  if (kind === 'revision' && ctx.quality.has(low(email))) return null;
  return kind === 'revision'
    ? `${email} no es del departamento de quien elabora (${departmentsLabel(ctx)}) ni de Aseguramiento de Calidad: no puede revisar este documento.`
    : `${email} no es del departamento de quien elabora (${departmentsLabel(ctx)}): no puede quedar en «${stepName}».`;
}

/** Personas que la pantalla OFRECE en cada paso (filtradas por departamento). */
export function departmentSignerOptions(emails: readonly string[], ctx: SgcDepartmentContext): { reviewers: string[]; approvers: string[] } {
  const reviewers = emails.filter((e) => departmentSignerDenial(e, 'revision', 'Revisión', ctx) === null);
  const approvers = emails.filter((e) => departmentSignerDenial(e, 'aprobacion', 'Aprobación', ctx) === null);
  return { reviewers, approvers };
}

export interface SgcDepartmentLeaderRow {
  user_email: string;
  id_department: number | null;
  valid_from: Date;
  valid_to: Date | null;
  revoked_at: Date | null;
}

/**
 * R19/D16 · ¿Se aplica la lista de líderes que aprueban por departamento?
 * Solo con el ajuste de la empresa ENCENDIDO (apagado por defecto: «por ahora
 * sin restricción», Nicolás 2026-10-13 14:44).
 */
export function departmentLeaderPolicyApplies(enforced: boolean): boolean {
  return enforced;
}

function activeOn(row: SgcDepartmentLeaderRow, day: number): boolean {
  return !row.revoked_at && row.valid_from.getTime() <= day && (!row.valid_to || row.valid_to.getTime() >= day);
}

/**
 * Con la lista aplicada: aprobadores propuestos que NO son líderes vigentes de
 * alguno de los departamentos del elaborador. Si esos departamentos no tienen
 * líderes cargados, la solicitud AVISA (no deja pasar a cualquiera): devuelve
 * el mensaje de lista vacía.
 */
export function departmentLeaderDenial(
  emails: readonly string[],
  list: readonly SgcDepartmentLeaderRow[],
  elaboratorDepartments: ReadonlySet<number>,
  bogotaDayMs: number,
  stepName: string,
  names?: ReadonlyMap<number, string>
): string | null {
  const rows = list.filter((r) => r.id_department !== null && elaboratorDepartments.has(r.id_department));
  const label = [...elaboratorDepartments].map((d) => names?.get(d) ?? `#${d}`).join(', ') || 'sin departamento';
  if (rows.length === 0) return `El departamento de quien elabora (${label}) no tiene líderes aprobadores cargados: Aseguramiento de Calidad debe registrarlos en Configuración → Aprobadores autorizados antes de asignar «${stepName}».`;
  const bad = emails.map(low).filter((e) => !rows.some((r) => low(r.user_email) === e && activeOn(r, bogotaDayMs)));
  if (bad.length === 0) return null;
  return `${bad.join(', ')} no ${bad.length === 1 ? 'es líder aprobador vigente' : 'son líderes aprobadores vigentes'} del departamento de quien elabora (${label}): no ${bad.length === 1 ? 'puede' : 'pueden'} quedar en «${stepName}».`;
}

/**
 * D15 · Si el solicitante es de Calidad, autoriza la creación OTRA persona de
 * Calidad: nadie decide la autorización de su propia solicitud.
 */
export function creationAuthorizationDenial(me: string, requesterEmail: string): string | null {
  return low(me) === low(requesterEmail) ? 'Quien hizo la solicitud no autoriza su propia creación: la autoriza otra persona de Aseguramiento de Calidad.' : null;
}

/** R15 · Motivo del rechazo de la creación (obligatorio, 10 a 1.000 caracteres). */
export function normalizeRejectionReason(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (s.length < 10) return '';
  return s.slice(0, 1000);
}
