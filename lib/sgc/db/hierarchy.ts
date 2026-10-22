import type { Prisma } from '../../../app/generated/prisma';
import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import { SgcError } from '../errors';
import { hierarchyOf, hierarchyRelationFor, isParentTypeCode, parentChildError, parentTypeCodesOf, type SgcHierarchyDoc } from '../hierarchy';
import type { SgcActor, SgcDb } from './catalogs';

/**
 * DOCUMENTOS PADRE E HIJOS (2026-10-19) contra la base: tipos padre de la
 * empresa, padre actual de cada documento, validación de las reglas y la
 * relación que se crea SOLA al crear un hijo con su padre. Las reglas puras
 * viven en lib/sgc/hierarchy.ts. Sin dependencias de documents.ts (lo usan la
 * carga inicial, las solicitudes y la aprobación).
 */

type Db = SgcDb | Prisma.TransactionClient;

/** Tipos documentales padre de la empresa (los marcados o, sin marca, el procedimiento). */
export async function loadParentTypeCodes(db: Db, idCompany: number): Promise<string[]> {
  const types = await db.sgcDocumentType.findMany({ where: { id_company: idCompany, is_active: true }, select: { code: true, name: true, is_parent_type: true } });
  return parentTypeCodesOf(types.map((t) => ({ code: t.code, name: t.name, isParentType: t.is_parent_type })));
}

/** Padre actual de cada documento (relaciones jerárquicas ACTIVAS; con `includeProposals`, también las propuestas). */
export async function loadParentMap(db: Db, idCompany: number, includeProposals = false): Promise<Map<number, number>> {
  const rows = await db.sgcDocumentRelation.findMany({
    where: { id_company: idCompany, is_active: true, relation_type: { in: ['procedimiento_padre', 'formato', 'anexo'] }, ...(includeProposals ? {} : { status: 'confirmada' }) },
    select: { id_source_document: true, id_target_document: true, relation_type: true },
    orderBy: { id_document_relation: 'asc' },
  });
  const out = new Map<number, number>();
  for (const r of rows) {
    const h = hierarchyOf({ source: r.id_source_document, target: r.id_target_document, type: r.relation_type });
    if (h && !out.has(h.child)) out.set(h.child, h.parent);
  }
  return out;
}

type DocWithType = { id_document: number; id_company: number; code: string; status: string; documentType: { code: string } };
const hdoc = (d: DocWithType): SgcHierarchyDoc => ({ id: d.id_document, code: d.code, status: d.status, documentTypeCode: d.documentType.code });

/** Valida la relación padre → hijo con las reglas de la empresa (409 con el motivo si no se puede). */
export async function assertParentChild(db: Db, parent: DocWithType, child: DocWithType, opts: { parentTypeCodes?: string[]; parentOf?: Map<number, number> } = {}): Promise<void> {
  if (parent.id_company !== child.id_company) throw new SgcError('El documento padre y el hijo deben ser de la misma empresa.', 409);
  const codes = opts.parentTypeCodes ?? (await loadParentTypeCodes(db, parent.id_company));
  const parentOf = opts.parentOf ?? (await loadParentMap(db, parent.id_company));
  const error = parentChildError(hdoc(parent), hdoc(child), codes, parentOf);
  if (error) throw new SgcError(error, 409);
}

/**
 * Documento padre que se indica al crear un hijo (solicitud o carga individual):
 * vigente o pendiente de archivo, de la empresa y de un tipo padre; el tipo del
 * hijo no puede ser padre. Devuelve el padre (o lanza el motivo).
 */
export async function assertParentForNewChild(db: Db, idCompany: number, idParentDocument: number, childType: { code: string; name: string }) {
  const codes = await loadParentTypeCodes(db, idCompany);
  if (isParentTypeCode(codes, childType.code)) throw new SgcError(`Un documento de tipo ${childType.name} es documento padre: no tiene padre (no se desprende de otro documento).`, 409);
  const parent = Number.isInteger(idParentDocument)
    ? await db.sgcDocument.findFirst({ where: { id_document: idParentDocument, id_company: idCompany, status: { in: ['vigente', 'pendiente_archivo'] } }, include: { documentType: { select: { code: true, name: true } } } })
    : null;
  if (!parent) throw new SgcError('El documento padre debe ser un documento vigente (o pendiente de archivo) de la empresa.');
  if (!isParentTypeCode(codes, parent.documentType.code)) {
    throw new SgcError(`${parent.code} es un ${parent.documentType.name.toLowerCase()}: el documento padre debe ser de un tipo padre (${codes.join(', ') || 'ninguno configurado'}).`, 409);
  }
  return parent;
}

/**
 * La relación padre → hijo que se crea SOLA al crear un hijo con su padre
 * (al aprobar la solicitud o en la carga individual): confirmada, con el
 * origen y la auditoría. Si el hijo ya tiene padre no se duplica.
 */
export async function createAutomaticParentRelation(
  tx: Prisma.TransactionClient,
  input: { idCompany: number; idParent: number; idChild: number; childTypeCode: string; origin: 'solicitud' | 'carga'; reason: string },
  actor: SgcActor
) {
  const parentOf = await loadParentMap(tx, input.idCompany, true);
  if (parentOf.has(input.idChild)) return null;
  const rel = hierarchyRelationFor(input.idParent, input.idChild, input.childTypeCode);
  const email = actor.email.toLowerCase();
  const saved = await tx.sgcDocumentRelation.create({
    data: { id_company: input.idCompany, id_source_document: rel.idSource, id_target_document: rel.idTarget, relation_type: rel.type, created_by: email, change_reason: input.reason.slice(0, 1000), origin: input.origin, status: 'confirmada', confirmed_by: email, confirmed_at: new Date() },
  });
  await writeSgcAudit(tx, {
    idCompany: input.idCompany,
    actorEmail: actor.email,
    action: SGC_AUDIT_ACTIONS.relacionAutomatica,
    entity: 'document_relation',
    entityId: saved.id_document_relation,
    after: saved,
    detail: input.reason.slice(0, 1000),
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  return saved;
}
