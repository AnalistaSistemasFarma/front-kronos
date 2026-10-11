import { SgcError } from './errors';

/**
 * APROBADORES AUTORIZADOS y FIRMANTE SUSTITUTO (Sprint 12, socialización con
 * Calidad OLP del 2026-10-07; requisitos R11 y R12) — funciones PURAS.
 *
 * R11 · En el área todos elaboran y revisan, pero APRUEBA solo el cargo
 * autorizado (jefe o Dirección Técnica). SynerLink no relaciona personas con
 * cargos, así que la lista es POR PERSONA y por proceso (decisión D9), con
 * vigencia y motivo, y la mantiene Aseguramiento de Calidad (María Camila).
 * Con la lista activa (company_config.approver_list_enforced) y al menos una
 * persona autorizada en la empresa, el servidor rechaza a un aprobador que no
 * esté en ella y la pantalla solo ofrece a los autorizados. Con la lista
 * vacía nada cambia (no se bloquea a una empresa que aún no la carga).
 *
 * R12 · Cuando el titular de un cupo pendiente está ausente, SOLO el grupo
 * exclusivo SGC-SUSTITUTOS (María Camila y un suplente nombrado por Dirección
 * Técnica, decisión D8) asigna un sustituto, con motivo y periodo de ausencia.
 * El sustituto cumple las mismas reglas (segregación y, si el paso es de
 * aprobación, estar autorizado). La firma queda «Firmó X en sustitución de Y».
 */

/** Tipo de autorización (grupo exclusivo) que asigna firmantes sustitutos. */
export const SGC_AUTH_TYPE_SUBSTITUTES = 'SGC-SUSTITUTOS';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function email(raw: unknown, label: string): string {
  const e = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(e) || e.length > 255) throw new SgcError(`${label}: escriba un correo válido.`);
  return e;
}

function reasonOf(raw: unknown, label: string): string {
  const r = typeof raw === 'string' ? raw.trim() : '';
  if (r.length < 5) throw new SgcError(`${label} (mínimo 5 caracteres): queda en el historial.`);
  if (r.length > 1000) throw new SgcError(`${label}: máximo 1.000 caracteres.`);
  return r;
}

/** Fecha «YYYY-MM-DD» (día calendario) → Date a medianoche UTC; null si viene vacía y es opcional. */
export function dayOf(raw: unknown, label: string, optional: boolean): Date | null {
  if ((raw === undefined || raw === null || raw === '') && optional) return null;
  const s = typeof raw === 'string' ? raw.trim().slice(0, 10) : '';
  const d = DATE_RE.test(s) ? new Date(`${s}T00:00:00Z`) : null;
  if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new SgcError(`${label}: use una fecha válida (AAAA-MM-DD).`);
  return d;
}

/** Día calendario de Colombia (medianoche UTC de ese día) para comparar con las vigencias. */
export function bogotaDay(at: Date): Date {
  const b = new Date(at.getTime() - 5 * 3600 * 1000);
  return new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()));
}

export interface SgcApproverAuthorizationInput {
  email: string;
  idProcessMap: number | null;
  validFrom: Date;
  validTo: Date | null;
  reason: string;
}

/** Valida una autorización de aprobador (correo, proceso o todos, vigencia y motivo). */
export function normalizeApproverAuthorization(raw: unknown, today: Date): SgcApproverAuthorizationInput {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const e = email(r.email, 'Aprobador');
  const proc = r.idProcessMap === undefined || r.idProcessMap === null || r.idProcessMap === '' ? null : Number(r.idProcessMap);
  if (proc !== null && (!Number.isInteger(proc) || proc <= 0)) throw new SgcError('Proceso inválido.');
  const validFrom = dayOf(r.validFrom, 'Vigente desde', true) ?? bogotaDay(today);
  const validTo = dayOf(r.validTo, 'Vigente hasta', true);
  if (validTo && validTo.getTime() < validFrom.getTime()) throw new SgcError('La vigencia termina antes de empezar.');
  return { email: e, idProcessMap: proc, validFrom, validTo, reason: reasonOf(r.reason, 'Escriba el motivo de la autorización') };
}

export interface SgcApproverAuthorizationRow {
  user_email: string;
  id_process_map: number | null;
  valid_from: Date;
  valid_to: Date | null;
  revoked_at: Date | null;
}

/** ¿La autorización está vigente ese día (sin revocar y dentro de su periodo)? */
export function isAuthorizationActive(a: SgcApproverAuthorizationRow, at: Date): boolean {
  if (a.revoked_at) return false;
  const day = bogotaDay(at).getTime();
  return a.valid_from.getTime() <= day && (!a.valid_to || a.valid_to.getTime() >= day);
}

/** Estado visible de una autorización. */
export function authorizationStatus(a: SgcApproverAuthorizationRow, at: Date): 'vigente' | 'programada' | 'vencida' | 'revocada' {
  if (a.revoked_at) return 'revocada';
  const day = bogotaDay(at).getTime();
  if (a.valid_from.getTime() > day) return 'programada';
  if (a.valid_to && a.valid_to.getTime() < day) return 'vencida';
  return 'vigente';
}

/** ¿La persona aprueba documentos de ese proceso ese día? (una autorización «todos los procesos» sirve para cualquiera). */
export function isAuthorizedApprover(list: readonly SgcApproverAuthorizationRow[], who: string, idProcessMap: number | null, at: Date): boolean {
  const e = who.trim().toLowerCase();
  return list.some((a) => a.user_email.trim().toLowerCase() === e && (a.id_process_map === null || a.id_process_map === idProcessMap) && isAuthorizationActive(a, at));
}

/**
 * ¿Se aplica la lista? Solo si la empresa la tiene activa Y ya registró al
 * menos un aprobador (aunque esté vencido o revocado: una vez cargada, la
 * lista manda; así revocar al último no abre la puerta a cualquiera).
 */
export function approverListApplies(enforced: boolean, list: readonly SgcApproverAuthorizationRow[]): boolean {
  return enforced && list.length > 0;
}

/** Aprobadores propuestos que NO están autorizados (vacío si la lista no aplica). */
export function unauthorizedApprovers(
  policy: { enforced: boolean; list: readonly SgcApproverAuthorizationRow[] },
  emails: readonly string[],
  idProcessMap: number | null,
  at: Date
): string[] {
  if (!approverListApplies(policy.enforced, policy.list)) return [];
  return emails.map((e) => e.trim().toLowerCase()).filter((e) => !isAuthorizedApprover(policy.list, e, idProcessMap, at));
}

export function unauthorizedApproverMessage(emails: readonly string[], stepName: string): string {
  return `${emails.join(', ')} no ${emails.length === 1 ? 'está' : 'están'} en la lista de aprobadores autorizados de este proceso: no ${emails.length === 1 ? 'puede' : 'pueden'} quedar en «${stepName}». Aseguramiento de Calidad mantiene la lista.`;
}

// ---------------------------------------------------------------------------
// Firmante sustituto
// ---------------------------------------------------------------------------

export interface SgcSubstitutionInput {
  toEmail: string;
  reason: string;
  absenceFrom: Date | null;
  absenceTo: Date | null;
}

/** Valida la asignación de un sustituto: a quién, motivo y periodo de ausencia (opcional, coherente). */
export function normalizeSubstitution(raw: unknown): SgcSubstitutionInput {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const toEmail = email(r.toEmail, 'Sustituto');
  const reason = reasonOf(r.reason, 'Escriba el motivo de la sustitución');
  const absenceFrom = dayOf(r.absenceFrom, 'Ausente desde', true);
  const absenceTo = dayOf(r.absenceTo, 'Ausente hasta', true);
  if (absenceFrom && absenceTo && absenceTo.getTime() < absenceFrom.getTime()) throw new SgcError('El periodo de ausencia termina antes de empezar.');
  return { toEmail, reason, absenceFrom, absenceTo };
}

export interface SgcSubstitutionContext {
  originalEmail: string;
  requesterEmail: string;
  elaboratorEmail: string;
  /** Personas con cupo VIVO (pendiente o ya decidido) en la misma tarea. */
  taskPeople: readonly string[];
  eligible: ReadonlySet<string>;
  /** Paso de aprobación con la lista de aprobadores aplicando: el sustituto debe estar autorizado. */
  mustBeAuthorizedApprover: boolean;
  isAuthorizedApprover: boolean;
}

/**
 * Por qué NO puede ser sustituto (null si puede): mismas reglas que un
 * firmante (gestión documental, segregación con solicitante y elaborador, sin
 * duplicar a alguien del paso) y, en aprobación, aprobador autorizado.
 */
export function substitutionDenial(to: string, ctx: SgcSubstitutionContext): string | null {
  const e = to.trim().toLowerCase();
  const lc = (x: string) => x.trim().toLowerCase();
  if (e === lc(ctx.originalEmail)) return 'El sustituto debe ser una persona distinta del titular.';
  if (!ctx.eligible.has(e)) return `${e} no tiene permiso de gestión documental en el SGC de esta empresa.`;
  if (e === lc(ctx.requesterEmail)) return 'Quien hizo la solicitud no puede firmarla (ni como sustituto).';
  if (e === lc(ctx.elaboratorEmail)) return 'El elaborador no puede revisar ni aprobar su propio documento (ni como sustituto).';
  if (ctx.taskPeople.some((p) => lc(p) === e)) return `${e} ya firma en este paso: elija a otra persona.`;
  if (ctx.mustBeAuthorizedApprover && !ctx.isAuthorizedApprover) return `${e} no está en la lista de aprobadores autorizados: el sustituto de un aprobador también debe estarlo.`;
  return null;
}

/** «Ana Gómez en sustitución de luis@olp.co» (para el historial, la bandeja y el PDF). */
export function onBehalfLabel(who: string, onBehalfOf: string | null | undefined): string {
  return onBehalfOf ? `${who} en sustitución de ${onBehalfOf}` : who;
}
