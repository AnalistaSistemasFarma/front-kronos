import type { Prisma } from '../../../app/generated/prisma';
import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import {
  SGC_AUTH_TYPE_SUBSTITUTES,
  approverListApplies,
  authorizationStatus,
  isAuthorizedApprover,
  normalizeApproverAuthorization,
  unauthorizedApproverMessage,
  unauthorizedApprovers,
  type SgcApproverAuthorizationRow,
} from '../approvers';
import { SgcError } from '../errors';
import type { SgcTaskDefinition } from '../flows/definition';
import type { SgcCompanyAccess } from '../permissions';
import type { SgcActor, SgcDb } from './catalogs';
import { getPoolTypeCodes } from './authorizations';
import { listEligibleUsers } from './requests';

/**
 * APROBADORES AUTORIZADOS (Sprint 12, R11). Ver lib/sgc/approvers.ts.
 * La lista la administra Aseguramiento de Calidad; el servidor la aplica al
 * asignar o confirmar aprobadores y al asignar un sustituto.
 */

type Tx = Prisma.TransactionClient;

function lower(e: string | null | undefined): string {
  return (e ?? '').trim().toLowerCase();
}

export interface SgcApproverPolicy {
  enforced: boolean;
  list: SgcApproverAuthorizationRow[];
  applies: boolean;
}

/** Política de la empresa: si la lista está activa y las autorizaciones registradas. */
export async function getApproverPolicy(db: SgcDb | Tx, idCompany: number): Promise<SgcApproverPolicy> {
  const cfg = await db.sgcCompanyConfig.findUnique({ where: { id_company: idCompany }, select: { approver_list_enforced: true } });
  const list = await db.sgcApproverAuthorization.findMany({ where: { id_company: idCompany }, select: { user_email: true, id_process_map: true, valid_from: true, valid_to: true, revoked_at: true } });
  const enforced = cfg?.approver_list_enforced ?? true;
  return { enforced, list, applies: approverListApplies(enforced, list) };
}

/** ¿El paso es de APROBACIÓN con firmantes elegidos (donde aplica la lista)? */
export function isApprovalStep(stepDef: Pick<SgcTaskDefinition, 'assignment' | 'signatureMeaning'> | undefined | null): boolean {
  return Boolean(stepDef && stepDef.assignment === 'firmantes' && stepDef.signatureMeaning === 'aprobo');
}

/** Rechaza (409) a los aprobadores que no estén en la lista vigente del proceso de la solicitud. */
export async function assertApproversAuthorized(
  tx: SgcDb | Tx,
  request: { id_company: number; id_process_map: number | null },
  stepDef: Pick<SgcTaskDefinition, 'assignment' | 'signatureMeaning' | 'name'>,
  emails: readonly string[],
  at: Date
): Promise<void> {
  if (!isApprovalStep(stepDef) || emails.length === 0) return;
  const policy = await getApproverPolicy(tx, request.id_company);
  const bad = unauthorizedApprovers(policy, emails, request.id_process_map, at);
  if (bad.length) throw new SgcError(unauthorizedApproverMessage(bad, stepDef.name), 409);
}

/** ¿La persona aprueba documentos de ese proceso hoy? (true si la lista no aplica). */
export async function canApprove(db: SgcDb | Tx, idCompany: number, email: string, idProcessMap: number | null, at: Date): Promise<boolean> {
  const policy = await getApproverPolicy(db, idCompany);
  return !policy.applies || isAuthorizedApprover(policy.list, email, idProcessMap, at);
}

/**
 * Personas que la pantalla OFRECE como aprobadoras de un proceso: las
 * elegibles del SGC filtradas por la lista (si aplica). `restricted` indica
 * si se filtró.
 */
export async function listApproverOptions(db: SgcDb, idCompany: number, idProcessMap: number | null, at: Date) {
  const users = await listEligibleUsers(db, idCompany);
  const policy = await getApproverPolicy(db, idCompany);
  if (!policy.applies) return { restricted: false, users };
  return { restricted: true, users: users.filter((u) => isAuthorizedApprover(policy.list, u.email, idProcessMap, at)) };
}

/** ¿La persona asigna firmantes sustitutos en la empresa? (grupo exclusivo SGC-SUSTITUTOS). */
export async function isSubstituteAssigner(db: SgcDb | Tx, idCompany: number, email: string): Promise<boolean> {
  return (await getPoolTypeCodes(db as Tx, idCompany, email)).includes(SGC_AUTH_TYPE_SUBSTITUTES);
}

function assertQuality(access: SgcCompanyAccess | null): asserts access is SgcCompanyAccess {
  if (!access?.canQuality) throw new SgcError('Solo Aseguramiento de Calidad administra la lista de aprobadores autorizados.', 403);
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Lista para la pantalla de Calidad (todas, con su estado). */
export async function listApproverAuthorizations(db: SgcDb, access: SgcCompanyAccess | null, now = new Date()) {
  assertQuality(access);
  const rows = await db.sgcApproverAuthorization.findMany({ where: { id_company: access.idCompany }, include: { process: { select: { code: true, name: true } } }, orderBy: [{ user_email: 'asc' }, { id_approver_authorization: 'desc' }] });
  const cfg = await db.sgcCompanyConfig.findUnique({ where: { id_company: access.idCompany }, select: { approver_list_enforced: true } });
  const enforced = cfg?.approver_list_enforced ?? true;
  return {
    enforced,
    applies: approverListApplies(enforced, rows),
    items: rows.map((r) => {
      const status = authorizationStatus(r, now);
      return {
        id: r.id_approver_authorization,
        email: r.user_email,
        idProcessMap: r.id_process_map,
        process: r.process ? `${r.process.code} · ${r.process.name}` : 'Todos los procesos',
        validFrom: iso(r.valid_from),
        validTo: iso(r.valid_to),
        reason: r.reason,
        grantedBy: r.granted_by,
        grantedAt: r.granted_at.toISOString(),
        revokedBy: r.revoked_by,
        revokedAt: r.revoked_at?.toISOString() ?? null,
        revokeReason: r.revoke_reason,
        status,
      };
    }),
  };
}

/** Autoriza a una persona como aprobadora (de un proceso o de todos). */
export async function grantApproverAuthorization(db: SgcDb, access: SgcCompanyAccess | null, raw: unknown, actor: SgcActor) {
  assertQuality(access);
  const now = new Date();
  const input = normalizeApproverAuthorization(raw, now);
  const me = lower(actor.email);
  const eligible = new Set((await listEligibleUsers(db, access.idCompany)).map((u) => u.email));
  if (!eligible.has(input.email)) throw new SgcError(`${input.email} no tiene permiso de gestión documental en el SGC de esta empresa.`);
  if (input.idProcessMap !== null && !(await db.sgcProcessMap.findFirst({ where: { id_process_map: input.idProcessMap, id_company: access.idCompany } }))) throw new SgcError('Proceso no encontrado.', 404);
  return db.$transaction(async (tx) => {
    const same = await tx.sgcApproverAuthorization.findFirst({ where: { id_company: access.idCompany, user_email: input.email, id_process_map: input.idProcessMap, revoked_at: null, OR: [{ valid_to: null }, { valid_to: { gte: input.validFrom } }] } });
    if (same) throw new SgcError(`${input.email} ya está autorizado para ese proceso: revoque la autorización vigente antes de registrar otra.`, 409);
    const row = await tx.sgcApproverAuthorization.create({
      data: { id_company: access.idCompany, user_email: input.email, id_process_map: input.idProcessMap, valid_from: input.validFrom, valid_to: input.validTo, reason: input.reason, granted_by: me, granted_at: now },
    });
    await writeSgcAudit(tx, {
      idCompany: access.idCompany,
      actorEmail: me,
      action: SGC_AUDIT_ACTIONS.aprobadorAutorizado,
      entity: 'approver_authorization',
      entityId: row.id_approver_authorization,
      after: { email: input.email, idProcessMap: input.idProcessMap, validFrom: iso(input.validFrom), validTo: iso(input.validTo) },
      detail: input.reason,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return { id: row.id_approver_authorization };
  });
}

/** Revoca una autorización (no se borra: queda con quién, cuándo y por qué). */
export async function revokeApproverAuthorization(db: SgcDb, access: SgcCompanyAccess | null, id: number, raw: { reason?: unknown }, actor: SgcActor) {
  assertQuality(access);
  const reason = typeof raw?.reason === 'string' ? raw.reason.trim() : '';
  if (reason.length < 5) throw new SgcError('Escriba el motivo de la revocación (mínimo 5 caracteres).');
  if (reason.length > 1000) throw new SgcError('El motivo admite máximo 1.000 caracteres.');
  const me = lower(actor.email);
  return db.$transaction(async (tx) => {
    const row = await tx.sgcApproverAuthorization.findFirst({ where: { id_approver_authorization: id, id_company: access.idCompany } });
    if (!row) throw new SgcError('Autorización no encontrada.', 404);
    if (row.revoked_at) throw new SgcError('La autorización ya estaba revocada.', 409);
    const now = new Date();
    await tx.sgcApproverAuthorization.update({ where: { id_approver_authorization: id }, data: { revoked_by: me, revoked_at: now, revoke_reason: reason } });
    await writeSgcAudit(tx, {
      idCompany: access.idCompany,
      actorEmail: me,
      action: SGC_AUDIT_ACTIONS.aprobadorRevocado,
      entity: 'approver_authorization',
      entityId: id,
      before: { email: row.user_email, idProcessMap: row.id_process_map, status: 'vigente' },
      after: { status: 'revocada' },
      detail: reason,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return { revoked: true };
  });
}
