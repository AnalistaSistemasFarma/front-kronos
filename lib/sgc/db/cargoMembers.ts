import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import { SgcError, isUniqueViolation } from '../errors';
import type { SgcActor, SgcDb } from './catalogs';

/**
 * PERSONAS POR CARGO del SGC (Sprint 4), para el alcance de divulgación «por
 * cargo»: SynerLink tiene el catálogo de cargos (dbo.cargo, compartido) pero
 * no vincula persona↔cargo, así que Calidad registra aquí quién ocupa cada
 * cargo en la empresa. No se borra: se desactiva con motivo; cada cambio
 * queda en la auditoría.
 */

function lower(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

export async function listCargoMembers(db: SgcDb, idCompany: number) {
  const [rows, cargos] = await Promise.all([
    db.sgcCargoMember.findMany({ where: { id_company: idCompany, is_active: true }, orderBy: [{ id_cargo: 'asc' }, { user_email: 'asc' }] }),
    db.cargo.findMany({ where: { is_active: true }, orderBy: { nombre_normalizado: 'asc' }, select: { id_cargo: true, nombre_normalizado: true } }),
  ]);
  const names = await db.user.findMany({ where: { email: { in: [...new Set(rows.map((r) => r.user_email))] } }, select: { email: true, name: true } });
  const nameOf = new Map(names.map((n) => [lower(n.email), n.name]));
  const cargoOf = new Map(cargos.map((c) => [c.id_cargo, c.nombre_normalizado]));
  return {
    cargos: cargos.map((c) => ({ id: c.id_cargo, name: c.nombre_normalizado })),
    members: rows.map((r) => ({ id: r.id_cargo_member, idCargo: r.id_cargo, cargo: cargoOf.get(r.id_cargo) ?? String(r.id_cargo), email: r.user_email, name: nameOf.get(lower(r.user_email)) ?? null, addedBy: r.added_by, addedAt: r.added_at.toISOString(), reason: r.reason })),
  };
}

export async function addCargoMember(db: SgcDb, idCompany: number, input: { idCargo?: unknown; email?: unknown; reason?: unknown }, actor: SgcActor) {
  const idCargo = Number(input.idCargo);
  const email = lower(typeof input.email === 'string' ? input.email : '');
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!Number.isInteger(idCargo) || idCargo < 1) throw new SgcError('Seleccione el cargo.');
  if (!email.includes('@')) throw new SgcError('Indique el correo de la persona.');
  if (reason.length < 5) throw new SgcError('Escriba el motivo (mínimo 5 caracteres).');
  if (!(await db.cargo.findFirst({ where: { id_cargo: idCargo, is_active: true } }))) throw new SgcError('El cargo no existe o está inactivo.');
  const inCompany = await db.companyUser.count({ where: { id_company: idCompany, user: { email, isActive: true } } });
  if (!inCompany) throw new SgcError('La persona no pertenece a la empresa en SynerLink o está inactiva.');
  try {
    return await db.$transaction(async (tx) => {
      const dup = await tx.sgcCargoMember.findFirst({ where: { id_company: idCompany, id_cargo: idCargo, user_email: email, is_active: true } });
      if (dup) throw new SgcError('La persona ya está registrada en ese cargo.', 409);
      const row = await tx.sgcCargoMember.create({ data: { id_company: idCompany, id_cargo: idCargo, user_email: email, added_by: lower(actor.email), reason: reason.slice(0, 1000) } });
      await writeSgcAudit(tx, { idCompany, actorEmail: actor.email, action: SGC_AUDIT_ACTIONS.cargoPersonaAgregada, entity: 'cargo_member', entityId: row.id_cargo_member, after: { idCargo, email }, detail: reason, ip: actor.ip, userAgent: actor.userAgent });
      return { id: row.id_cargo_member };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new SgcError('La persona ya está registrada en ese cargo.', 409);
    throw e;
  }
}

export async function deactivateCargoMember(db: SgcDb, idCompany: number, id: number, input: { reason?: unknown }, actor: SgcActor) {
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < 5) throw new SgcError('Escriba el motivo (mínimo 5 caracteres).');
  const row = await db.sgcCargoMember.findUnique({ where: { id_cargo_member: id } });
  if (!row || row.id_company !== idCompany) throw new SgcError('Registro no encontrado.', 404);
  if (!row.is_active) throw new SgcError('El registro ya estaba inactivo.', 409);
  await db.$transaction(async (tx) => {
    await tx.sgcCargoMember.update({ where: { id_cargo_member: id }, data: { is_active: false, removed_by: lower(actor.email), removed_at: new Date(), remove_reason: reason.slice(0, 1000) } });
    await writeSgcAudit(tx, { idCompany, actorEmail: actor.email, action: SGC_AUDIT_ACTIONS.cargoPersonaRetirada, entity: 'cargo_member', entityId: id, before: { active: true, idCargo: row.id_cargo, email: row.user_email }, after: { active: false }, detail: reason, ip: actor.ip, userAgent: actor.userAgent });
  });
  return { ok: true };
}
