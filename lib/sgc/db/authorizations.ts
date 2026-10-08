import type { Prisma } from '../../../app/generated/prisma';
import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import { SGC_AUTHORIZATION_STATUS_LABELS, getAuthorizationTypeCodeError, type SgcAuthorizationStatus } from '../authorizations';
import { SgcError, isUniqueViolation } from '../errors';
import { assigneesInTurn } from '../flows/engine';
import type { SgcCompanyAccess } from '../permissions';
import type { SgcActor, SgcDb } from './catalogs';
import { requireReason, writeConfigChange } from './flows';
import { SGC_AUTH_TYPE_QUALITY } from '../flows/documentFlow';
import { listEligibleUsers } from './requests';

/**
 * Autorizaciones SGC (módulo independiente, tablas propias): tipos, grupos
 * de cada tipo y bandeja. La DECISIÓN se toma con el mismo motor de la tarea
 * (lib/sgc/db/requests.ts → decideTask), para que una autorización y su
 * tarea nunca queden en desacuerdo.
 */

type Tx = Prisma.TransactionClient | SgcDb;

/** Tipos de autorización a cuyo grupo pertenece la persona en la empresa (vigentes). */
export async function getPoolTypeCodes(db: Tx, idCompany: number, email: string): Promise<string[]> {
  const rows = await db.sgcAuthorizationTypeUser.findMany({
    where: { user_email: email.toLowerCase(), revoked_at: null, type: { id_company: idCompany, is_active: true } },
    select: { type: { select: { code: true } } },
  });
  return [...new Set(rows.map((r) => r.type.code))];
}

/** Correos del grupo de un tipo (para notificar un cupo de grupo). */
export async function getPoolMembers(db: Tx, idCompany: number, code: string): Promise<string[]> {
  const rows = await db.sgcAuthorizationTypeUser.findMany({
    where: { revoked_at: null, type: { id_company: idCompany, code, is_active: true } },
    select: { user_email: true },
  });
  return [...new Set(rows.map((r) => r.user_email.toLowerCase()))];
}

export interface SgcAuthorizationTypeRow {
  id: number;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  members: { id: number; email: string; name: string | null; grantedBy: string; reason: string; createdAt: string }[];
}

export async function listAuthorizationTypes(db: SgcDb, idCompany: number): Promise<SgcAuthorizationTypeRow[]> {
  const types = await db.sgcAuthorizationType.findMany({
    where: { id_company: idCompany },
    include: { users: { where: { revoked_at: null }, orderBy: { user_email: 'asc' } } },
    orderBy: [{ is_active: 'desc' }, { name: 'asc' }],
  });
  const emails = [...new Set(types.flatMap((t) => t.users.map((u) => u.user_email)))];
  const users = emails.length ? await db.user.findMany({ where: { email: { in: emails } }, select: { email: true, name: true } }) : [];
  const names = new Map(users.map((u) => [u.email.toLowerCase(), u.name]));
  return types.map((t) => ({
    id: t.id_authorization_type,
    code: t.code,
    name: t.name,
    description: t.description,
    isActive: t.is_active,
    members: t.users.map((u) => ({
      id: u.id_authorization_type_user,
      email: u.user_email,
      name: names.get(u.user_email.toLowerCase()) ?? null,
      grantedBy: u.granted_by,
      reason: u.reason,
      createdAt: u.created_at.toISOString(),
    })),
  }));
}

export async function saveAuthorizationType(
  db: SgcDb,
  idCompany: number,
  input: { id?: unknown; code?: unknown; name: unknown; description?: unknown; isActive?: unknown; reason: unknown },
  actor: SgcActor
) {
  const reason = requireReason(input.reason);
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 150) throw new SgcError('El nombre del tipo es obligatorio (máximo 150 caracteres).');
  const description = typeof input.description === 'string' && input.description.trim() ? input.description.trim().slice(0, 1000) : null;
  const isActive = input.isActive === undefined ? true : Boolean(input.isActive);
  try {
    return await db.$transaction(async (tx) => {
      if (input.id) {
        const current = await tx.sgcAuthorizationType.findUnique({ where: { id_authorization_type: Number(input.id) } });
        if (!current || current.id_company !== idCompany) throw new SgcError('Tipo de autorización no encontrado.', 404);
        const before = { name: current.name, description: current.description, isActive: current.is_active };
        await tx.sgcAuthorizationType.update({ where: { id_authorization_type: current.id_authorization_type }, data: { name, description, is_active: isActive, updated_by: actor.email } });
        const after = { name, description, isActive };
        await writeConfigChange(tx, { idCompany, entity: 'authorization_type', entityId: current.id_authorization_type, action: 'autorizacion.tipo_editado', reason, before, after }, actor);
        await writeSgcAudit(tx, { idCompany, actorEmail: actor.email, action: SGC_AUDIT_ACTIONS.autorizacionConfigurada, entity: 'authorization_type', entityId: current.id_authorization_type, before, after, detail: reason, ip: actor.ip, userAgent: actor.userAgent });
        return { id: current.id_authorization_type };
      }
      const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : '';
      const codeError = getAuthorizationTypeCodeError(code);
      if (codeError) throw new SgcError(`Código: ${codeError}.`);
      const row = await tx.sgcAuthorizationType.create({ data: { id_company: idCompany, code, name, description, is_active: isActive, updated_by: actor.email } });
      const after = { code, name, description, isActive };
      await writeConfigChange(tx, { idCompany, entity: 'authorization_type', entityId: row.id_authorization_type, action: 'autorizacion.tipo_creado', reason, after }, actor);
      await writeSgcAudit(tx, { idCompany, actorEmail: actor.email, action: SGC_AUDIT_ACTIONS.autorizacionConfigurada, entity: 'authorization_type', entityId: row.id_authorization_type, after, detail: reason, ip: actor.ip, userAgent: actor.userAgent });
      return { id: row.id_authorization_type };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new SgcError('Ya existe un tipo de autorización con ese código en la empresa.', 409);
    throw error;
  }
}

export async function grantAuthorizationTypeUser(
  db: SgcDb,
  idCompany: number,
  idType: number,
  input: { email: unknown; reason: unknown },
  actor: SgcActor,
  opts: { actorIsQuality?: boolean } = {}
) {
  const reason = requireReason(input.reason);
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (!email) throw new SgcError('Indique el correo de la persona.');
  const type = await db.sgcAuthorizationType.findUnique({ where: { id_authorization_type: idType } });
  if (!type || type.id_company !== idCompany) throw new SgcError('Tipo de autorización no encontrado.', 404);
  if (!(await db.user.findUnique({ where: { email }, select: { id: true } }))) throw new SgcError('No existe un usuario con ese correo.');
  // Sprint 6 (segregación de funciones):
  // - nadie se agrega a sí mismo a un grupo de autorización (lo hace otra persona);
  // - el grupo de verificación de Calidad lo administra Calidad (no basta administrar flujos);
  // - solo entra quien puede decidir en el SGC de la empresa (gestión o Calidad, activo).
  if (email === actor.email.trim().toLowerCase()) throw new SgcError('Una persona no se agrega a sí misma a un grupo de autorización: la agrega otra persona.', 403);
  if (type.code === SGC_AUTH_TYPE_QUALITY && opts.actorIsQuality === false) throw new SgcError('El grupo de verificación de Calidad lo administra Aseguramiento de Calidad.', 403);
  if (!(await listEligibleUsers(db, idCompany)).some((u) => u.email === email)) {
    throw new SgcError('La persona no tiene permiso de gestión o de Calidad del SGC en esta empresa (o está inactiva).');
  }
  return db.$transaction(async (tx) => {
    const existing = await tx.sgcAuthorizationTypeUser.findFirst({ where: { id_authorization_type: idType, user_email: email, revoked_at: null } });
    if (existing) throw new SgcError('La persona ya pertenece a este grupo.', 409);
    const row = await tx.sgcAuthorizationTypeUser.create({ data: { id_authorization_type: idType, user_email: email, granted_by: actor.email, reason } });
    await writeConfigChange(tx, { idCompany, entity: 'authorization_type_user', entityId: row.id_authorization_type_user, action: 'autorizacion.grupo_agregado', reason, after: { type: type.code, email } }, actor);
    await writeSgcAudit(tx, { idCompany, actorEmail: actor.email, action: SGC_AUDIT_ACTIONS.autorizacionConfigurada, entity: 'authorization_type_user', entityId: row.id_authorization_type_user, after: { type: type.code, email }, detail: reason, ip: actor.ip, userAgent: actor.userAgent });
    return { id: row.id_authorization_type_user };
  });
}

export async function revokeAuthorizationTypeUser(db: SgcDb, idCompany: number, idTypeUser: number, input: { reason: unknown }, actor: SgcActor) {
  const reason = requireReason(input.reason);
  return db.$transaction(async (tx) => {
    const row = await tx.sgcAuthorizationTypeUser.findUnique({ where: { id_authorization_type_user: idTypeUser }, include: { type: true } });
    if (!row || row.type.id_company !== idCompany) throw new SgcError('Integrante no encontrado.', 404);
    if (row.revoked_at) throw new SgcError('La persona ya no pertenecía al grupo.', 409);
    await tx.sgcAuthorizationTypeUser.update({ where: { id_authorization_type_user: idTypeUser }, data: { revoked_at: new Date(), revoked_by: actor.email } });
    const before = { type: row.type.code, email: row.user_email };
    await writeConfigChange(tx, { idCompany, entity: 'authorization_type_user', entityId: idTypeUser, action: 'autorizacion.grupo_retirado', reason, before }, actor);
    await writeSgcAudit(tx, { idCompany, actorEmail: actor.email, action: SGC_AUDIT_ACTIONS.autorizacionConfigurada, entity: 'authorization_type_user', entityId: idTypeUser, before, after: { revoked: true }, detail: reason, ip: actor.ip, userAgent: actor.userAgent });
    return { id: idTypeUser };
  });
}

export interface SgcAuthorizationRow {
  id: number;
  idRequest: number;
  idTask: number;
  idCompany: number;
  company: string;
  typeCode: string;
  typeName: string;
  subject: string;
  requesterEmail: string;
  requesterName: string | null;
  taskName: string;
  assignedEmail: string | null;
  isPool: boolean;
  status: SgcAuthorizationStatus;
  statusLabel: string;
  inTurn: boolean;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionComment: string | null;
}

/**
 * Bandeja de Autorizaciones SGC de la persona: las asignadas directamente y
 * las de GRUPO de los tipos a los que pertenece, solo en empresas donde tiene
 * acceso al SGC. `inTurn` indica si ya le toca (firma en orden).
 */
export async function listAuthorizationInbox(
  db: SgcDb,
  email: string,
  access: readonly SgcCompanyAccess[],
  opts: { status?: string | null; idCompany?: number | null } = {}
): Promise<SgcAuthorizationRow[]> {
  const me = email.toLowerCase();
  const companies = access.filter((a) => a.canRead).map((a) => a.idCompany).filter((c) => !opts.idCompany || c === opts.idCompany);
  if (companies.length === 0) return [];
  const pools = await db.sgcAuthorizationTypeUser.findMany({
    where: { user_email: me, revoked_at: null, type: { id_company: { in: companies }, is_active: true } },
    select: { id_authorization_type: true },
  });
  const poolTypeIds = [...new Set(pools.map((p) => p.id_authorization_type))];
  const status = opts.status && opts.status !== 'todas' ? opts.status : undefined;
  const rows = await db.sgcAuthorization.findMany({
    where: {
      id_company: { in: companies },
      ...(status ? { status } : {}),
      OR: [{ assigned_email: me }, ...(poolTypeIds.length ? [{ assigned_email: null, id_authorization_type: { in: poolTypeIds } }] : []), { decided_by: me }],
    },
    include: {
      type: true,
      request: { include: { companyConfig: { include: { company: { select: { company: true } } } } } },
      // Sprint 6 (rendimiento): solo los cupos pendientes (bastan para saber a quién le toca).
      assignee: { include: { task: { include: { assignees: { where: { status: 'pendiente' } } } } } },
    },
    orderBy: { id_authorization: 'desc' },
    take: 500,
  });
  const emails = [...new Set(rows.map((r) => r.request.requester_email))];
  const users = emails.length ? await db.user.findMany({ where: { email: { in: emails } }, select: { email: true, name: true } }) : [];
  const names = new Map(users.map((u) => [u.email.toLowerCase(), u.name]));
  return rows.map((r) => {
    const task = r.assignee.task;
    const turn = new Set(
      assigneesInTurn(
        task.assignees.map((a) => ({ id: a.id_task_assignee, userEmail: a.user_email, poolTypeCode: a.pool_type_code, signOrder: a.sign_order, status: a.status as 'pendiente' })),
        (task.signing_mode as 'orden' | 'paralelo' | null) ?? null
      ).map((a) => a.id)
    );
    return {
      id: r.id_authorization,
      idRequest: r.id_request,
      idTask: task.id_task,
      idCompany: r.id_company,
      company: r.request.companyConfig.company.company,
      typeCode: r.type.code,
      typeName: r.type.name,
      subject: r.request.subject,
      requesterEmail: r.request.requester_email,
      requesterName: names.get(r.request.requester_email.toLowerCase()) ?? null,
      taskName: task.name,
      assignedEmail: r.assigned_email,
      isPool: !r.assigned_email,
      status: r.status as SgcAuthorizationStatus,
      statusLabel: SGC_AUTHORIZATION_STATUS_LABELS[r.status as SgcAuthorizationStatus] ?? r.status,
      inTurn: r.status === 'pendiente' && task.status === 'abierta' && turn.has(r.id_task_assignee),
      requestedAt: r.requested_at.toISOString(),
      decidedAt: r.decided_at?.toISOString() ?? null,
      decidedBy: r.decided_by,
      decisionComment: r.decision_comment,
    };
  });
}
