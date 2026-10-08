import { SGC_AUDIT_ACTIONS, writeSgcAudit } from '../audit';
import { SgcError } from '../errors';
import {
  canonicalRows,
  getMasterListRowsError,
  validateMasterList,
  type SgcMasterListContext,
  type SgcMasterListRawRow,
  type SgcMasterListValidation,
} from '../masterListImport';
import { computeReviewDueDate, toCalendarDate } from '../review';
import { sha256HexOf } from '../signature/record';
import type { SgcActor, SgcDb } from './catalogs';
import { guideInputOf } from './coding';

/**
 * IMPORTACIÓN DEL LISTADO MAESTRO (Sprint 8): Aseguramiento de Calidad sube
 * el Excel, ve la VISTA PREVIA con los errores por fila (nada se guarda) y
 * CONFIRMA. Al confirmar se vuelve a validar todo en el servidor y, en una
 * sola transacción, se crean los documentos de las filas sin error en estado
 * «pendiente de archivo» (con su código, consecutivo, versión y fecha de
 * vigencia) y se guarda el historial de la importación con TODAS las filas
 * (las que tienen error, con su motivo, sin crear documento). Solo inserción.
 */

const TX_OPTS = { maxWait: 10_000, timeout: 120_000 } as const;

function todayCO(now: Date): string {
  return new Date(now.getTime() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}

async function contextFor(db: SgcDb, idCompany: number, now: Date): Promise<SgcMasterListContext> {
  const [config, guide, processes, types, docs] = await Promise.all([
    db.sgcCompanyConfig.findUnique({ where: { id_company: idCompany } }),
    db.sgcCodingGuide.findUnique({ where: { id_company: idCompany } }),
    db.sgcProcessMap.findMany({ where: { id_company: idCompany, is_active: true }, include: { processType: true } }),
    db.sgcDocumentType.findMany({ where: { id_company: idCompany, is_active: true } }),
    db.sgcDocument.findMany({ where: { id_company: idCompany }, select: { code: true, sequence_number: true, process: { select: { code: true, processType: { select: { code: true } } } }, documentType: { select: { code: true } } } }),
  ]);
  if (!config?.is_active) throw new SgcError('La empresa no está activa en el SGC.', 403);
  return {
    guide: guide ? guideInputOf(guide) : null,
    processes: new Map(processes.map((p) => [p.code.toUpperCase(), { id: p.id_process_map, processTypeCode: p.processType.code, idDepartment: p.id_department }])),
    documentTypes: new Map(types.map((t) => [t.code.toUpperCase(), { id: t.id_document_type }])),
    existing: new Map(docs.map((d) => [d.code.toUpperCase(), { sequence: d.sequence_number, processCode: d.process.code, processTypeCode: d.process.processType.code, documentTypeCode: d.documentType.code }])),
    today: todayCO(now),
  };
}

export interface SgcMasterListInput {
  fileName?: unknown;
  rows?: unknown;
}

function rowsOf(input: SgcMasterListInput): SgcMasterListRawRow[] {
  const error = getMasterListRowsError(input.rows);
  if (error) throw new SgcError(error);
  return input.rows as SgcMasterListRawRow[];
}

/** VISTA PREVIA: valida el listado sin guardar nada. */
export async function previewMasterListImport(db: SgcDb, idCompany: number, input: SgcMasterListInput, now: Date = new Date()): Promise<SgcMasterListValidation & { rowsSha256: string }> {
  const rows = rowsOf(input);
  const result = validateMasterList(rows, await contextFor(db, idCompany, now));
  return { ...result, rowsSha256: sha256HexOf(canonicalRows(rows)) };
}

/**
 * CONFIRMA la importación. Si se envía `expectedSha256` (la huella de la
 * vista previa) y las filas cambiaron, se rechaza: lo que se carga es lo que
 * Calidad vio.
 */
export async function confirmMasterListImport(
  db: SgcDb,
  idCompany: number,
  input: SgcMasterListInput & { expectedSha256?: unknown },
  actor: SgcActor,
  now: Date = new Date()
) {
  const rows = rowsOf(input);
  const fileName = (typeof input.fileName === 'string' ? input.fileName.trim() : '').slice(0, 260) || 'listado-maestro.xlsx';
  const rowsSha256 = sha256HexOf(canonicalRows(rows));
  if (typeof input.expectedSha256 === 'string' && input.expectedSha256 && input.expectedSha256 !== rowsSha256) {
    throw new SgcError('El listado cambió después de la vista previa: vuelva a revisarlo antes de cargar.', 409);
  }
  const config = await db.sgcCompanyConfig.findUnique({ where: { id_company: idCompany }, select: { initial_load_open: true } });
  if (config && !config.initial_load_open) throw new SgcError('La carga inicial de documentos vigentes ya se cerró: el listado maestro no se puede volver a importar.', 409);
  const ctx = await contextFor(db, idCompany, now);
  const validation = validateMasterList(rows, ctx);
  const ok = validation.items.filter((i) => i.status === 'ok');
  if (!ok.length) throw new SgcError('Ninguna fila se puede cargar: corrija los errores del listado.', 409);
  const types = await db.sgcDocumentType.findMany({ where: { id_company: idCompany }, select: { id_document_type: true, review_months: true } });
  const reviewMonths = new Map(types.map((t) => [t.id_document_type, t.review_months]));
  const processes = await db.sgcProcessMap.findMany({ where: { id_company: idCompany }, select: { id_process_map: true, id_department: true } });
  const deptOf = new Map(processes.map((p) => [p.id_process_map, p.id_department]));

  return db.$transaction(async (tx) => {
    const imp = await tx.sgcMasterListImport.create({
      data: {
        id_company: idCompany,
        file_name: fileName,
        rows_sha256: rowsSha256,
        rows_total: validation.summary.total,
        rows_loaded: ok.length,
        rows_error: validation.summary.errors,
        imported_by: actor.email.trim().toLowerCase(),
        imported_at: now,
        ip: actor.ip ?? null,
      },
    });
    const created: { code: string; idDocument: number }[] = [];
    for (const item of validation.items) {
      let idDocument: number | null = null;
      if (item.status === 'ok') {
        const effective = toCalendarDate(item.effectiveDate!);
        const doc = await tx.sgcDocument.create({
          data: {
            id_company: idCompany,
            code: item.code,
            title: item.title,
            id_document_type: item.idDocumentType!,
            id_process_map: item.idProcess!,
            id_owner_department: deptOf.get(item.idProcess!) ?? null,
            confidentiality: item.confidentiality,
            status: 'pendiente_archivo',
            sequence_number: item.sequence,
            next_review_date: computeReviewDueDate(effective, reviewMonths.get(item.idDocumentType!) ?? 36),
            created_by: actor.email,
          },
        });
        idDocument = doc.id_document;
        created.push({ code: item.code, idDocument });
        await writeSgcAudit(tx, {
          idCompany,
          actorEmail: actor.email,
          action: SGC_AUDIT_ACTIONS.documentoImportado,
          entity: 'document',
          entityId: doc.id_document,
          after: { code: item.code, title: item.title, versionNumber: item.versionNumber, effectiveDate: item.effectiveDate, status: 'pendiente_archivo', idImport: imp.id_master_list_import, row: item.rowNumber },
          detail: `Importado del listado maestro (${fileName}, fila ${item.rowNumber}): pendiente de archivo.`,
          ip: actor.ip,
          userAgent: actor.userAgent,
        });
      }
      await tx.sgcMasterListImportRow.create({
        data: {
          id_master_list_import: imp.id_master_list_import,
          row_number: item.rowNumber,
          code: item.code ? item.code.slice(0, 60) : null,
          title: item.title ? item.title.slice(0, 300) : null,
          document_type_code: item.documentTypeCode ? item.documentTypeCode.slice(0, 10) : null,
          process_code: item.processCode ? item.processCode.slice(0, 10) : null,
          version_number: item.versionNumber,
          effective_date: item.effectiveDate ? toCalendarDate(item.effectiveDate) : null,
          confidentiality: item.confidentiality,
          parent_code: item.parentCode ? item.parentCode.slice(0, 60) : null,
          status: item.status === 'ok' ? 'cargada' : 'error',
          errors: item.errors.length ? item.errors.join(' ').slice(0, 2000) : null,
          warnings: item.warnings.length ? item.warnings.join(' ').slice(0, 2000) : null,
          id_document: idDocument,
        },
      });
    }
    await writeSgcAudit(tx, {
      idCompany,
      actorEmail: actor.email,
      action: SGC_AUDIT_ACTIONS.listadoMaestroImportado,
      entity: 'master_list_import',
      entityId: imp.id_master_list_import,
      after: { fileName, rowsSha256, total: validation.summary.total, loaded: ok.length, errors: validation.summary.errors, warnings: validation.summary.warnings },
      detail: `Listado maestro «${fileName}»: ${ok.length} documento(s) cargado(s) como pendientes de archivo y ${validation.summary.errors} fila(s) con error.`,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return { idImport: imp.id_master_list_import, ...validation, rowsSha256, created };
  }, TX_OPTS);
}

/** Historial de importaciones de la empresa (las más recientes primero). */
export async function listMasterListImports(db: SgcDb, idCompany: number) {
  const rows = await db.sgcMasterListImport.findMany({ where: { id_company: idCompany }, orderBy: { id_master_list_import: 'desc' }, take: 50 });
  return rows.map((r) => ({
    id: r.id_master_list_import,
    fileName: r.file_name,
    rowsSha256: r.rows_sha256,
    total: r.rows_total,
    loaded: r.rows_loaded,
    errors: r.rows_error,
    importedBy: r.imported_by,
    importedAt: r.imported_at.toISOString(),
  }));
}

/** Filas de una importación (para revisar qué se cargó y qué no). */
export async function getMasterListImportRows(db: SgcDb, idCompany: number, idImport: number) {
  const imp = await db.sgcMasterListImport.findFirst({ where: { id_master_list_import: idImport, id_company: idCompany }, include: { rows: { orderBy: { row_number: 'asc' } } } });
  if (!imp) throw new SgcError('Importación no encontrada.', 404);
  return imp.rows.map((r) => ({
    rowNumber: r.row_number,
    code: r.code,
    title: r.title,
    documentTypeCode: r.document_type_code,
    processCode: r.process_code,
    versionNumber: r.version_number,
    effectiveDate: r.effective_date ? r.effective_date.toISOString().slice(0, 10) : null,
    parentCode: r.parent_code,
    status: r.status,
    errors: r.errors,
    warnings: r.warnings,
    idDocument: r.id_document,
  }));
}
