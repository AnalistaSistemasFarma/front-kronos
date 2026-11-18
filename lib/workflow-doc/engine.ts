import sql from 'mssql';
import sqlConfig from '../../dbconfig.js';
import { prisma } from '../prisma';
import { useGetMicrosoftToken as getMicrosoftToken } from '../../components/microsoft-365/useGetMicrosoftToken';
import { oneDriveRoot } from '../onedrive/root';
import {
  convertOneDriveItemToPdf,
  ensureOneDriveFolderPath,
  listOneDriveFolderFileNames,
  uniqueOneDriveFileName,
  uploadFileToOneDriveFolder,
} from '../onedrive/graphFolderUpload';
import { sanitizeOneDriveName } from '../onedriveName';
import { downloadSgcFile, sgcOfficeConverter } from '../sgc/onedrive';
import { htmlToPdf, wrapDraftForPdf } from '../sgc/pdf/render';
import { sanitizeDraftHtml } from '../sgc/draft/html';
import { sha256Hex } from '../sgc/storage';
import { advanceSequentialTask } from '../workflow/advanceSequentialTask.js';
import { closeRequestGeneral } from '../workflow/closeRequestGeneral.js';
import { orionInternalTaskSql } from '../orion/internalTasks';
import { finishStep, startStep, type TriggeredBy } from '../workflow-sap/executionLog';
import { buildFileName, buildMarkerCatalog, resolveMarkerValues, type DocFormValue } from './fields';
import { fillHtml } from './fillHtml';
import { fillDocx } from './fillDocx';

/**
 * Motor de las tareas «Plantilla de documento» (task_kind = 'doc_template').
 *
 * Genera el documento llenando la plantilla con los valores del formulario de la solicitud,
 * lo sube a los adjuntos de la solicitud (TEC/SG/Request-<id>), lo registra como versión en
 * dbo.request_generated_document, deja una nota y una línea en el historial del flujo.
 *
 * Modo «auto» (runDocTemplates): igual que el motor de Tareas SAP (lib/workflow-sap/engine.ts):
 * toma atómica «[doc:generando]», cierra la tarea (id_status 2) y avanza el flujo; si falla,
 * la tarea queda pendiente con «[doc:error] …» para reintentar. Nunca lanza.
 * Modo «revisar»: la tarea es de una persona; emite desde la vista de la tarea (emitDocument).
 */

const RUNNING = '[doc:generando]';
const ERROR_PREFIX = '[doc:error]';
const MAX_ROUNDS = 5;
export const DOC_TEMPLATES_FOLDER = 'PLANTILLAS-FLUJOS';
export const OUTDATED_SGC_MESSAGE = 'Plantilla desactualizada: el documento del SGC cambió de versión, revise la configuración.';
export const NOT_VIGENTE_SGC_MESSAGE = 'Plantilla desactualizada: el documento del SGC ya no está vigente, revise la configuración.';

export class DocTemplateError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

export interface DocTemplateConfig {
  id: number;
  id_task: number;
  engine: 'editor' | 'word';
  source: 'upload' | 'sgc';
  id_sgc_document: number | null;
  id_sgc_version: number | null;
  source_item_id: string | null;
  source_file_name: string | null;
  template_html: string | null;
  fields_json: string | null;
  output: 'pdf' | 'pdf_docx';
  mode: 'auto' | 'revisar';
  file_name_pattern: string | null;
  active: boolean;
  updated_by: string | null;
  updated_at: Date | null;
}

async function pool() {
  return sql.connect(sqlConfig);
}

export async function getDocTemplateConfig(idTask: number): Promise<DocTemplateConfig | null> {
  const p = await pool();
  const r = await p.request().input('t', sql.Int, idTask).query<DocTemplateConfig>(`
    SELECT id, id_task, engine, source, id_sgc_document, id_sgc_version, source_item_id, source_file_name,
           template_html, fields_json, output, mode, file_name_pattern, active, updated_by, updated_at
    FROM dbo.task_doc_template WHERE id_task = @t;`);
  return r.recordset[0] ?? null;
}

/** Campos activos del proceso con su valor en la solicitud (misma consulta que request-form-values). */
export async function loadFormValues(idRequest: number): Promise<DocFormValue[]> {
  const p = await pool();
  const r = await p.request().input('idRequest', sql.Int, idRequest).query<DocFormValue>(`
    SELECT pff.id AS id_form_field, pff.field_label, pff.field_type, pff.config_json,
           rfv.id_option, o.option_label, rfv.value_text
    FROM process_category_request_general pcr
    INNER JOIN process_form_field pff
      ON pff.id_process_category = pcr.id_process_category AND pff.active = 1
    LEFT JOIN request_form_value rfv
      ON rfv.id_form_field = pff.id AND rfv.id_request_general = pcr.id_request_general
    LEFT JOIN process_form_field_option o ON o.id = rfv.id_option
    WHERE pcr.id_request_general = @idRequest
    ORDER BY pff.display_order, pff.id;`);
  return r.recordset;
}

/** Campos activos de un proceso (para el catálogo de marcas al configurar). */
export async function loadProcessFields(idProcessCategory: number) {
  const p = await pool();
  const r = await p.request().input('p', sql.Int, idProcessCategory).query<{ id_form_field: number; field_label: string; field_type: string }>(`
    SELECT id AS id_form_field, field_label, field_type
    FROM process_form_field WHERE id_process_category = @p AND active = 1
    ORDER BY display_order, id;`);
  return r.recordset;
}

interface RequestInfo {
  id: number;
  created_at: Date | null;
  requester: string | null;
  company: string | null;
  id_company: number | null;
  subject_request: string | null;
  note_author: string | null;
}

async function loadRequestInfo(idRequest: number): Promise<RequestInfo | null> {
  const p = await pool();
  const r = await p.request().input('id', sql.Int, idRequest).query<RequestInfo>(`
    SELECT TOP 1 rg.id, rg.created_at, urq.name AS requester, c.company, rg.id_company, rg.subject_request,
           COALESCE(upcrg.id_user, rg.id_requester) AS note_author
    FROM requests_general rg
    LEFT JOIN company c ON c.id_company = rg.id_company
    LEFT JOIN [user] urq ON urq.id = rg.id_requester
    LEFT JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
    LEFT JOIN user_process_category_request_general upcrg ON upcrg.id_process_category = pcrg.id_process_category
    WHERE rg.id = @id;`);
  return r.recordset[0] ?? null;
}

async function assigneeName(idTaskRequest: number | null): Promise<string | null> {
  if (!idTaskRequest) return null;
  const p = await pool();
  const r = await p.request().input('id', sql.Int, idTaskRequest).query<{ name: string | null }>(`
    SELECT u.name FROM task_request_general trg LEFT JOIN [user] u ON u.id = trg.id_assigned WHERE trg.id = @id;`);
  return r.recordset[0]?.name ?? null;
}

/**
 * Comprueba que el origen SGC siga VIGENTE y en la misma versión con la que se configuró.
 * Devuelve la etiqueta del origen («FO-JUR-003 v2 (SGC)»).
 */
export async function checkSgcSource(cfg: Pick<DocTemplateConfig, 'source' | 'id_sgc_document' | 'id_sgc_version' | 'source_file_name'>): Promise<string> {
  if (cfg.source !== 'sgc') return `Word subido: ${cfg.source_file_name ?? 'plantilla'}`;
  if (!cfg.id_sgc_document) throw new DocTemplateError('La plantilla no tiene documento del SGC configurado.');
  const doc = await prisma.sgcDocument.findUnique({
    where: { id_document: cfg.id_sgc_document },
    select: { code: true, status: true, current_version_id: true },
  });
  if (!doc || doc.status !== 'vigente' || !doc.current_version_id) throw new DocTemplateError(NOT_VIGENTE_SGC_MESSAGE, 409);
  if (doc.current_version_id !== cfg.id_sgc_version) throw new DocTemplateError(OUTDATED_SGC_MESSAGE, 409);
  const v = await prisma.sgcDocumentVersion.findUnique({ where: { id_document_version: doc.current_version_id }, select: { version_number: true } });
  return `${doc.code} v${v?.version_number ?? '?'} (SGC)`;
}

async function graphToken(): Promise<string> {
  const t = await getMicrosoftToken();
  if (!t) throw new DocTemplateError('No se pudo obtener el token de OneDrive.', 502);
  return t;
}

/** Sube un archivo a la carpeta de adjuntos de la solicitud (igual que upload-attachments). */
async function uploadToRequest(token: string, idRequest: number, fileName: string, bytes: Uint8Array, contentType: string) {
  const segments = [oneDriveRoot(), 'TEC', 'SG', `Request-${idRequest}`];
  const folderId = await ensureOneDriveFolderPath(token, segments);
  const existing = await listOneDriveFolderFileNames(token, segments);
  const name = uniqueOneDriveFileName(sanitizeOneDriveName(fileName) || fileName, existing);
  const item = await uploadFileToOneDriveFolder(token, folderId, name, new Blob([bytes as BlobPart]), contentType, 'rename');
  return { id: String(item.id), name: String(item.name || name) };
}

export interface RenderedDocument {
  fileBase: string;
  html: string | null;
  docx: Uint8Array | null;
  unknown: string[];
  sourceLabel: string;
}

/**
 * Llena la plantilla con los valores de la solicitud. `editedHtml` (motor editor, modo revisar):
 * el HTML ya llenado y ajustado por el responsable; se sanea y se respetan sus cambios.
 */
export async function renderDocument(cfg: DocTemplateConfig, idRequest: number, idTaskRequest: number | null, editedHtml?: string | null): Promise<RenderedDocument> {
  const info = await loadRequestInfo(idRequest);
  if (!info) throw new DocTemplateError('Solicitud no encontrada.', 404);
  const sourceLabel = await checkSgcSource(cfg);
  const fields = await loadFormValues(idRequest);
  const catalog = buildMarkerCatalog(fields);
  const values = resolveMarkerValues(fields, {
    idRequest,
    requestDate: info.created_at,
    requester: info.requester,
    company: info.company,
    assignee: await assigneeName(idTaskRequest),
    generatedAt: new Date(),
  });
  const fileBase = buildFileName(cfg.file_name_pattern, `Documento solicitud ${idRequest}`, catalog, values);

  if (cfg.engine === 'editor') {
    const base = editedHtml != null ? editedHtml : cfg.template_html;
    if (!base || !base.trim()) throw new DocTemplateError('La plantilla no tiene contenido.');
    const r = fillHtml(base, values);
    return { fileBase, html: sanitizeDraftHtml(r.html), docx: null, unknown: r.unknown, sourceLabel };
  }

  if (!cfg.source_item_id) throw new DocTemplateError('La plantilla no tiene el Word de origen.');
  const bytes = await downloadSgcFile(cfg.source_item_id);
  const r = fillDocx(bytes, catalog, values);
  return { fileBase, html: null, docx: r.bytes, unknown: r.unknown, sourceLabel };
}

export interface EmitParams {
  idRequest: number;
  idTask: number;
  idTaskRequest: number | null;
  actorEmail: string | null;
  actorUserId: string | null;
  triggeredBy: TriggeredBy;
  editedHtml?: string | null;
}

export interface EmittedDocument {
  id: number;
  version: number;
  fileName: string;
  pdfItemId: string;
  docxItemId: string | null;
  unknown: string[];
}

async function insertNote(idRequest: number, note: string, author: string | null): Promise<void> {
  if (!author) return;
  try {
    const p = await pool();
    await p
      .request()
      .input('note', sql.Text, note)
      .input('id_request', sql.Int, idRequest)
      .input('created_by', sql.NVarChar, author)
      .query(`INSERT INTO notes (note, id_request, created_by) VALUES (@note, @id_request, @created_by)`);
  } catch (e) {
    // El documento ya quedó emitido: no se falla por la nota.
    console.error('[workflow-doc] no se pudo dejar la nota de la solicitud', idRequest, e);
  }
}

/** Genera, sube y registra una versión del documento. Lanza DocTemplateError si no se puede. */
export async function emitDocument(params: EmitParams): Promise<EmittedDocument> {
  const cfg = await getDocTemplateConfig(params.idTask);
  if (!cfg || !cfg.active) throw new DocTemplateError('La tarea no tiene plantilla de documento configurada.');
  const rendered = await renderDocument(cfg, params.idRequest, params.idTaskRequest, cfg.engine === 'editor' ? params.editedHtml : null);
  const token = await graphToken();

  let pdf: Uint8Array;
  let docxItemId: string | null = null;
  let fileName = `${rendered.fileBase}.pdf`;
  if (rendered.html != null) {
    pdf = await htmlToPdf(wrapDraftForPdf({ title: rendered.fileBase, code: '', contentHtml: rendered.html }));
  } else {
    const docx = rendered.docx!;
    if (cfg.output === 'pdf_docx') {
      const up = await uploadToRequest(token, params.idRequest, `${rendered.fileBase}.docx`, docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      docxItemId = up.id;
      pdf = new Uint8Array(await convertOneDriveItemToPdf(token, up.id));
    } else {
      pdf = await sgcOfficeConverter.bytes(`${oneDriveRoot()}/TEC/${DOC_TEMPLATES_FOLDER}`, `${rendered.fileBase}.docx`, docx);
    }
  }
  const pdfUp = await uploadToRequest(token, params.idRequest, fileName, pdf, 'application/pdf');
  fileName = pdfUp.name;

  const p = await pool();
  const ins = await p
    .request()
    .input('req', sql.Int, params.idRequest)
    .input('taskReq', sql.Int, params.idTaskRequest)
    .input('task', sql.Int, params.idTask)
    .input('file', sql.NVarChar(260), fileName.slice(0, 260))
    .input('pdf', sql.NVarChar(200), pdfUp.id)
    .input('docx', sql.NVarChar(200), docxItemId)
    .input('html', sql.NVarChar(sql.MAX), rendered.html)
    .input('sha', sql.NVarChar(64), sha256Hex(pdf))
    .input('label', sql.NVarChar(400), rendered.sourceLabel.slice(0, 400))
    .input('by', sql.NVarChar(200), params.actorEmail ?? 'sistema').query<{ id: number; version: number }>(`
      DECLARE @v INT = (SELECT ISNULL(MAX(version), 0) + 1 FROM dbo.request_generated_document WITH (UPDLOCK, HOLDLOCK)
                        WHERE id_request_general = @req AND id_task = @task);
      INSERT INTO dbo.request_generated_document
        (id_request_general, id_task_request, id_task, version, file_name, pdf_item_id, docx_item_id, html_snapshot,
         pdf_sha256, source_label, status, generated_by)
      OUTPUT INSERTED.id, INSERTED.version
      VALUES (@req, @taskReq, @task, @v, @file, @pdf, @docx, @html, @sha, @label, N'emitido', @by);`);
  const row = ins.recordset[0];

  const info = await loadRequestInfo(params.idRequest);
  const missing = rendered.unknown.length ? ` Marcas sin campo (quedaron vacías): ${rendered.unknown.join(', ')}.` : '';
  await insertNote(
    params.idRequest,
    `Documento generado «${fileName}» (versión ${row.version}) desde la plantilla ${rendered.sourceLabel}.${missing}`,
    params.actorUserId ?? info?.note_author ?? null
  );
  const step = await startStep({
    idRequest: params.idRequest,
    idTaskRequest: params.idTaskRequest,
    idTask: params.idTask,
    stepKind: 'system',
    stepName: `Documento generado v${row.version}: ${fileName}`,
    actionKey: 'doc_template.emit',
    triggerEvent: 'on_execute',
    triggeredBy: params.triggeredBy,
    idUser: params.actorUserId,
  });
  await finishStep(step, { status: 'ok', responseSummary: { file: fileName, version: row.version, unknown: rendered.unknown } });

  return { id: row.id, version: row.version, fileName, pdfItemId: pdfUp.id, docxItemId, unknown: rendered.unknown };
}

export interface GeneratedDocumentRow {
  id: number;
  id_task: number;
  id_task_request: number | null;
  version: number;
  file_name: string;
  pdf_item_id: string | null;
  docx_item_id: string | null;
  source_label: string | null;
  status: string;
  generated_by: string | null;
  generated_at: Date;
  has_html: number;
}

export async function listGeneratedDocuments(idRequest: number): Promise<GeneratedDocumentRow[]> {
  const p = await pool();
  const r = await p.request().input('req', sql.Int, idRequest).query<GeneratedDocumentRow>(`
    SELECT id, id_task, id_task_request, version, file_name, pdf_item_id, docx_item_id, source_label, status,
           generated_by, generated_at, CASE WHEN html_snapshot IS NULL THEN 0 ELSE 1 END AS has_html
    FROM dbo.request_generated_document
    WHERE id_request_general = @req
    ORDER BY id_task, version DESC;`);
  return r.recordset;
}

// ---------------------------------------------------------------------------
// Modo automático
// ---------------------------------------------------------------------------

interface PendingDocTask {
  id: number;
  id_task: number;
  task: string;
  display_order: number | null;
  id_process_category: number;
  subject_request: string | null;
  closes_request: boolean | number | null;
}

async function pendingAutoTasks(idRequest: number): Promise<PendingDocTask[]> {
  const p = await pool();
  const r = await p.request().input('req', sql.Int, idRequest).query<PendingDocTask>(`
    SELECT trg.id, trg.id_task, tpc.task, tpc.display_order, tpc.id_process_category, rg.subject_request, tpc.closes_request
    FROM task_request_general trg
    INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
    INNER JOIN requests_general rg ON rg.id = trg.id_request_general
    LEFT JOIN dbo.task_doc_template d ON d.id_task = tpc.id
    WHERE trg.id_request_general = @req AND trg.id_status = 4 AND tpc.task_kind = N'doc_template'
      AND ISNULL(d.mode, N'auto') = N'auto'
    ORDER BY tpc.display_order, trg.id;`);
  return r.recordset;
}

async function claim(idTaskRequest: number): Promise<boolean> {
  const p = await pool();
  const r = await p
    .request()
    .input('id', sql.Int, idTaskRequest)
    .input('running', sql.NVarChar(50), RUNNING)
    // En LIKE el «[» es comodín: se escapa (mismo arreglo que el motor de Tareas SAP).
    .input('err', sql.NVarChar(50), `${ERROR_PREFIX.replace('[', '[[]')}%`).query(`
      UPDATE task_request_general SET resolution = @running
      WHERE id = @id AND id_status = 4 AND (resolution IS NULL OR resolution = N'' OR resolution LIKE @err);`);
  return (r.rowsAffected[0] ?? 0) === 1;
}

async function release(idTaskRequest: number, resolution: string | null): Promise<void> {
  const p = await pool();
  await p
    .request()
    .input('id', sql.Int, idTaskRequest)
    .input('res', sql.NVarChar(sql.MAX), resolution)
    .query(`UPDATE task_request_general SET resolution = @res WHERE id = @id AND id_status = 4;`);
}

/** Cierra la tarea y avanza el flujo como una tarea humana (igual que el motor de Tareas SAP). */
async function complete(task: PendingDocTask, idRequest: number, resolution: string): Promise<void> {
  const p = await pool();
  await p
    .request()
    .input('id', sql.Int, task.id)
    .input('res', sql.NVarChar(sql.MAX), resolution)
    .query(`UPDATE task_request_general
            SET id_status = 2, resolution = @res, date_resolution = GETDATE(),
                start_date = COALESCE(start_date, GETDATE()), end_date = GETDATE()
            WHERE id = @id AND id_status = 4;`);
  await advanceSequentialTask(p, {
    id_request_general: idRequest,
    id_task: task.id_task,
    id_process_category: task.id_process_category,
    display_order: task.display_order,
    subject_request: task.subject_request,
  });
  if (task.closes_request) {
    const open = await p.request().input('req', sql.Int, idRequest).query(`
      SELECT COUNT(*) AS n
      FROM task_request_general trg
      INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
      WHERE trg.id_request_general = @req AND trg.id_status NOT IN (2, 3)
        AND NOT ${orionInternalTaskSql('trg', 'tpc')};`);
    if (Number(open.recordset[0]?.n ?? 0) === 0) {
      await closeRequestGeneral(p, {
        requestId: idRequest,
        closedByUserId: null,
        resolution: `Cerrada automáticamente al generar el documento de la tarea «${task.task}».`,
      });
    }
  }
}

async function markError(idRequest: number, task: PendingDocTask, error: string, triggeredBy: TriggeredBy): Promise<void> {
  const id = await startStep({
    idRequest,
    idTaskRequest: task.id,
    idTask: task.id_task,
    stepKind: 'system',
    stepName: `Tarea «${task.task}» quedó en error`,
    actionKey: 'doc_template.emit',
    triggerEvent: 'on_execute',
    triggeredBy,
  });
  await finishStep(id, { status: 'error', error });
  await release(task.id, `${ERROR_PREFIX} ${error}`.slice(0, 1000));
}

/**
 * Genera los documentos de las tareas «Plantilla de documento» en modo automático que
 * estén pendientes en la solicitud; repite mientras una tarea cerrada abra la siguiente.
 */
export async function runDocTemplates(
  idRequest: number | null | undefined,
  triggeredBy: TriggeredBy = 'server'
): Promise<{ generated: number; errors: number }> {
  const result = { generated: 0, errors: 0 };
  if (!idRequest) return result;
  const req = Number(idRequest);
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const pending = await pendingAutoTasks(req);
      if (pending.length === 0) break;
      let progressed = false;
      for (const task of pending) {
        if (!(await claim(task.id))) continue;
        try {
          const doc = await emitDocument({ idRequest: req, idTask: task.id_task, idTaskRequest: task.id, actorEmail: null, actorUserId: null, triggeredBy });
          await complete(task, req, `Documento generado automáticamente: ${doc.fileName} (versión ${doc.version}).`);
          result.generated++;
          progressed = true;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[workflow-doc] error generando el documento de la tarea ${task.id} (solicitud ${req}):`, e);
          await markError(req, task, msg, triggeredBy).catch((err) => console.error('[workflow-doc] markError', err));
          result.errors++;
        }
      }
      if (!progressed) break;
    }
  } catch (e) {
    console.error(`[workflow-doc] error ejecutando las plantillas de documento de la solicitud ${idRequest}:`, e);
    result.errors++;
  }
  // Si al cerrar una plantilla se abrió una Tarea SAP, la ejecuta su motor (como tras una tarea humana).
  if (result.generated > 0) {
    void import('../workflow-sap/engine')
      .then((m) => m.runSapExecutors(req, triggeredBy))
      .catch((e) => console.error('[workflow-doc] tareas SAP siguientes', e));
  }
  return result;
}
