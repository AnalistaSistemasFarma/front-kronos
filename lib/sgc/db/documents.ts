import type { Prisma } from '../../../app/generated/prisma';
import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import {
  buildCodeRoot,
  buildDocumentCode,
  getDocumentCodeError,
  nextSequence,
  normalizeDocumentCode,
  parseSequenceFromCode,
} from '../coding';
import { isSgcConfidentiality, isSgcDocumentStatus, type SgcConfidentiality } from '../constants';
import {
  getGrantInputError,
  resolveDocumentPermissions,
  type SgcAccessGrant,
  type SgcAccessSubject,
  type SgcDocumentPermissions,
} from '../documentAccess';
import { SgcError, isUniqueViolation } from '../errors';
import type { SgcMasterItem } from '../masterList';
import type { SgcCompanyAccess } from '../permissions';
import { computeReviewDueDate, formatCalendarDate, toCalendarDate } from '../review';
import { buildVersionFileName, buildVersionFolderSegments, getControlledPdfError, getSourceFileError, sha256Hex } from '../storage';
import type { SgcActor, SgcDb } from './catalogs';

/**
 * Repositorio de documentos del SGC (esquema `sgc`): listado maestro, ficha,
 * carga administrativa inicial de vigentes por Calidad, metadatos, anulación
 * y accesos. Cada acción queda en sgc.audit_log.
 */

/** Sube un archivo a la carpeta indicada y devuelve el id del item de OneDrive. */
export type SgcUploader = (segments: string[], fileName: string, content: Uint8Array, contentType: string) => Promise<{ id: string }>;

/** Departamentos de la persona (dbo.department_user) para evaluar permisos. */
export async function getAccessSubject(db: SgcDb, email: string): Promise<SgcAccessSubject> {
  const rows = await db.departmentUser.findMany({
    where: { user: { email } },
    select: { id_department: true },
  });
  return { email, departmentIds: [...new Set(rows.map((r) => r.id_department))] };
}

const documentInclude = {
  documentType: true,
  process: { include: { processType: true, department: { select: { department: true } } } },
  ownerDepartment: { select: { department: true } },
  accesses: true,
} satisfies Prisma.SgcDocumentInclude;

type DocumentRow = Prisma.SgcDocumentGetPayload<{ include: typeof documentInclude }>;

function toGrant(a: DocumentRow['accesses'][number]): SgcAccessGrant {
  return {
    idDepartment: a.id_department,
    userEmail: a.user_email,
    canView: a.can_view,
    canDownload: a.can_download,
    canPrint: a.can_print,
    expiresAt: a.expires_at,
    revokedAt: a.revoked_at,
  };
}

function permissionsFor(access: SgcCompanyAccess, subject: SgcAccessSubject, doc: DocumentRow, now: Date): SgcDocumentPermissions {
  return resolveDocumentPermissions(
    access,
    subject,
    { idCompany: doc.id_company, status: doc.status, confidentiality: doc.confidentiality, idOwnerDepartment: doc.id_owner_department },
    doc.accesses.map(toGrant),
    now
  );
}

function toMasterItem(doc: DocumentRow, current: { id_document_version: number; version_number: number; effective_date: Date | null; review_due_date: Date | null } | null): SgcMasterItem {
  return {
    idDocument: doc.id_document,
    code: doc.code,
    title: doc.title,
    status: doc.status,
    confidentiality: doc.confidentiality,
    versionNumber: current?.version_number ?? null,
    idVersion: current?.id_document_version ?? null,
    effectiveDate: formatCalendarDate(current?.effective_date ?? null),
    reviewDueDate: formatCalendarDate(current?.review_due_date ?? doc.next_review_date ?? null),
    processType: {
      id: doc.process.processType.id_process_type,
      code: doc.process.processType.code,
      name: doc.process.processType.name,
      color: doc.process.processType.color,
    },
    process: {
      id: doc.process.id_process_map,
      code: doc.process.code,
      name: doc.process.name,
      department: doc.process.department?.department ?? null,
    },
    documentType: {
      id: doc.documentType.id_document_type,
      code: doc.documentType.code,
      name: doc.documentType.name,
      pluralName: doc.documentType.plural_name,
      alertMonths: doc.documentType.alert_months,
    },
  };
}

/**
 * Listado maestro de la empresa para la persona: solo lo que puede consultar.
 * Quien no es de Calidad ve solo VIGENTES; Calidad puede pedir un estado.
 */
export async function listMasterDocuments(
  db: SgcDb,
  access: SgcCompanyAccess,
  subject: SgcAccessSubject,
  opts: { status?: string | null } = {},
  now: Date = new Date()
): Promise<SgcMasterItem[]> {
  let statusFilter: string | undefined = 'vigente';
  if (access.canQuality) {
    statusFilter = opts.status === 'todos' ? undefined : isSgcDocumentStatus(opts.status) ? opts.status : 'vigente';
  }
  const docs = await db.sgcDocument.findMany({
    where: { id_company: access.idCompany, ...(statusFilter ? { status: statusFilter } : {}) },
    include: documentInclude,
  });
  const visible = docs.filter((d) => permissionsFor(access, subject, d, now).canView);
  const versionIds = visible.map((d) => d.current_version_id).filter((v): v is number => v !== null);
  const versions = versionIds.length
    ? await db.sgcDocumentVersion.findMany({
        where: { id_document_version: { in: versionIds } },
        select: { id_document_version: true, id_document: true, version_number: true, effective_date: true, review_due_date: true },
      })
    : [];
  const byId = new Map(versions.map((v) => [v.id_document_version, v]));
  return visible
    .map((d) => toMasterItem(d, d.current_version_id ? (byId.get(d.current_version_id) ?? null) : null))
    .sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true, sensitivity: 'base' }));
}

export interface SgcDocumentDetail {
  document: SgcMasterItem & {
    ownerDepartment: string | null;
    idOwnerDepartment: number | null;
    createdBy: string;
    createdAt: string;
    annulReason: string | null;
    annulledAt: string | null;
    annulledBy: string | null;
    requiresTraining: boolean;
    reviewMonths: number;
  };
  versions: {
    id: number;
    versionNumber: number;
    status: string;
    pdfFileName: string;
    pdfSha256: string;
    pdfSize: number;
    hasSource: boolean;
    sourceFileName: string | null;
    changeDescription: string | null;
    effectiveDate: string | null;
    reviewDueDate: string | null;
    obsoleteDate: string | null;
    createdBy: string;
    createdAt: string;
    isCurrent: boolean;
    storagePath: string | null;
  }[];
  permissions: SgcDocumentPermissions;
  accesses:
    | {
        id: number;
        idDepartment: number | null;
        userEmail: string | null;
        canView: boolean;
        canDownload: boolean;
        canPrint: boolean;
        expiresAt: string | null;
        reason: string;
        grantedBy: string;
        createdAt: string;
        revokedAt: string | null;
        revokedBy: string | null;
      }[]
    | null;
}

async function loadDocument(db: SgcDb, idDocument: number): Promise<DocumentRow | null> {
  if (!Number.isInteger(idDocument) || idDocument < 1) return null;
  return db.sgcDocument.findUnique({ where: { id_document: idDocument }, include: documentInclude });
}

/**
 * Ficha del documento. Devuelve null si no existe o si la persona no lo puede
 * consultar (la ruta responde 404 en ambos casos, para no revelar que existe).
 * Quien no es de Calidad solo ve la versión vigente, sin rutas de OneDrive ni
 * accesos.
 */
export async function getDocumentDetail(
  db: SgcDb,
  accessByCompany: readonly SgcCompanyAccess[],
  subject: SgcAccessSubject,
  idDocument: number,
  now: Date = new Date()
): Promise<SgcDocumentDetail | null> {
  const doc = await loadDocument(db, idDocument);
  if (!doc) return null;
  const access = accessByCompany.find((a) => a.idCompany === doc.id_company);
  if (!access) return null;
  const permissions = permissionsFor(access, subject, doc, now);
  if (!permissions.canView) return null;

  const versions = await db.sgcDocumentVersion.findMany({
    where: { id_document: doc.id_document, ...(permissions.canAdminister ? {} : { id_document_version: doc.current_version_id ?? -1 }) },
    orderBy: { version_number: 'desc' },
  });
  const current = versions.find((v) => v.id_document_version === doc.current_version_id) ?? null;
  const item = toMasterItem(doc, current);

  return {
    document: {
      ...item,
      ownerDepartment: doc.ownerDepartment?.department ?? null,
      idOwnerDepartment: doc.id_owner_department,
      createdBy: doc.created_by,
      createdAt: doc.created_at.toISOString(),
      annulReason: doc.annul_reason,
      annulledAt: doc.annulled_at ? doc.annulled_at.toISOString() : null,
      annulledBy: doc.annulled_by,
      requiresTraining: doc.documentType.requires_training,
      reviewMonths: doc.documentType.review_months,
    },
    versions: versions.map((v) => ({
      id: v.id_document_version,
      versionNumber: v.version_number,
      status: v.status,
      pdfFileName: v.pdf_file_name,
      pdfSha256: v.pdf_sha256,
      pdfSize: v.pdf_size,
      hasSource: !!v.source_item_id,
      sourceFileName: permissions.canAdminister ? v.source_file_name : null,
      changeDescription: v.change_description,
      effectiveDate: formatCalendarDate(v.effective_date),
      reviewDueDate: formatCalendarDate(v.review_due_date),
      obsoleteDate: formatCalendarDate(v.obsolete_date),
      createdBy: v.created_by,
      createdAt: v.created_at.toISOString(),
      isCurrent: v.id_document_version === doc.current_version_id,
      storagePath: permissions.canAdminister ? v.pdf_path : null,
    })),
    permissions,
    accesses: permissions.canAdminister
      ? doc.accesses
          .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
          .map((a) => ({
            id: a.id_document_access,
            idDepartment: a.id_department,
            userEmail: a.user_email,
            canView: a.can_view,
            canDownload: a.can_download,
            canPrint: a.can_print,
            expiresAt: a.expires_at ? a.expires_at.toISOString() : null,
            reason: a.reason,
            grantedBy: a.granted_by,
            createdAt: a.created_at.toISOString(),
            revokedAt: a.revoked_at ? a.revoked_at.toISOString() : null,
            revokedBy: a.revoked_by,
          }))
      : null,
  };
}

/**
 * Versión a mostrar en el visor. Quien no es de Calidad solo puede abrir la
 * versión VIGENTE de un documento que puede consultar. Devuelve null si no.
 */
export async function getVersionForViewer(
  db: SgcDb,
  accessByCompany: readonly SgcCompanyAccess[],
  subject: SgcAccessSubject,
  idDocument: number,
  idVersion: number,
  now: Date = new Date()
) {
  const doc = await loadDocument(db, idDocument);
  if (!doc) return null;
  const access = accessByCompany.find((a) => a.idCompany === doc.id_company);
  if (!access) return null;
  const permissions = permissionsFor(access, subject, doc, now);
  if (!permissions.canView) return null;
  if (!permissions.canAdminister && idVersion !== doc.current_version_id) return null;
  const version = await db.sgcDocumentVersion.findFirst({ where: { id_document_version: idVersion, id_document: idDocument } });
  if (!version) return null;
  return { document: { id: doc.id_document, idCompany: doc.id_company, code: doc.code, title: doc.title }, version, permissions };
}

// ---------------------------------------------------------------------------
// Carga administrativa inicial de un documento vigente (Calidad).
// ---------------------------------------------------------------------------

export interface SgcInitialLoadInput {
  idCompany: number;
  idProcess: number;
  idDocumentType: number;
  title: string;
  /** Código que el documento ya tiene; si viene vacío se genera con la guía. */
  code?: string | null;
  confidentiality: string;
  idOwnerDepartment?: number | null;
  versionNumber: number;
  /** Fecha de vigencia de esa versión (YYYY-MM-DD). */
  effectiveDate: string;
  changeDescription?: string | null;
  pdf: { bytes: Uint8Array; fileName: string };
  source?: { bytes: Uint8Array; fileName: string; contentType: string } | null;
}

/** Valida y resuelve lo necesario ANTES de subir nada a OneDrive. */
async function prepareInitialLoad(db: SgcDb, input: SgcInitialLoadInput, now: Date) {
  const title = (input.title ?? '').trim();
  if (title.length < 3 || title.length > 300) throw new SgcError('El título es obligatorio (3 a 300 caracteres).');
  if (!isSgcConfidentiality(input.confidentiality)) throw new SgcError('Confidencialidad inválida.');
  if (!Number.isInteger(input.versionNumber) || input.versionNumber < 1 || input.versionNumber > 999) {
    throw new SgcError('La versión debe ser un entero entre 1 y 999.');
  }
  let effective: Date;
  try {
    effective = toCalendarDate(input.effectiveDate);
  } catch {
    throw new SgcError('La fecha de vigencia no es válida.');
  }
  if (effective.getTime() > toCalendarDate(now).getTime()) throw new SgcError('La fecha de vigencia no puede ser futura.');

  const pdfError = getControlledPdfError(input.pdf?.bytes);
  if (pdfError) throw new SgcError(pdfError);
  const sourceError = input.source ? getSourceFileError(input.source.bytes, input.source.fileName) : null;
  if (sourceError) throw new SgcError(sourceError);

  const [config, guide, process, docType] = await Promise.all([
    db.sgcCompanyConfig.findUnique({ where: { id_company: input.idCompany } }),
    db.sgcCodingGuide.findUnique({ where: { id_company: input.idCompany } }),
    db.sgcProcessMap.findFirst({
      where: { id_process_map: input.idProcess, id_company: input.idCompany, is_active: true },
      include: { processType: true },
    }),
    db.sgcDocumentType.findFirst({ where: { id_document_type: input.idDocumentType, id_company: input.idCompany, is_active: true } }),
  ]);
  if (!config || !config.is_active) throw new SgcError('La empresa no está activa en el SGC.', 403);
  if (!process) throw new SgcError('Seleccione un proceso activo de la empresa.');
  if (!docType) throw new SgcError('Seleccione un tipo documental activo de la empresa.');

  const idOwnerDepartment = input.idOwnerDepartment ?? process.id_department ?? null;
  if (input.confidentiality === 'departamento' && idOwnerDepartment === null) {
    throw new SgcError('Un documento "por departamento" necesita un departamento dueño (el del proceso o uno indicado).');
  }

  const parts = { processTypeCode: process.processType.code, processCode: process.code, documentTypeCode: docType.code };
  let code: string;
  let sequence: number | null = null;
  const manual = normalizeDocumentCode(input.code ?? '');
  if (manual) {
    const codeError = getDocumentCodeError(manual);
    if (codeError) throw new SgcError(codeError);
    code = manual;
    if (guide) sequence = parseSequenceFromCode(guideInput(guide), parts, code);
  } else {
    if (!guide) throw new SgcError('La empresa no tiene guía de codificación: indique el código o configure la guía.');
    const g = guideInput(guide);
    const root = buildCodeRoot(g, parts);
    const existing = await db.sgcDocument.findMany({
      where: { id_company: input.idCompany, code: { startsWith: root } },
      select: { code: true },
    });
    sequence = nextSequence(g, parts, existing.map((e) => e.code));
    code = buildDocumentCode(g, parts, sequence);
  }
  const dup = await db.sgcDocument.findFirst({ where: { id_company: input.idCompany, code }, select: { id_document: true } });
  if (dup) throw new SgcError(`Ya existe un documento con el código ${code} en la empresa.`, 409);

  return { title, effective, config, process, docType, idOwnerDepartment, code, sequence };
}

function guideInput(guide: { prefix: string; pattern: string; sequence_digits: number }) {
  return { prefix: guide.prefix, pattern: guide.pattern, sequenceDigits: guide.sequence_digits };
}

/**
 * Carga administrativa inicial (Sprint 1): Calidad registra un documento que
 * YA está vigente, con su versión y fecha de vigencia reales, para poder
 * mostrar el listado maestro ante el INVIMA. El flujo completo (elaboración,
 * revisión, aprobación, divulgación) llega en el Sprint 2.
 *
 * Orden: se valida todo, se sube el archivo a OneDrive (no es transaccional)
 * y solo si eso sale bien se escribe en la base en una transacción (documento
 * + versión + auditoría).
 */
export async function createInitialDocument(
  db: SgcDb,
  upload: SgcUploader,
  input: SgcInitialLoadInput,
  actor: SgcActor,
  now: Date = new Date()
) {
  const p = await prepareInitialLoad(db, input, now);
  const segments = buildVersionFolderSegments({
    storageRoot: p.config.storage_root,
    documentTypeCode: p.docType.code,
    code: p.code,
    versionNumber: input.versionNumber,
  });
  const pdfName = buildVersionFileName(p.code, input.versionNumber, input.pdf.fileName, 'pdf');
  const pdfHash = sha256Hex(input.pdf.bytes);
  const pdfItem = await upload(segments, pdfName, input.pdf.bytes, 'application/pdf');
  let sourceItem: { id: string } | null = null;
  let sourceName: string | null = null;
  if (input.source && input.source.bytes.length > 0) {
    sourceName = buildVersionFileName(p.code, input.versionNumber, input.source.fileName, 'docx');
    sourceItem = await upload(segments, sourceName, input.source.bytes, input.source.contentType || 'application/octet-stream');
  }
  const reviewDue = computeReviewDueDate(p.effective, p.docType.review_months);
  const folder = segments.join('/');

  try {
    return await db.$transaction(async (tx) => {
      const doc = await tx.sgcDocument.create({
        data: {
          id_company: input.idCompany,
          code: p.code,
          title: p.title,
          id_document_type: p.docType.id_document_type,
          id_process_map: p.process.id_process_map,
          id_owner_department: p.idOwnerDepartment,
          confidentiality: input.confidentiality,
          status: 'vigente',
          sequence_number: p.sequence,
          next_review_date: reviewDue,
          created_by: actor.email,
        },
      });
      const version = await tx.sgcDocumentVersion.create({
        data: {
          id_document: doc.id_document,
          version_number: input.versionNumber,
          status: 'vigente',
          pdf_item_id: pdfItem.id,
          pdf_path: `${folder}/${pdfName}`,
          pdf_file_name: pdfName,
          pdf_sha256: pdfHash,
          pdf_size: input.pdf.bytes.length,
          source_item_id: sourceItem?.id ?? null,
          source_path: sourceItem && sourceName ? `${folder}/${sourceName}` : null,
          source_file_name: sourceName,
          change_description: (input.changeDescription ?? '').trim().slice(0, 2000) || 'Carga inicial del documento vigente.',
          effective_date: p.effective,
          review_due_date: reviewDue,
          created_by: actor.email,
        },
      });
      const saved = await tx.sgcDocument.update({
        where: { id_document: doc.id_document },
        data: { current_version_id: version.id_document_version },
      });
      await writeSgcAudit(tx, {
        idCompany: input.idCompany,
        actorEmail: actor.email,
        action: SGC_AUDIT_ACTIONS.documentoCarga,
        entity: 'document',
        entityId: doc.id_document,
        before: null,
        after: { document: saved, version },
        detail: `Carga inicial de ${p.code} V${input.versionNumber} (SHA-256 ${pdfHash}).`,
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
      return { idDocument: doc.id_document, idVersion: version.id_document_version, code: p.code, pdfSha256: pdfHash, storagePath: folder };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new SgcError(`Ya existe un documento con el código ${p.code} en la empresa.`, 409);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Administración del documento (Calidad).
// ---------------------------------------------------------------------------

async function loadForAdmin(db: SgcDb, accessByCompany: readonly SgcCompanyAccess[], idDocument: number) {
  const doc = await loadDocument(db, idDocument);
  if (!doc) throw new SgcError('Documento no encontrado.', 404);
  const access = accessByCompany.find((a) => a.idCompany === doc.id_company);
  if (!access?.canQuality) throw new SgcError('Solo Aseguramiento de Calidad puede administrar documentos.', 403);
  return doc;
}

function reasonOf(value: unknown): string {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (reason.length < 10) throw new SgcError('Explique el motivo (mínimo 10 caracteres): queda en la auditoría.');
  return reason.slice(0, 1000);
}

/** Edita título, confidencialidad o departamento dueño (con motivo). */
export async function updateDocumentMetadata(
  db: SgcDb,
  accessByCompany: readonly SgcCompanyAccess[],
  idDocument: number,
  patch: { title?: unknown; confidentiality?: unknown; idOwnerDepartment?: unknown; reason?: unknown },
  actor: SgcActor
) {
  const doc = await loadForAdmin(db, accessByCompany, idDocument);
  const reason = reasonOf(patch.reason);
  if (doc.status === 'anulado') throw new SgcError('Un documento anulado no se edita.', 409);
  const data: { title?: string; confidentiality?: SgcConfidentiality; id_owner_department?: number | null } = {};
  if (patch.title !== undefined) {
    const title = typeof patch.title === 'string' ? patch.title.trim() : '';
    if (title.length < 3 || title.length > 300) throw new SgcError('El título es obligatorio (3 a 300 caracteres).');
    data.title = title;
  }
  if (patch.confidentiality !== undefined) {
    if (!isSgcConfidentiality(patch.confidentiality)) throw new SgcError('Confidencialidad inválida.');
    data.confidentiality = patch.confidentiality;
  }
  if (patch.idOwnerDepartment !== undefined) {
    const id = patch.idOwnerDepartment === null || patch.idOwnerDepartment === '' ? null : Number(patch.idOwnerDepartment);
    if (id !== null) {
      const dept = Number.isInteger(id) ? await db.department.findUnique({ where: { id_department: id } }) : null;
      if (!dept) throw new SgcError('El departamento no existe.');
    }
    data.id_owner_department = id;
  }
  if (Object.keys(data).length === 0) throw new SgcError('No hay cambios que guardar.');
  const finalConf = data.confidentiality ?? doc.confidentiality;
  const finalOwner = data.id_owner_department !== undefined ? data.id_owner_department : doc.id_owner_department;
  if (finalConf === 'departamento' && finalOwner === null) throw new SgcError('Un documento "por departamento" necesita departamento dueño.');

  return db.$transaction(async (tx) => {
    const saved = await tx.sgcDocument.update({ where: { id_document: idDocument }, data });
    await writeSgcAudit(tx, {
      idCompany: doc.id_company,
      actorEmail: actor.email,
      action: SGC_AUDIT_ACTIONS.documentoEdicion,
      entity: 'document',
      entityId: idDocument,
      before: { title: doc.title, confidentiality: doc.confidentiality, id_owner_department: doc.id_owner_department },
      after: { title: saved.title, confidentiality: saved.confidentiality, id_owner_department: saved.id_owner_department },
      detail: reason,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return saved;
  });
}

/** Anula el documento (no se borra nada): estado anulado con motivo. */
export async function annulDocument(
  db: SgcDb,
  accessByCompany: readonly SgcCompanyAccess[],
  idDocument: number,
  rawReason: unknown,
  actor: SgcActor,
  now: Date = new Date()
) {
  const doc = await loadForAdmin(db, accessByCompany, idDocument);
  const reason = reasonOf(rawReason);
  if (doc.status === 'anulado') throw new SgcError('El documento ya está anulado.', 409);
  return db.$transaction(async (tx) => {
    const saved = await tx.sgcDocument.update({
      where: { id_document: idDocument },
      data: { status: 'anulado', annulled_at: now, annulled_by: actor.email, annul_reason: reason },
    });
    if (doc.current_version_id) {
      await tx.sgcDocumentVersion.update({
        where: { id_document_version: doc.current_version_id },
        data: { status: 'anulado', obsolete_date: toCalendarDate(now) },
      });
    }
    await writeSgcAudit(tx, {
      idCompany: doc.id_company,
      actorEmail: actor.email,
      action: SGC_AUDIT_ACTIONS.documentoAnulacion,
      entity: 'document',
      entityId: idDocument,
      before: { status: doc.status },
      after: { status: 'anulado' },
      detail: reason,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return saved;
  });
}

/** Otorga un acceso (consulta o permiso excepcional de descarga/impresión). */
export async function grantDocumentAccess(
  db: SgcDb,
  accessByCompany: readonly SgcCompanyAccess[],
  idDocument: number,
  body: Record<string, unknown>,
  actor: SgcActor,
  now: Date = new Date()
) {
  const doc = await loadForAdmin(db, accessByCompany, idDocument);
  const idDepartment = body.idDepartment === undefined || body.idDepartment === null || body.idDepartment === '' ? null : Number(body.idDepartment);
  const userEmail = typeof body.userEmail === 'string' && body.userEmail.trim() ? body.userEmail.trim().toLowerCase() : null;
  let expiresAt: Date | null = null;
  if (typeof body.expiresAt === 'string' && body.expiresAt.trim()) {
    expiresAt = new Date(body.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) throw new SgcError('La fecha de vencimiento no es válida.');
  }
  const input = {
    idDepartment,
    userEmail,
    canView: body.canView !== false,
    canDownload: body.canDownload === true,
    canPrint: body.canPrint === true,
    expiresAt,
    reason: typeof body.reason === 'string' ? body.reason.trim() : '',
  };
  const error = getGrantInputError(input, now);
  if (error) throw new SgcError(error);
  if (idDepartment !== null) {
    const dept = await db.department.findUnique({ where: { id_department: idDepartment } });
    if (!dept) throw new SgcError('El departamento no existe.');
  }
  return db.$transaction(async (tx) => {
    const saved = await tx.sgcDocumentAccess.create({
      data: {
        id_document: idDocument,
        id_department: input.idDepartment,
        user_email: input.userEmail,
        can_view: input.canView,
        can_download: input.canDownload,
        can_print: input.canPrint,
        expires_at: input.expiresAt,
        reason: input.reason.slice(0, 1000),
        granted_by: actor.email,
      },
    });
    await writeSgcAudit(tx, {
      idCompany: doc.id_company,
      actorEmail: actor.email,
      action: SGC_AUDIT_ACTIONS.accesoOtorgado,
      entity: 'document_access',
      entityId: saved.id_document_access,
      before: null,
      after: saved,
      detail: `${doc.code}: ${input.reason}`.slice(0, 1000),
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return saved;
  });
}

/** Revoca un acceso (queda la fila con revoked_at: nada se borra). */
export async function revokeDocumentAccess(
  db: SgcDb,
  accessByCompany: readonly SgcCompanyAccess[],
  idDocument: number,
  idAccess: number,
  rawReason: unknown,
  actor: SgcActor,
  now: Date = new Date()
) {
  const doc = await loadForAdmin(db, accessByCompany, idDocument);
  const reason = reasonOf(rawReason);
  const grant = await db.sgcDocumentAccess.findFirst({ where: { id_document_access: idAccess, id_document: idDocument } });
  if (!grant) throw new SgcError('Acceso no encontrado.', 404);
  if (grant.revoked_at) throw new SgcError('El acceso ya estaba revocado.', 409);
  return db.$transaction(async (tx) => {
    const saved = await tx.sgcDocumentAccess.update({
      where: { id_document_access: idAccess },
      data: { revoked_at: now, revoked_by: actor.email },
    });
    await writeSgcAudit(tx, {
      idCompany: doc.id_company,
      actorEmail: actor.email,
      action: SGC_AUDIT_ACTIONS.accesoRevocado,
      entity: 'document_access',
      entityId: idAccess,
      before: grant,
      after: saved,
      detail: `${doc.code}: ${reason}`.slice(0, 1000),
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return saved;
  });
}
