import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import { SgcError } from '../errors';
import { SGC_MATRIX_ROLES, suggestResponsibles, type SgcMatrixEntry, type SgcMatrixRole, type SgcMatrixSuggestion } from '../flows/matrix';
import type { SgcActor, SgcDb } from './catalogs';
import { requireReason, writeConfigChange } from './flows';

/**
 * Matriz de responsables (sgc.responsible_matrix): configurable por empresa,
 * por proceso/área × tipo documental, por persona o por cargo. SOLO SUGIERE.
 * Cada alta o baja pide motivo y queda en el registro de cambios. Nada se
 * borra: se desactiva.
 */

export interface SgcMatrixRow extends SgcMatrixEntry {
  processCode: string | null;
  processName: string | null;
  documentTypeCode: string | null;
  documentTypeName: string | null;
  updatedBy: string;
  updatedAt: string;
}

export async function listMatrix(db: SgcDb, idCompany: number, includeInactive = false): Promise<SgcMatrixRow[]> {
  const rows = await db.sgcResponsibleMatrix.findMany({
    where: { id_company: idCompany, ...(includeInactive ? {} : { is_active: true }) },
    include: { process: true, documentType: true },
    orderBy: [{ role: 'asc' }, { sort_order: 'asc' }, { id_responsible: 'asc' }],
  });
  return rows.map((r) => ({
    id: r.id_responsible,
    role: r.role as SgcMatrixRole,
    idProcess: r.id_process_map,
    idDocumentType: r.id_document_type,
    userEmail: r.user_email,
    cargoName: r.cargo_name,
    sortOrder: r.sort_order,
    isActive: r.is_active,
    isExample: r.is_example,
    processCode: r.process?.code ?? null,
    processName: r.process?.name ?? null,
    documentTypeCode: r.documentType?.code ?? null,
    documentTypeName: r.documentType?.name ?? null,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at.toISOString(),
  }));
}

export async function suggestForTarget(
  db: SgcDb,
  idCompany: number,
  target: { idProcess: number | null; idDocumentType: number | null }
): Promise<SgcMatrixSuggestion[]> {
  return suggestResponsibles(await listMatrix(db, idCompany), target);
}

export interface SgcMatrixInput {
  role: unknown;
  idProcess?: unknown;
  idDocumentType?: unknown;
  userEmail?: unknown;
  cargoName?: unknown;
  sortOrder?: unknown;
  reason: unknown;
}

function optionalId(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new SgcError(`${label} inválido.`);
  return n;
}

export async function addMatrixEntry(db: SgcDb, idCompany: number, input: SgcMatrixInput, actor: SgcActor) {
  const reason = requireReason(input.reason);
  const role = typeof input.role === 'string' && (SGC_MATRIX_ROLES as readonly string[]).includes(input.role) ? (input.role as SgcMatrixRole) : null;
  if (!role) throw new SgcError('Rol inválido: elaborador, revisor o aprobador.');
  const idProcess = optionalId(input.idProcess, 'Proceso');
  const idDocumentType = optionalId(input.idDocumentType, 'Tipo documental');
  const userEmail = typeof input.userEmail === 'string' && input.userEmail.trim() ? input.userEmail.trim().toLowerCase() : null;
  const cargoName = typeof input.cargoName === 'string' && input.cargoName.trim() ? input.cargoName.trim().slice(0, 200) : null;
  if (!userEmail && !cargoName) throw new SgcError('Indique la persona (correo) o el cargo.');
  if (userEmail && cargoName) throw new SgcError('Una fila de la matriz es por persona O por cargo, no ambas.');
  const sortOrder = Number.isInteger(Number(input.sortOrder)) ? Number(input.sortOrder) : 0;
  if (idProcess && !(await db.sgcProcessMap.findFirst({ where: { id_process_map: idProcess, id_company: idCompany } }))) throw new SgcError('El proceso no es de esta empresa.');
  if (idDocumentType && !(await db.sgcDocumentType.findFirst({ where: { id_document_type: idDocumentType, id_company: idCompany } }))) {
    throw new SgcError('El tipo documental no es de esta empresa.');
  }
  if (userEmail && !(await db.user.findUnique({ where: { email: userEmail }, select: { id: true } }))) throw new SgcError('No existe un usuario con ese correo.');
  return db.$transaction(async (tx) => {
    const row = await tx.sgcResponsibleMatrix.create({
      data: { id_company: idCompany, id_process_map: idProcess, id_document_type: idDocumentType, role, user_email: userEmail, cargo_name: cargoName, sort_order: sortOrder, updated_by: actor.email },
    });
    const after = { role, idProcess, idDocumentType, userEmail, cargoName, sortOrder };
    await writeConfigChange(tx, { idCompany, entity: 'responsible_matrix', entityId: row.id_responsible, action: 'matriz.fila_agregada', reason, after }, actor);
    await writeSgcAudit(tx, { idCompany, actorEmail: actor.email, action: SGC_AUDIT_ACTIONS.matrizEditada, entity: 'responsible_matrix', entityId: row.id_responsible, after, detail: reason, ip: actor.ip, userAgent: actor.userAgent });
    return { id: row.id_responsible };
  });
}

export async function deactivateMatrixEntry(db: SgcDb, idCompany: number, idResponsible: number, input: { reason: unknown }, actor: SgcActor) {
  const reason = requireReason(input.reason);
  return db.$transaction(async (tx) => {
    const row = await tx.sgcResponsibleMatrix.findUnique({ where: { id_responsible: idResponsible } });
    if (!row || row.id_company !== idCompany) throw new SgcError('Fila de la matriz no encontrada.', 404);
    if (!row.is_active) throw new SgcError('La fila ya estaba desactivada.', 409);
    await tx.sgcResponsibleMatrix.update({ where: { id_responsible: idResponsible }, data: { is_active: false, updated_by: actor.email } });
    const before = { role: row.role, idProcess: row.id_process_map, idDocumentType: row.id_document_type, userEmail: row.user_email, cargoName: row.cargo_name, isActive: true };
    await writeConfigChange(tx, { idCompany, entity: 'responsible_matrix', entityId: idResponsible, action: 'matriz.fila_desactivada', reason, before, after: { ...before, isActive: false } }, actor);
    await writeSgcAudit(tx, { idCompany, actorEmail: actor.email, action: SGC_AUDIT_ACTIONS.matrizEditada, entity: 'responsible_matrix', entityId: idResponsible, before, after: { isActive: false }, detail: reason, ip: actor.ip, userAgent: actor.userAgent });
    return { id: idResponsible };
  });
}
