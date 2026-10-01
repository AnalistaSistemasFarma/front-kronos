import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import type { SgcAccessSubject } from '../documentAccess';
import { SgcError, isUniqueViolation } from '../errors';
import type { SgcCompanyAccess } from '../permissions';
import { SGC_RELATION_LABELS, isSgcRelationType, sanitizeLayout, type SgcGraphEdge, type SgcGraphNode, type SgcLayout, type SgcRelationType } from '../relations';
import type { SgcActor, SgcDb } from './catalogs';
import { canViewDocument, listVisibleDocuments } from './documents';

/**
 * Relaciones tipadas entre documentos y mapa tipo Obsidian (Sprint 5).
 *
 * El mapa y la ficha muestran SOLO lo que la persona puede consultar: un nodo
 * aparece si puede ver el documento y una relación aparece solo si puede ver
 * sus DOS extremos (así no se revela que existe un documento confidencial).
 * Las relaciones las registra y retira Aseguramiento de Calidad, con motivo;
 * nada se borra (trigger) y cada cambio queda en sgc.audit_log.
 */

function reasonOf(value: unknown, min = 10): string {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (reason.length < min) throw new SgcError(`Explique el motivo (mínimo ${min} caracteres): queda en la auditoría.`);
  return reason.slice(0, 1000);
}

export interface SgcRelationGraph {
  nodes: SgcGraphNode[];
  edges: SgcGraphEdge[];
  layout: SgcLayout;
  processTypeOrder: number[];
}

/** Grafo de la empresa para la persona (respeta permisos) y sus posiciones guardadas. */
export async function getRelationGraph(
  db: SgcDb,
  access: SgcCompanyAccess,
  subject: SgcAccessSubject,
  opts: { statuses?: readonly string[] } = {},
  now: Date = new Date()
): Promise<SgcRelationGraph> {
  const visible = await listVisibleDocuments(db, access, subject, { statuses: opts.statuses ?? ['vigente', 'obsoleto'] }, now);
  const nodes: SgcGraphNode[] = visible.map(({ doc, current }) => ({
    id: doc.id_document,
    code: doc.code,
    title: doc.title,
    versionNumber: current?.version_number ?? null,
    status: doc.status,
    idProcessType: doc.process.processType.id_process_type,
    processTypeCode: doc.process.processType.code,
    processType: doc.process.processType.name,
    processTypeColor: doc.process.processType.color,
    idProcess: doc.process.id_process_map,
    process: `${doc.process.code} · ${doc.process.name}`,
    idDepartment: doc.id_owner_department ?? doc.process.id_department,
    idDocumentType: doc.documentType.id_document_type,
    documentTypeCode: doc.documentType.code,
  }));
  const ids = nodes.map((n) => n.id);
  const rows = ids.length
    ? await db.sgcDocumentRelation.findMany({
        where: { id_company: access.idCompany, is_active: true, id_source_document: { in: ids }, id_target_document: { in: ids } },
        orderBy: { id_document_relation: 'asc' },
      })
    : [];
  const [layoutRow, types] = await Promise.all([
    db.sgcGraphLayout.findUnique({ where: { id_company_user_email: { id_company: access.idCompany, user_email: subject.email.toLowerCase() } } }),
    db.sgcProcessType.findMany({ where: { id_company: access.idCompany }, orderBy: [{ sort_order: 'asc' }, { code: 'asc' }], select: { id_process_type: true } }),
  ]);
  let layout: SgcLayout = {};
  try {
    layout = sanitizeLayout(layoutRow ? JSON.parse(layoutRow.layout_json) : {}) ?? {};
  } catch {
    layout = {};
  }
  return {
    nodes,
    edges: rows.filter((r) => isSgcRelationType(r.relation_type)).map((r) => ({ id: r.id_document_relation, source: r.id_source_document, target: r.id_target_document, type: r.relation_type as SgcRelationType, note: r.note })),
    layout,
    processTypeOrder: types.map((t) => t.id_process_type),
  };
}

/** Guarda las posiciones de los nodos (preferencia de la persona; no es dato controlado). */
export async function saveGraphLayout(db: SgcDb, access: SgcCompanyAccess, email: string, raw: unknown): Promise<{ saved: number }> {
  const layout = sanitizeLayout(raw);
  if (!layout) throw new SgcError('Diseño del mapa inválido.');
  const user_email = email.toLowerCase();
  const layout_json = JSON.stringify(layout);
  await db.sgcGraphLayout.upsert({
    where: { id_company_user_email: { id_company: access.idCompany, user_email } },
    create: { id_company: access.idCompany, user_email, layout_json },
    update: { layout_json, updated_at: new Date() },
  });
  return { saved: Object.keys(layout).length };
}

export interface SgcDocumentRelationItem {
  id: number;
  direction: 'sale' | 'entra';
  type: SgcRelationType;
  typeLabel: string;
  other: { idDocument: number; code: string; title: string; status: string };
  note: string | null;
  createdBy: string;
  createdAt: string;
}

/** Relaciones activas de un documento, solo hacia documentos que la persona puede consultar. */
export async function listDocumentRelations(
  db: SgcDb,
  accessByCompany: readonly SgcCompanyAccess[],
  subject: SgcAccessSubject,
  idDocument: number,
  now: Date = new Date()
): Promise<SgcDocumentRelationItem[] | null> {
  if (!(await canViewDocument(db, accessByCompany, subject, idDocument, now))) return null;
  const rows = await db.sgcDocumentRelation.findMany({
    where: { is_active: true, OR: [{ id_source_document: idDocument }, { id_target_document: idDocument }] },
    include: { source: { select: { id_document: true, code: true, title: true, status: true } }, target: { select: { id_document: true, code: true, title: true, status: true } } },
    orderBy: { id_document_relation: 'asc' },
  });
  const out: SgcDocumentRelationItem[] = [];
  for (const r of rows) {
    if (!isSgcRelationType(r.relation_type)) continue;
    const outgoing = r.id_source_document === idDocument;
    const other = outgoing ? r.target : r.source;
    if (!(await canViewDocument(db, accessByCompany, subject, other.id_document, now))) continue;
    out.push({
      id: r.id_document_relation,
      direction: outgoing ? 'sale' : 'entra',
      type: r.relation_type,
      typeLabel: SGC_RELATION_LABELS[r.relation_type],
      other: { idDocument: other.id_document, code: other.code, title: other.title, status: other.status },
      note: r.note,
      createdBy: r.created_by,
      createdAt: r.created_at.toISOString(),
    });
  }
  return out;
}

/** Registra una relación (solo Calidad, con motivo). */
export async function addDocumentRelation(
  db: SgcDb,
  accessByCompany: readonly SgcCompanyAccess[],
  input: { idSource: unknown; idTarget?: unknown; targetCode?: unknown; type: unknown; note?: unknown; reason: unknown },
  actor: SgcActor
) {
  const idSource = Number(input.idSource);
  const source = Number.isInteger(idSource) ? await db.sgcDocument.findUnique({ where: { id_document: idSource } }) : null;
  if (!source) throw new SgcError('Documento no encontrado.', 404);
  const access = accessByCompany.find((a) => a.idCompany === source.id_company);
  if (!access?.canQuality) throw new SgcError('Solo Aseguramiento de Calidad registra relaciones entre documentos.', 403);
  if (!isSgcRelationType(input.type)) throw new SgcError('Tipo de relación inválido.');
  const reason = reasonOf(input.reason);
  const code = typeof input.targetCode === 'string' ? input.targetCode.trim().toUpperCase() : '';
  const idTarget = Number(input.idTarget);
  const target = code
    ? await db.sgcDocument.findFirst({ where: { id_company: source.id_company, code } })
    : Number.isInteger(idTarget)
      ? await db.sgcDocument.findFirst({ where: { id_document: idTarget, id_company: source.id_company } })
      : null;
  if (!target) throw new SgcError('El documento relacionado no existe en la empresa.', 404);
  if (target.id_document === source.id_document) throw new SgcError('Un documento no se relaciona consigo mismo.');
  if (source.status === 'anulado' || target.status === 'anulado') throw new SgcError('No se relacionan documentos anulados.', 409);
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 500) : null;
  try {
    return await db.$transaction(async (tx) => {
      const saved = await tx.sgcDocumentRelation.create({
        data: {
          id_company: source.id_company,
          id_source_document: source.id_document,
          id_target_document: target.id_document,
          relation_type: input.type as SgcRelationType,
          note,
          created_by: actor.email.toLowerCase(),
          change_reason: reason,
        },
      });
      await writeSgcAudit(tx, {
        idCompany: source.id_company,
        actorEmail: actor.email,
        action: SGC_AUDIT_ACTIONS.relacionAgregada,
        entity: 'document_relation',
        entityId: saved.id_document_relation,
        after: saved,
        detail: `${source.code} → ${SGC_RELATION_LABELS[input.type as SgcRelationType]} → ${target.code}: ${reason}`.slice(0, 1000),
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
      return saved;
    });
  } catch (error) {
    if (isUniqueViolation(error) || /document_relation_activa_uq/.test(String((error as Error)?.message))) {
      throw new SgcError(`La relación ${source.code} → ${target.code} (${SGC_RELATION_LABELS[input.type as SgcRelationType]}) ya existe.`, 409);
    }
    throw error;
  }
}

/** Retira una relación (no se borra: queda con quién, cuándo y por qué). */
export async function removeDocumentRelation(db: SgcDb, accessByCompany: readonly SgcCompanyAccess[], idRelation: number, rawReason: unknown, actor: SgcActor, now: Date = new Date()) {
  const rel = Number.isInteger(idRelation) ? await db.sgcDocumentRelation.findUnique({ where: { id_document_relation: idRelation } }) : null;
  if (!rel) throw new SgcError('Relación no encontrada.', 404);
  const access = accessByCompany.find((a) => a.idCompany === rel.id_company);
  if (!access?.canQuality) throw new SgcError('Solo Aseguramiento de Calidad retira relaciones entre documentos.', 403);
  if (!rel.is_active) throw new SgcError('La relación ya estaba retirada.', 409);
  const reason = reasonOf(rawReason);
  return db.$transaction(async (tx) => {
    const saved = await tx.sgcDocumentRelation.update({ where: { id_document_relation: idRelation }, data: { is_active: false, removed_by: actor.email.toLowerCase(), removed_at: now, remove_reason: reason } });
    await writeSgcAudit(tx, {
      idCompany: rel.id_company,
      actorEmail: actor.email,
      action: SGC_AUDIT_ACTIONS.relacionRetirada,
      entity: 'document_relation',
      entityId: idRelation,
      before: rel,
      after: saved,
      detail: reason,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return saved;
  });
}
