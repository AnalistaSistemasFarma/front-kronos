import type { Prisma } from '../../../app/generated/prisma';
import { bogotaDay } from '../approvers';
import { SgcError } from '../errors';
import { requesterElaborates, type SgcFlowDefinition, type SgcTaskDefinition } from '../flows/definition';
import { departmentLeaderDenial, departmentLeaderPolicyApplies, departmentSignerDenial, departmentSignerOptions, type SgcDepartmentContext } from '../flows/roleModel';
import { signerStepKind } from '../flows/segregation';
import type { SgcDb } from './catalogs';
import { assertApproversAuthorized, canApprove, isApprovalStep } from './approvers';
import { isDepartmentLeaderListEnforced } from './companySettings';
import { listEligibleUsers, listQualityEmails } from './requests';

/**
 * S15 — reglas del DOC v7 que necesitan la base (departamentos de SynerLink,
 * permiso de Calidad, lista de líderes por departamento). Ver
 * lib/sgc/flows/roleModel.ts. Con una versión anterior del flujo
 * (calidad_asigna) se aplica lo de antes (lista del S12 por proceso).
 */

type Tx = Prisma.TransactionClient;
type Db = SgcDb | Tx;

const low = (e: string | null | undefined) => (e ?? '').trim().toLowerCase();

/** Departamentos (dbo.department_user) de cada persona, en minúscula. */
export async function departmentsOfEmails(db: Db, emails: readonly string[]): Promise<Map<string, Set<number>>> {
  const list = [...new Set(emails.map(low).filter(Boolean))];
  const out = new Map<string, Set<number>>();
  if (list.length === 0) return out;
  const rows = await db.departmentUser.findMany({ where: { user: { email: { in: list } } }, select: { id_department: true, user: { select: { email: true } } } });
  for (const r of rows) {
    const e = low(r.user.email);
    const set = out.get(e) ?? new Set<number>();
    set.add(r.id_department);
    out.set(e, set);
  }
  return out;
}

/** Contexto de departamento del elaborador de la solicitud y de las personas indicadas. */
export async function departmentContextFor(db: Db, request: { id_company: number; elaborator_email: string }, emails: readonly string[]): Promise<SgcDepartmentContext> {
  const elaborator = low(request.elaborator_email);
  const [departmentsOf, quality] = await Promise.all([departmentsOfEmails(db, [elaborator, ...emails]), listQualityEmails(db, request.id_company)]);
  const elaboratorDepartments = departmentsOf.get(elaborator) ?? new Set<number>();
  const ids = [...new Set([...departmentsOf.values()].flatMap((s) => [...s]))];
  const names = ids.length ? await db.department.findMany({ where: { id_department: { in: ids } }, select: { id_department: true, department: true } }) : [];
  return { elaboratorDepartments, departmentsOf, quality, departmentNames: new Map(names.map((n) => [n.id_department, n.department])) };
}

/** Líderes por departamento registrados en la empresa (vigentes o no: la lista manda una vez cargada). */
async function departmentLeaders(db: Db, idCompany: number) {
  return db.sgcApproverAuthorization.findMany({ where: { id_company: idCompany, id_department: { not: null } }, select: { user_email: true, id_department: true, valid_from: true, valid_to: true, revoked_at: true } });
}

/**
 * Valida los firmantes de un paso (además de la segregación de normalizeSigners):
 *  - DOC v7: revisores del departamento del elaborador o de Calidad;
 *    aprobadores del departamento y, con la lista por departamento aplicada
 *    (D16), líderes vigentes de ese departamento;
 *  - versiones anteriores: la lista de aprobadores autorizados del S12.
 */
export async function assertSignersAllowed(
  tx: Db,
  request: { id_company: number; id_process_map: number | null; elaborator_email: string },
  def: Pick<SgcFlowDefinition, 'roleModel'>,
  stepDef: Pick<SgcTaskDefinition, 'assignment' | 'signatureMeaning' | 'name'>,
  emails: readonly string[],
  at: Date
): Promise<void> {
  if (!requesterElaborates(def)) return assertApproversAuthorized(tx, request, stepDef, emails, at);
  if (emails.length === 0) return;
  const kind = signerStepKind(stepDef);
  if (kind === 'otro') return;
  const ctx = await departmentContextFor(tx, request, emails);
  for (const e of emails) {
    const denial = departmentSignerDenial(e, kind, stepDef.name, ctx);
    if (denial) throw new SgcError(denial, 409);
  }
  if (kind === 'aprobacion' && departmentLeaderPolicyApplies(await isDepartmentLeaderListEnforced(tx, request.id_company))) {
    const denial = departmentLeaderDenial(emails, await departmentLeaders(tx, request.id_company), ctx.elaboratorDepartments, bogotaDay(at).getTime(), stepDef.name, ctx.departmentNames);
    if (denial) throw new SgcError(denial, 409);
  }
}

/**
 * ¿La persona puede APROBAR hoy? DOC v7: sin restricción salvo la lista por
 * departamento encendida (D16); antes, la lista del S12 por proceso.
 */
export async function canApproveFor(
  db: Db,
  request: { id_company: number; id_process_map: number | null; elaborator_email: string },
  def: Pick<SgcFlowDefinition, 'roleModel'>,
  email: string,
  at: Date
): Promise<boolean> {
  if (!requesterElaborates(def)) return canApprove(db, request.id_company, email, request.id_process_map, at);
  if (!departmentLeaderPolicyApplies(await isDepartmentLeaderListEnforced(db, request.id_company))) return true;
  const ctx = await departmentContextFor(db, request, [email]);
  return departmentLeaderDenial([email], await departmentLeaders(db, request.id_company), ctx.elaboratorDepartments, bogotaDay(at).getTime(), 'Aprobación', ctx.departmentNames) === null;
}

export interface SgcSignerScope {
  /** true = la pantalla solo ofrece a las personas del departamento (DOC v7). */
  restricted: boolean;
  departments: string[];
  reviewers: string[];
  approvers: string[];
  /** D16: la lista de líderes por departamento restringe la aprobación. */
  leadersEnforced: boolean;
  /** Aviso para la pantalla (sin departamento, sin líderes cargados…). */
  notice: string | null;
}

/** Personas que la pantalla OFRECE como revisores y aprobadores en una solicitud del DOC v7. */
export async function signerScopeFor(db: SgcDb, request: { id_company: number; id_process_map: number | null; elaborator_email: string }, def: Pick<SgcFlowDefinition, 'roleModel'>, at = new Date()): Promise<SgcSignerScope | null> {
  if (!requesterElaborates(def)) return null;
  const eligible = (await listEligibleUsers(db, request.id_company)).map((u) => u.email);
  const ctx = await departmentContextFor(db, request, eligible);
  const options = departmentSignerOptions(eligible, ctx);
  const leadersEnforced = departmentLeaderPolicyApplies(await isDepartmentLeaderListEnforced(db, request.id_company));
  let approvers = options.approvers;
  let notice: string | null = null;
  if (ctx.elaboratorDepartments.size === 0) notice = 'Quien elabora no tiene departamento asignado en SynerLink: pídale a TI que se lo asigne para poder elegir revisores y aprobadores de su departamento.';
  else if (leadersEnforced) {
    const leaders = await departmentLeaders(db, request.id_company);
    approvers = approvers.filter((e) => departmentLeaderDenial([e], leaders, ctx.elaboratorDepartments, bogotaDay(at).getTime(), 'Aprobación') === null);
    if (approvers.length === 0) notice = departmentLeaderDenial([], leaders, ctx.elaboratorDepartments, bogotaDay(at).getTime(), 'Aprobación', ctx.departmentNames) ?? 'No hay líderes aprobadores vigentes en el departamento de quien elabora.';
  }
  return {
    restricted: true,
    departments: [...ctx.elaboratorDepartments].map((d) => ctx.departmentNames?.get(d) ?? `#${d}`),
    reviewers: options.reviewers,
    approvers,
    leadersEnforced,
    notice,
  };
}

/** Para el sustituto de un APROBADOR: ¿debe estar autorizado y lo está? (S12 o, en el DOC v7, la lista por departamento). */
export async function substituteApproverCheck(
  tx: Db,
  request: { id_company: number; id_process_map: number | null; elaborator_email: string },
  def: Pick<SgcFlowDefinition, 'roleModel'>,
  stepDef: Pick<SgcTaskDefinition, 'assignment' | 'signatureMeaning'>,
  email: string,
  at: Date
): Promise<{ mustBeAuthorizedApprover: boolean; isAuthorizedApprover: boolean }> {
  if (!isApprovalStep(stepDef)) return { mustBeAuthorizedApprover: false, isAuthorizedApprover: false };
  if (!requesterElaborates(def)) return { mustBeAuthorizedApprover: true, isAuthorizedApprover: await canApprove(tx, request.id_company, email, request.id_process_map, at) };
  const enforced = departmentLeaderPolicyApplies(await isDepartmentLeaderListEnforced(tx, request.id_company));
  return { mustBeAuthorizedApprover: enforced, isAuthorizedApprover: !enforced || (await canApproveFor(tx, request, def, email, at)) };
}
