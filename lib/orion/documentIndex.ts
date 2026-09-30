import 'server-only';
import sql from 'mssql';
import { ORION_SIGNATURE_FIELD_TYPE } from './fieldType';
import { parseOrionSignatureBagBag } from './formValue';
import { isMissingTableError } from './documentEvents';
import type { OrionSignatureState } from './types';
import { resolveOrionVersionLabel } from './versionLabel';

type SqlPool = import('mssql').ConnectionPool;

let indexTableMissing = false;
/** Evita reescribir la fila cuando el bag se guarda sin cambios relevantes (polling). */
const lastIndexedSignature = new Map<string, string>();

function isIndexable(doc: OrionSignatureState): boolean {
  return Boolean(doc.orionDocumentId || doc.signatureIntent === 'sign' || doc.review);
}

function indexSignature(doc: OrionSignatureState): string {
  return [
    doc.orionDocumentId ?? '',
    doc.status ?? '',
    doc.review?.status ?? '',
    doc.versionLabel ?? '',
    doc.fileName ?? '',
    doc.signedAt ?? '',
  ].join('|');
}

function toDateOrNull(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function upsertOrionDocumentIndexRow(
  pool: SqlPool,
  requestId: number,
  fileId: string,
  doc: OrionSignatureState
): Promise<void> {
  await pool
    .request()
    .input('id_request', sql.Int, requestId)
    .input('file_id', sql.NVarChar(400), fileId)
    .input('file_name', sql.NVarChar(500), doc.fileName ?? null)
    .input('orion_document_id', sql.NVarChar(200), doc.orionDocumentId ?? null)
    .input('version_label', sql.NVarChar(20), resolveOrionVersionLabel(doc.versionLabel))
    .input('status', sql.NVarChar(40), doc.status ? String(doc.status).toUpperCase() : null)
    .input('review_status', sql.NVarChar(40), doc.review?.status ?? null)
    .input('signed_at', sql.DateTime2, toDateOrNull(doc.signedAt))
    .query(`
      DECLARE @id_company INT, @company NVARCHAR(400), @department NVARCHAR(400),
              @category NVARCHAR(400), @process NVARCHAR(400), @subject NVARCHAR(1000);

      SELECT TOP 1
        @id_company = rg.id_company,
        @company = c.company,
        @category = cr.category,
        @process = pc.process,
        @subject = LEFT(rg.subject_request, 1000),
        @department = (
          SELECT TOP 1 d.department
          FROM department_user du
          INNER JOIN department d ON d.id_department = du.id_department
          WHERE du.id_user = rg.id_requester
          ORDER BY du.id
        )
      FROM requests_general rg
      LEFT JOIN process_category_request_general pcr ON pcr.id_request_general = rg.id
      LEFT JOIN process_category pc ON pc.id = pcr.id_process_category
      LEFT JOIN category_request cr ON cr.id = pc.id_category_request
      LEFT JOIN company c ON c.id_company = rg.id_company
      WHERE rg.id = @id_request;

      MERGE orion_document_index AS t
      USING (SELECT @id_request AS id_request, @file_id AS file_id) AS s
        ON t.id_request = s.id_request AND t.file_id = s.file_id
      WHEN MATCHED THEN UPDATE SET
        file_name = @file_name,
        orion_document_id = @orion_document_id,
        version_label = @version_label,
        status = @status,
        review_status = @review_status,
        id_company = @id_company,
        company_name = @company,
        department_name = @department,
        category_name = @category,
        process_name = @process,
        subject_request = @subject,
        signed_at = @signed_at,
        updated_at = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT
        (id_request, file_id, file_name, orion_document_id, version_label, status, review_status,
         id_company, company_name, department_name, category_name, process_name, subject_request, signed_at)
      VALUES
        (@id_request, @file_id, @file_name, @orion_document_id, @version_label, @status, @review_status,
         @id_company, @company, @department, @category, @process, @subject, @signed_at);
    `);
}

/** No bloquea el guardado del bag: el índice es solo para listar/filtrar. */
export function indexOrionDocumentsInBackground(
  pool: SqlPool,
  requestId: number,
  documents: Record<string, OrionSignatureState>
): void {
  if (indexTableMissing || !Number.isInteger(requestId) || requestId <= 0) return;
  void (async () => {
    for (const [fileId, doc] of Object.entries(documents)) {
      if (!doc || !isIndexable(doc)) continue;
      const key = `${requestId}:${fileId}`;
      const signature = indexSignature(doc);
      if (lastIndexedSignature.get(key) === signature) continue;
      await upsertOrionDocumentIndexRow(pool, requestId, fileId, doc);
      lastIndexedSignature.set(key, signature);
    }
  })().catch((err) => {
    if (isMissingTableError(err)) {
      indexTableMissing = true;
      return;
    }
    console.warn('[orion/documentIndex] No se pudo indexar la solicitud', requestId, err);
  });
}

/** Reconstruye el índice desde todos los bags orion_signature (solicitudes previas a la tabla). */
export async function reindexAllOrionDocuments(pool: SqlPool): Promise<{ requests: number; documents: number }> {
  const result = await pool
    .request()
    .input('fieldType', sql.NVarChar(30), ORION_SIGNATURE_FIELD_TYPE)
    .query(`
      SELECT rfv.id_request_general, rfv.value_text
      FROM request_form_value rfv
      INNER JOIN process_form_field pff ON pff.id = rfv.id_form_field
      WHERE pff.field_type = @fieldType AND rfv.value_text IS NOT NULL
    `);
  let requests = 0;
  let documents = 0;
  for (const row of result.recordset as Array<{ id_request_general: number; value_text: string }>) {
    const bag = parseOrionSignatureBagBag(row.value_text);
    let touched = false;
    for (const [fileId, doc] of Object.entries(bag.documents)) {
      if (!doc || !isIndexable(doc)) continue;
      await upsertOrionDocumentIndexRow(pool, Number(row.id_request_general), fileId, doc);
      lastIndexedSignature.set(`${row.id_request_general}:${fileId}`, indexSignature(doc));
      documents += 1;
      touched = true;
    }
    if (touched) requests += 1;
  }
  indexTableMissing = false;
  return { requests, documents };
}
