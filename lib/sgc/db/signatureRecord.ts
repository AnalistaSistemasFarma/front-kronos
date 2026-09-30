import type { Prisma } from '../../../app/generated/prisma';
import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import { pickCurrentDraft, type SgcCurrentDraft } from '../draft/current';
import { SgcError } from '../errors';
import type { SgcFormFieldDefinition, SgcSignatureMeaning } from '../flows/definition';
import { normalizeChecklist, type SgcChecklistResult } from '../signature/checklist';
import {
  buildEvidenceFile,
  buildSignaturePayload,
  computeRecordHash,
  evidenceFolderSegments,
  sha256HexOf,
  type SgcSignaturePayload,
  type SgcSignedContent,
} from '../signature/record';
import type { SgcActor } from './catalogs';
import type { SgcUploader } from './documents';

/**
 * Escritura de la firma electrónica DENTRO de la transacción de la decisión
 * (la misma que bloquea la fila de la solicitud): así una firma y el avance
 * del flujo quedan juntos o no queda ninguno. Sin dependencias de las rutas
 * ni de Orión.
 */

type Tx = Prisma.TransactionClient;

/** Lo que la capa de firma (signatures.ts) entrega al motor, ya reautenticado. */
export interface SgcSignatureRequest {
  meaning: SgcSignatureMeaning;
  reason: string;
  signerName: string | null;
  /** Borrador que la persona vio y que se verificó (hash) antes de abrir la transacción. */
  verifiedDraft: SgcSignedContent;
  /** Sube la evidencia al espacio propio de la empresa (<raíz>/_firmas/SOL-<n>/). */
  uploadEvidence: SgcUploader;
  now: Date;
}

/** Borrador vigente de la solicitud leído dentro de la transacción. */
export async function currentDraftInTx(tx: Tx, idRequest: number): Promise<SgcCurrentDraft | null> {
  const [attachments, revisions] = await Promise.all([
    tx.sgcAttachment.findMany({
      where: { id_request: idRequest, purpose: 'borrador' },
      select: { id_attachment: true, purpose: true, file_name: true, item_id: true, sha256: true, created_at: true, withdrawn_at: true },
    }),
    tx.sgcDraftRevision.findMany({ where: { id_request: idRequest }, select: { id_draft_revision: true, revision_number: true, sha256: true, saved_at: true } }),
  ]);
  return pickCurrentDraft(attachments, revisions);
}

/** Último hash de la cadena de firmas de la empresa, BLOQUEANDO la cola (dos firmas no bifurcan la cadena). */
async function lastRecordHash(tx: Tx, idCompany: number): Promise<string | null> {
  const rows = await tx.$queryRaw<{ record_hash: string }[]>`
    SELECT TOP 1 record_hash FROM [sgc].[signature] WITH (UPDLOCK, HOLDLOCK)
    WHERE id_company = ${idCompany} ORDER BY id_signature DESC`;
  return rows[0]?.record_hash?.trim() ?? null;
}

async function activeMaster(tx: Tx, idCompany: number, email: string) {
  return tx.sgcSignatureMaster.findFirst({
    where: { id_company: idCompany, user_email: email, revoked_at: null },
    orderBy: { version_number: 'desc' },
    select: { id_signature_master: true, image_sha256: true },
  });
}

export interface SgcRecordedSignature {
  idSignature: number;
  payload: SgcSignaturePayload;
  recordHash: string;
  evidencePath: string;
}

/**
 * Registra la firma: verifica que el borrador no haya cambiado, arma el
 * registro con el sello de tiempo del servidor, sube la evidencia, encadena
 * y deja la auditoría. Lanza si algo no cuadra (la transacción se revierte).
 */
export async function recordSignature(
  tx: Tx,
  p: {
    request: { id_request: number; id_company: number };
    idTask: number;
    idTaskAssignee: number;
    expectedMeaning: string | null;
    signature: SgcSignatureRequest;
    actor: SgcActor;
  }
): Promise<SgcRecordedSignature> {
  const s = p.signature;
  if (!p.expectedMeaning || s.meaning !== p.expectedMeaning) throw new SgcError('El significado de la firma no corresponde a esta tarea.', 409);
  const current = await currentDraftInTx(tx, p.request.id_request);
  if (!current || current.ref !== s.verifiedDraft.ref || current.sha256 !== s.verifiedDraft.sha256) {
    throw new SgcError('El borrador cambió mientras firmaba: vuelva a abrir la tarea y revise el contenido antes de firmar.', 409);
  }
  const email = p.actor.email.trim().toLowerCase();
  const master = await activeMaster(tx, p.request.id_company, email);
  const payload = buildSignaturePayload({
    idCompany: p.request.id_company,
    idRequest: p.request.id_request,
    idTask: p.idTask,
    idTaskAssignee: p.idTaskAssignee,
    signerEmail: email,
    signerName: s.signerName,
    meaning: s.meaning,
    reason: s.reason,
    signedAt: s.now,
    content: { kind: current.kind, ref: current.ref, name: current.name, sha256: current.sha256 },
    masterSha256: master?.image_sha256?.trim() ?? null,
    ip: p.actor.ip ?? null,
    userAgent: p.actor.userAgent ?? null,
  });
  const config = await tx.sgcCompanyConfig.findUniqueOrThrow({ where: { id_company: p.request.id_company } });
  const segments = evidenceFolderSegments(config.storage_root, p.request.id_request);
  const evidence = buildEvidenceFile(payload);
  const evidenceSha = sha256HexOf(evidence.bytes);
  const item = await s.uploadEvidence(segments, evidence.fileName, evidence.bytes, 'application/json');
  const prev = await lastRecordHash(tx, p.request.id_company);
  const recordHash = computeRecordHash(payload, evidenceSha, prev);
  const evidencePath = `${segments.join('/')}/${evidence.fileName}`;
  const row = await tx.sgcSignature.create({
    data: {
      signature_uid: payload.uid,
      id_company: payload.idCompany,
      id_request: payload.idRequest,
      id_task: payload.idTask,
      id_task_assignee: payload.idTaskAssignee,
      signer_email: payload.signerEmail,
      signer_name: payload.signerName,
      meaning: payload.meaning,
      reason: payload.reason,
      signed_at: s.now,
      content_kind: payload.content.kind,
      content_ref: payload.content.ref,
      content_name: payload.content.name.slice(0, 260),
      content_sha256: payload.content.sha256,
      auth_method: payload.authMethod,
      consent_version: payload.consentVersion,
      id_signature_master: master?.id_signature_master ?? null,
      master_sha256: payload.masterSha256,
      ip: payload.ip,
      user_agent: payload.userAgent,
      evidence_item_id: item.id,
      evidence_path: evidencePath,
      evidence_sha256: evidenceSha,
      prev_record_hash: prev,
      record_hash: recordHash,
    },
  });
  await writeSgcAudit(tx, {
    idCompany: payload.idCompany,
    actorEmail: email,
    action: SGC_AUDIT_ACTIONS.firmaRegistrada,
    entity: 'signature',
    entityId: row.id_signature,
    after: { uid: payload.uid, idRequest: payload.idRequest, idTask: payload.idTask, meaning: payload.meaning, contentSha256: payload.content.sha256, recordHash, evidencePath, authMethod: payload.authMethod },
    detail: payload.reason,
    ip: payload.ip,
    userAgent: payload.userAgent,
  });
  return { idSignature: row.id_signature, payload, recordHash, evidencePath };
}

/** Guarda la lista de chequeo de Calidad (solo inserción) y la deja en la auditoría. */
export async function recordQualityCheck(
  tx: Tx,
  p: {
    request: { id_request: number; id_company: number };
    idTask: number;
    idTaskAssignee: number;
    idSignature: number | null;
    fields: readonly SgcFormFieldDefinition[];
    raw: unknown;
    actor: SgcActor;
    now: Date;
  }
): Promise<SgcChecklistResult> {
  const chk = normalizeChecklist(p.fields, p.raw);
  const row = await tx.sgcQualityCheck.create({
    data: {
      id_request: p.request.id_request,
      id_task: p.idTask,
      id_task_assignee: p.idTaskAssignee,
      id_signature: p.idSignature,
      items_json: JSON.stringify(chk.items),
      result: chk.result,
      checked_by: p.actor.email.trim().toLowerCase(),
      checked_at: p.now,
    },
  });
  await writeSgcAudit(tx, {
    idCompany: p.request.id_company,
    actorEmail: p.actor.email,
    action: SGC_AUDIT_ACTIONS.chequeoCalidad,
    entity: 'quality_check',
    entityId: row.id_quality_check,
    after: { idRequest: p.request.id_request, idTask: p.idTask, result: chk.result, items: chk.items.map((i) => ({ key: i.key, answer: i.answer })) },
    ip: p.actor.ip,
    userAgent: p.actor.userAgent,
  });
  return chk;
}
