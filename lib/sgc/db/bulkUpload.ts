import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import { matchBulkFile, matchBulkFiles, type SgcBulkCandidate, type SgcBulkMatch } from '../bulkUpload';
import { SgcError } from '../errors';
import { computeReviewDueDate } from '../review';
import { buildVersionFileName, buildVersionFolderSegments, getControlledPdfError, sha256Hex } from '../storage';
import type { SgcActor, SgcDb } from './catalogs';
import type { SgcUploader } from './documents';

/**
 * CARGA MASIVA DE LOS PDF del listado maestro (Sprint 9): cada archivo se
 * empareja por su código con un documento «pendiente de archivo» (importado
 * del Excel de Calidad), se guarda como su versión VIGENTE con la versión y
 * la fecha de vigencia que traía el listado, y el documento pasa a vigente
 * (desde ahí el visor lo muestra con la marca de la copia controlada). Si el
 * nombre del archivo no se parece al del listado, se avisa. Cada tanda y cada
 * archivo quedan en sgc.bulk_upload(_item), de solo inserción.
 */

async function candidatesOf(db: SgcDb, idCompany: number): Promise<SgcBulkCandidate[]> {
  const docs = await db.sgcDocument.findMany({ where: { id_company: idCompany }, select: { id_document: true, code: true, title: true, status: true } });
  return docs.map((d) => ({ idDocument: d.id_document, code: d.code, title: d.title, status: d.status }));
}

async function assertInitialLoadOpen(db: SgcDb, idCompany: number) {
  const config = await db.sgcCompanyConfig.findUnique({ where: { id_company: idCompany }, select: { is_active: true, initial_load_open: true } });
  if (!config?.is_active) throw new SgcError('La empresa no está activa en el SGC.', 403);
  if (!config.initial_load_open) throw new SgcError('La carga inicial de documentos vigentes está cerrada: los documentos nuevos entran por una solicitud documental.', 409);
}

/** VISTA PREVIA: con qué documento se empareja cada archivo (no guarda nada). */
export async function previewBulkUpload(db: SgcDb, idCompany: number, input: { fileNames?: unknown }): Promise<SgcBulkMatch[]> {
  const names = Array.isArray(input.fileNames) ? input.fileNames.filter((n): n is string => typeof n === 'string' && n.trim().length > 0).map((n) => n.trim().slice(0, 260)) : [];
  if (!names.length) throw new SgcError('Seleccione los PDF que va a cargar.');
  if (names.length > 500) throw new SgcError('Máximo 500 archivos por carga.');
  return matchBulkFiles(names, await candidatesOf(db, idCompany));
}

/** Abre una tanda (su encabezado). Solo con la carga inicial abierta. */
export async function startBulkUpload(db: SgcDb, idCompany: number, input: { filesTotal?: unknown }, actor: SgcActor) {
  await assertInitialLoadOpen(db, idCompany);
  const total = Number(input.filesTotal);
  if (!Number.isInteger(total) || total < 1 || total > 500) throw new SgcError('Indique cuántos archivos tiene la carga (1 a 500).');
  const row = await db.sgcBulkUpload.create({ data: { id_company: idCompany, files_total: total, created_by: actor.email.toLowerCase(), created_at: new Date(), ip: actor.ip ?? null } });
  return { idBulkUpload: row.id_bulk_upload };
}

export interface SgcBulkFileResult {
  fileName: string;
  status: 'cargado' | 'error';
  code: string | null;
  idDocument: number | null;
  idVersion: number | null;
  warning: string | null;
  error: string | null;
}

/**
 * Carga UN archivo de la tanda. Los errores de negocio (no empareja, ya tiene
 * archivo, no es PDF…) NO lanzan: quedan como fila «error» de la tanda y se
 * devuelven, para que el navegador siga con el siguiente archivo.
 */
export async function uploadBulkFile(
  db: SgcDb,
  upload: SgcUploader,
  idCompany: number,
  idBulkUpload: number,
  file: { fileName: string; bytes: Uint8Array },
  actor: SgcActor,
  now: Date = new Date()
): Promise<SgcBulkFileResult> {
  const batch = Number.isInteger(idBulkUpload) ? await db.sgcBulkUpload.findFirst({ where: { id_bulk_upload: idBulkUpload, id_company: idCompany } }) : null;
  if (!batch) throw new SgcError('La carga no existe.', 404);
  if (batch.created_by !== actor.email.toLowerCase()) throw new SgcError('La carga la abrió otra persona.', 403);
  await assertInitialLoadOpen(db, idCompany);
  const fileName = (file.fileName ?? '').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 260) || 'archivo.pdf';
  const email = actor.email.toLowerCase();
  const sha = file.bytes.length ? sha256Hex(file.bytes) : null;
  const fail = async (error: string, match: SgcBulkMatch | null = null): Promise<SgcBulkFileResult> => {
    await db.sgcBulkUploadItem.create({
      data: { id_bulk_upload: idBulkUpload, file_name: fileName, size_bytes: file.bytes.length, sha256: sha, code: match?.code ?? null, id_document: match?.idDocument ?? null, status: 'error', error: error.slice(0, 1000), created_by: email, created_at: now },
    });
    return { fileName, status: 'error', code: match?.code ?? null, idDocument: match?.idDocument ?? null, idVersion: null, warning: null, error };
  };
  const match = matchBulkFile(fileName, await candidatesOf(db, idCompany));
  if (match.status === 'error') return fail(match.error!, match);
  const pdfError = getControlledPdfError(file.bytes);
  if (pdfError) return fail(pdfError, match);
  const doc = await db.sgcDocument.findUniqueOrThrow({ where: { id_document: match.idDocument! }, include: { documentType: true, companyConfig: true } });
  const listed = await db.sgcMasterListImportRow.findFirst({ where: { id_document: doc.id_document, status: 'cargada' }, orderBy: { id_master_list_import_row: 'desc' } });
  if (!listed?.version_number || !listed.effective_date) return fail(`El documento ${doc.code} no tiene versión ni fecha de vigencia del listado maestro.`, match);
  const version = listed.version_number;
  const segments = buildVersionFolderSegments({ storageRoot: doc.companyConfig.storage_root, documentTypeCode: doc.documentType.code, code: doc.code, versionNumber: version });
  const pdfName = buildVersionFileName(doc.code, version, 'x.pdf', 'pdf');
  const item = await upload(segments, pdfName, file.bytes, 'application/pdf');
  const reviewDue = computeReviewDueDate(listed.effective_date, doc.documentType.review_months);
  try {
    return await db.$transaction(async (tx) => {
      const claimed = await tx.sgcDocument.updateMany({ where: { id_document: doc.id_document, status: 'pendiente_archivo' }, data: { status: 'vigente', next_review_date: reviewDue } });
      if (claimed.count === 0) throw new SgcError(`El documento ${doc.code} ya recibió su archivo.`, 409);
      const v = await tx.sgcDocumentVersion.create({
        data: {
          id_document: doc.id_document,
          version_number: version,
          status: 'vigente',
          pdf_item_id: item.id,
          pdf_path: `${segments.join('/')}/${pdfName}`,
          pdf_file_name: pdfName,
          pdf_sha256: sha!,
          pdf_size: file.bytes.length,
          change_description: 'Carga inicial del documento vigente (listado maestro).',
          effective_date: listed.effective_date,
          review_due_date: reviewDue,
          created_by: actor.email,
        },
      });
      await tx.sgcDocument.update({ where: { id_document: doc.id_document }, data: { current_version_id: v.id_document_version } });
      await tx.sgcBulkUploadItem.create({
        data: { id_bulk_upload: idBulkUpload, file_name: fileName, size_bytes: file.bytes.length, sha256: sha, code: doc.code, id_document: doc.id_document, id_document_version: v.id_document_version, status: 'cargado', warning: match.warning?.slice(0, 1000) ?? null, created_by: email, created_at: now },
      });
      await writeSgcAudit(tx, {
        idCompany,
        actorEmail: actor.email,
        action: SGC_AUDIT_ACTIONS.documentoCarga,
        entity: 'document',
        entityId: doc.id_document,
        before: { status: 'pendiente_archivo' },
        after: { status: 'vigente', version, idVersion: v.id_document_version, file: fileName, sha256: sha },
        detail: `Carga masiva (tanda ${idBulkUpload}): ${doc.code} V${version} desde «${fileName}» (SHA-256 ${sha}).${match.warning ? ` Aviso: ${match.warning}` : ''}`.slice(0, 1000),
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
      return { fileName, status: 'cargado' as const, code: doc.code, idDocument: doc.id_document, idVersion: v.id_document_version, warning: match.warning, error: null };
    });
  } catch (error) {
    if (error instanceof SgcError && error.status === 409) return fail(error.message, match);
    throw error;
  }
}

/** Historial de cargas masivas con su resultado. */
export async function listBulkUploads(db: SgcDb, idCompany: number) {
  const rows = await db.sgcBulkUpload.findMany({ where: { id_company: idCompany }, include: { items: { select: { status: true, warning: true } } }, orderBy: { id_bulk_upload: 'desc' }, take: 50 });
  return rows.map((r) => ({
    id: r.id_bulk_upload,
    filesTotal: r.files_total,
    loaded: r.items.filter((i) => i.status === 'cargado').length,
    errors: r.items.filter((i) => i.status === 'error').length,
    warnings: r.items.filter((i) => i.status === 'cargado' && i.warning).length,
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
  }));
}

/** Cierre de la carga inicial: Calidad, con motivo; no se cierra con documentos aún «pendientes de archivo». */
export async function closeInitialLoad(db: SgcDb, idCompany: number, input: { reason?: unknown }, actor: SgcActor, now: Date = new Date()) {
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < 10) throw new SgcError('Explique el motivo del cierre (mínimo 10 caracteres): queda en el control de cambios.');
  const config = await db.sgcCompanyConfig.findUnique({ where: { id_company: idCompany }, select: { initial_load_open: true } });
  if (!config) throw new SgcError('La empresa no tiene el SGC activo.', 404);
  if (!config.initial_load_open) throw new SgcError('La carga inicial ya estaba cerrada.', 409);
  const pending = await db.sgcDocument.count({ where: { id_company: idCompany, status: 'pendiente_archivo' } });
  if (pending > 0) throw new SgcError(`Hay ${pending} documento(s) pendientes de archivo: cargue sus PDF (o anúlelos) antes de cerrar la carga inicial.`, 409);
  await db.$transaction(async (tx) => {
    await tx.sgcCompanyConfig.update({ where: { id_company: idCompany }, data: { initial_load_open: false, initial_load_closed_by: actor.email.toLowerCase(), initial_load_closed_at: now, initial_load_close_reason: reason.slice(0, 1000), updated_at: now } });
    await writeSgcAudit(tx, {
      idCompany,
      actorEmail: actor.email,
      action: SGC_AUDIT_ACTIONS.cargaInicialCerrada,
      entity: 'company_config',
      entityId: idCompany,
      before: { initialLoadOpen: true },
      after: { initialLoadOpen: false },
      detail: reason.slice(0, 1000),
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  });
  return { open: false, closedAt: now.toISOString() };
}
