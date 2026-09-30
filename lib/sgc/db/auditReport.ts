import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import { SgcError } from '../errors';
import { SGC_SIGNATURE_LABELS } from '../flows/definition';
import type { SgcCompanyAccess } from '../permissions';
import { verifySignatureChain, verifySignatureRow } from '../signature/record';
import type { SgcActor, SgcDb } from './catalogs';

/**
 * REPORTE DE AUDITORÍA POR DOCUMENTO (Sprint 3), para Calidad y para la
 * visita: todo lo que le pasó al documento en un solo lugar, en orden de
 * tiempo — cargas, consultas, descargas, intentos denegados, cambios de
 * accesos, solicitudes documentales con sus decisiones, firmas electrónicas
 * (con su verificación de integridad), listas de chequeo de Calidad y PDF
 * controlados. Se arma desde sgc.audit_log (inmodificable) y sgc.signature.
 * Solo Calidad lo consulta; cada consulta del reporte también queda auditada.
 */

export interface SgcAuditReportRow {
  id: string;
  at: string;
  actor: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  ip: string | null;
  detail: string | null;
  after: string | null;
}

export async function getDocumentAuditReport(db: SgcDb, access: readonly SgcCompanyAccess[], idDocument: number, actor: SgcActor) {
  const doc = await db.sgcDocument.findUnique({ where: { id_document: idDocument }, include: { versions: { select: { id_document_version: true, version_number: true, status: true, pdf_sha256: true, id_request: true } } } });
  if (!doc) throw new SgcError('Documento no encontrado.', 404);
  const a = access.find((x) => x.idCompany === doc.id_company);
  if (!a) throw new SgcError('Documento no encontrado.', 404);
  if (!a.canQuality) throw new SgcError('El reporte de auditoría es de Aseguramiento de Calidad.', 403);

  const requests = await db.sgcRequest.findMany({
    where: { OR: [{ id_document: idDocument }, { id_document_version: { in: doc.versions.map((v) => v.id_document_version) } }] },
    select: { id_request: true, subject: true, status: true, request_type: true, tasks: { select: { id_task: true } }, attachments: { select: { id_attachment: true } }, draftRevisions: { select: { id_draft_revision: true } } },
  });
  const requestIds = requests.map((r) => r.id_request);
  const signatures = requestIds.length ? await db.sgcSignature.findMany({ where: { id_request: { in: requestIds } }, orderBy: { id_signature: 'asc' } }) : [];
  const qualityChecks = requestIds.length ? await db.sgcQualityCheck.findMany({ where: { id_request: { in: requestIds } }, select: { id_quality_check: true } }) : [];

  const ids = (xs: (number | bigint)[]) => xs.map((x) => String(x));
  const targets: { entity: string; ids: string[] }[] = [
    { entity: 'document', ids: [String(idDocument)] },
    { entity: 'document_version', ids: ids(doc.versions.map((v) => v.id_document_version)) },
    { entity: 'request', ids: ids(requestIds) },
    { entity: 'task', ids: ids(requests.flatMap((r) => r.tasks.map((t) => t.id_task))) },
    { entity: 'attachment', ids: ids(requests.flatMap((r) => r.attachments.map((x) => x.id_attachment))) },
    { entity: 'draft_revision', ids: ids(requests.flatMap((r) => r.draftRevisions.map((x) => x.id_draft_revision))) },
    { entity: 'signature', ids: ids(signatures.map((s) => s.id_signature)) },
    { entity: 'quality_check', ids: ids(qualityChecks.map((q) => q.id_quality_check)) },
  ].filter((t) => t.ids.length);
  const logs = await db.sgcAuditLog.findMany({
    where: { id_company: doc.id_company, OR: targets.map((t) => ({ entity: t.entity, entity_id: { in: t.ids } })) },
    orderBy: { id_audit_log: 'asc' },
    take: 5000,
  });

  const companyChain = verifySignatureChain(await db.sgcSignature.findMany({ where: { id_company: doc.id_company }, orderBy: { id_signature: 'asc' } }));
  await writeSgcAudit(db, { idCompany: doc.id_company, actorEmail: actor.email, action: SGC_AUDIT_ACTIONS.reporteAuditoria, entity: 'document', entityId: idDocument, detail: `Reporte de auditoría de ${doc.code} (${logs.length} eventos).`, ip: actor.ip, userAgent: actor.userAgent });

  return {
    document: { id: doc.id_document, code: doc.code, title: doc.title, status: doc.status, idCompany: doc.id_company },
    generatedAt: new Date().toISOString(),
    versions: doc.versions.map((v) => ({ id: v.id_document_version, number: v.version_number, status: v.status, pdfSha256: v.pdf_sha256.trim(), idRequest: v.id_request })),
    requests: requests.map((r) => ({ id: r.id_request, subject: r.subject, status: r.status, requestType: r.request_type })),
    signatures: signatures.map((s) => ({
      uid: s.signature_uid.trim(),
      idRequest: s.id_request,
      meaningLabel: SGC_SIGNATURE_LABELS[s.meaning as keyof typeof SGC_SIGNATURE_LABELS] ?? s.meaning,
      signer: s.signer_name ?? s.signer_email,
      signerEmail: s.signer_email,
      signedAt: s.signed_at.toISOString(),
      reason: s.reason,
      contentSha256: s.content_sha256.trim(),
      recordHash: s.record_hash.trim(),
      ip: s.ip,
      evidencePath: s.evidence_path,
      intact: verifySignatureRow(s),
    })),
    signatureChain: companyChain,
    events: logs.map<SgcAuditReportRow>((l) => ({
      id: l.id_audit_log.toString(),
      at: l.occurred_at.toISOString(),
      actor: l.actor_email,
      action: l.action,
      entity: l.entity,
      entityId: l.entity_id,
      ip: l.ip,
      detail: l.detail,
      after: l.after_json,
    })),
  };
}

export type SgcDocumentAuditReport = Awaited<ReturnType<typeof getDocumentAuditReport>>;

/** CSV del reporte (separador «;», como lo abre Excel en español). */
export function auditReportToCsv(report: SgcDocumentAuditReport): string {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  const lines = [['fecha_utc', 'quien', 'accion', 'entidad', 'id', 'ip', 'detalle', 'datos'].map(q).join(';')];
  for (const e of report.events) lines.push([e.at, e.actor, e.action, e.entity, e.entityId, e.ip, e.detail, e.after].map(q).join(';'));
  return `﻿${lines.join('\r\n')}\r\n`;
}
