import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import type { SgcAccessSubject } from '../documentAccess';
import { SgcError, isUniqueViolation } from '../errors';
import type { SgcCompanyAccess } from '../permissions';
import { SGC_RELATION_LABELS, isSgcRelationType, sanitizeLayout, type SgcGraphEdge, type SgcGraphNode, type SgcLayout, type SgcRelationType } from '../relations';
import type { SgcActor, SgcDb } from './catalogs';
import { canViewDocument, listVisibleDocuments } from './documents';
import { guideInputOf } from './coding';
import { pairKey, proposeRelations } from '../relationProposals';

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
        // Sprint 6: sin listas IN gigantes (SQL Server admite 2.100 parámetros); se filtra en memoria.
        // Sprint 9: el mapa solo muestra las relaciones CONFIRMADAS (las propuestas por código esperan a Calidad).
        where: { id_company: access.idCompany, is_active: true, status: 'confirmada' },
        orderBy: { id_document_relation: 'asc' },
      }).then((all) => {
        const visible = new Set(ids);
        return all.filter((r) => visible.has(r.id_source_document) && visible.has(r.id_target_document));
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
    where: { is_active: true, status: 'confirmada', OR: [{ id_source_document: idDocument }, { id_target_document: idDocument }] },
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
          // Sprint 9: la que registra Calidad a mano queda confirmada de una vez.
          origin: 'manual',
          status: 'confirmada',
          confirmed_by: actor.email.toLowerCase(),
          confirmed_at: new Date(),
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

// ---------------------------------------------------------------------------
// Sprint 9 — «Relacionar documentos»: propuestas por código y confirmación de Calidad.
// ---------------------------------------------------------------------------

/** Genera las propuestas de relación de la empresa (solo las que faltan) y las deja «propuestas». */
export async function proposeDocumentRelations(db: SgcDb, access: SgcCompanyAccess, actor: SgcActor) {
  if (!access.canQuality) throw new SgcError('Solo Aseguramiento de Calidad relaciona documentos.', 403);
  const idCompany = access.idCompany;
  const [docs, guide, relations, listRows] = await Promise.all([
    db.sgcDocument.findMany({ where: { id_company: idCompany, status: { not: 'anulado' } }, select: { id_document: true, code: true, status: true, documentType: { select: { code: true } }, process: { select: { code: true, processType: { select: { code: true } } } } } }),
    db.sgcCodingGuide.findUnique({ where: { id_company: idCompany } }),
    db.sgcDocumentRelation.findMany({ where: { id_company: idCompany, is_active: true }, select: { id_source_document: true, id_target_document: true } }),
    db.sgcMasterListImportRow.findMany({ where: { status: 'cargada', parent_code: { not: null }, id_document: { not: null }, import: { id_company: idCompany } }, select: { id_document: true, parent_code: true }, orderBy: { id_master_list_import_row: 'asc' } }),
  ]);
  const proposals = proposeRelations(
    docs.map((d) => ({ id: d.id_document, code: d.code, status: d.status, documentTypeCode: d.documentType.code, processCode: d.process.code, processTypeCode: d.process.processType.code })),
    {
      guide: guide ? guideInputOf(guide) : null,
      listParents: new Map(listRows.map((r) => [r.id_document!, r.parent_code!])),
      related: new Set(relations.map((r) => pairKey(r.id_source_document, r.id_target_document))),
    }
  );
  if (proposals.length === 0) return { created: 0 };
  const email = actor.email.toLowerCase();
  await db.$transaction(async (tx) => {
    for (const p of proposals) {
      await tx.sgcDocumentRelation.create({
        data: { id_company: idCompany, id_source_document: p.idSource, id_target_document: p.idTarget, relation_type: p.type, created_by: email, change_reason: p.reason.slice(0, 1000), origin: p.origin, status: 'propuesta' },
      });
    }
    await writeSgcAudit(tx, {
      idCompany,
      actorEmail: actor.email,
      action: SGC_AUDIT_ACTIONS.relacionPropuesta,
      entity: 'document_relation',
      entityId: null,
      after: { proposals: proposals.length, listado: proposals.filter((p) => p.origin === 'listado').length, codigo: proposals.filter((p) => p.origin === 'codigo').length },
      detail: `«Relacionar documentos»: ${proposals.length} relación(es) propuesta(s) por el código y el listado maestro, pendientes de confirmar.`,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  }, { maxWait: 10_000, timeout: 60_000 });
  return { created: proposals.length };
}

/** Relaciones PROPUESTAS de la empresa (pendientes de que Calidad las confirme o descarte). */
export async function listRelationProposals(db: SgcDb, access: SgcCompanyAccess) {
  if (!access.canQuality) throw new SgcError('Solo Aseguramiento de Calidad relaciona documentos.', 403);
  const rows = await db.sgcDocumentRelation.findMany({
    where: { id_company: access.idCompany, is_active: true, status: 'propuesta' },
    include: { source: { select: { code: true, title: true, status: true } }, target: { select: { code: true, title: true, status: true } } },
    orderBy: { id_document_relation: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id_document_relation,
    type: r.relation_type,
    typeLabel: isSgcRelationType(r.relation_type) ? SGC_RELATION_LABELS[r.relation_type] : r.relation_type,
    origin: r.origin,
    reason: r.change_reason,
    source: { id: r.id_source_document, code: r.source.code, title: r.source.title, status: r.source.status },
    target: { id: r.id_target_document, code: r.target.code, title: r.target.title, status: r.target.status },
    proposedBy: r.created_by,
    proposedAt: r.created_at.toISOString(),
  }));
}

/** Calidad CONFIRMA (una o en bloque) o DESCARTA (con motivo) relaciones propuestas. */
export async function decideRelationProposals(db: SgcDb, access: SgcCompanyAccess, input: { ids?: unknown; action?: unknown; reason?: unknown }, actor: SgcActor, now: Date = new Date()) {
  if (!access.canQuality) throw new SgcError('Solo Aseguramiento de Calidad relaciona documentos.', 403);
  const ids = Array.isArray(input.ids) ? [...new Set(input.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 2000) : [];
  if (!ids.length) throw new SgcError('Seleccione al menos una relación propuesta.');
  if (input.action !== 'confirmar' && input.action !== 'descartar') throw new SgcError('Acción inválida (confirmar o descartar).');
  const reason = input.action === 'descartar' ? reasonOf(input.reason) : typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim().slice(0, 1000) : null;
  const rows = await db.sgcDocumentRelation.findMany({ where: { id_company: access.idCompany, is_active: true, status: 'propuesta' }, include: { source: { select: { code: true } }, target: { select: { code: true } } } });
  const chosen = rows.filter((r) => ids.includes(r.id_document_relation));
  if (chosen.length !== ids.length) throw new SgcError('Alguna relación ya no está propuesta (otra persona la confirmó o la descartó). Actualice la lista.', 409);
  const email = actor.email.toLowerCase();
  await db.$transaction(async (tx) => {
    for (const r of chosen) {
      const saved =
        input.action === 'confirmar'
          ? await tx.sgcDocumentRelation.update({ where: { id_document_relation: r.id_document_relation }, data: { status: 'confirmada', confirmed_by: email, confirmed_at: now } })
          : await tx.sgcDocumentRelation.update({ where: { id_document_relation: r.id_document_relation }, data: { is_active: false, removed_by: email, removed_at: now, remove_reason: reason } });
      await writeSgcAudit(tx, {
        idCompany: access.idCompany,
        actorEmail: actor.email,
        action: input.action === 'confirmar' ? SGC_AUDIT_ACTIONS.relacionConfirmada : SGC_AUDIT_ACTIONS.relacionRetirada,
        entity: 'document_relation',
        entityId: r.id_document_relation,
        before: { status: r.status, isActive: r.is_active },
        after: { status: saved.status, isActive: saved.is_active },
        detail: `${r.source.code} → ${isSgcRelationType(r.relation_type) ? SGC_RELATION_LABELS[r.relation_type] : r.relation_type} → ${r.target.code} (${input.action === 'confirmar' ? 'confirmada' : 'propuesta descartada'})${reason ? `: ${reason}` : ''}`.slice(0, 1000),
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
    }
  }, { maxWait: 10_000, timeout: 60_000 });
  return { [input.action === 'confirmar' ? 'confirmed' : 'discarded']: chosen.length };
}
