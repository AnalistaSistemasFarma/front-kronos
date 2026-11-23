import sql from 'mssql';
import { NextRequest, NextResponse } from 'next/server';
import sqlConfig from '../../../../dbconfig.js';
import { canManageWorkflows, taskProcessOf } from '../../../../lib/workflow-doc/access';
import { DocTemplateError, getDocTemplateConfig, loadProcessFields } from '../../../../lib/workflow-doc/engine';
import { buildMarkerCatalog, unresolvedHtmlMarkers } from '../../../../lib/workflow-doc/fields';
import { mentionsToTokens } from '../../../../lib/workflow-doc/fillHtml';
import { sgcVigenteSource } from '../../../../lib/workflow-doc/sources';
import { getDraftHtmlError, sanitizeDraftHtml } from '../../../../lib/sgc/draft/html';
import { NO_STORE, fail, sessionEmail } from '../_shared';

/**
 * Configuración de la tarea «Plantilla de documento» (pantalla «Ver flujos»).
 * GET ?id_task=N  -> configuración, marcas disponibles (campos del proceso + sistema).
 * PUT { id_task, engine, source, mode, output, file_name_pattern, template_html?, source_item_id?,
 *       source_file_name?, id_sgc_document?, active? } -> crea o reemplaza la configuración.
 * Acceso: el mismo de la configuración SAP de los flujos.
 */

async function guard(idTask: number) {
  const email = await sessionEmail();
  if (!email) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!(await canManageWorkflows(email))) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  if (!Number.isInteger(idTask) || idTask <= 0) return { error: NextResponse.json({ error: 'Falta id_task' }, { status: 400 }) };
  const task = await taskProcessOf(idTask);
  if (!task) return { error: NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 }) };
  return { email, task };
}

export async function GET(request: NextRequest) {
  try {
    const g = await guard(Number(new URL(request.url).searchParams.get('id_task')));
    if ('error' in g) return g.error;
    const [config, fields] = await Promise.all([getDocTemplateConfig(g.task.id), loadProcessFields(g.task.id_process_category)]);
    return NextResponse.json({ task: { id: g.task.id, task: g.task.task, taskKind: g.task.task_kind, idProcess: g.task.id_process_category }, config, markers: buildMarkerCatalog(fields) }, { headers: NO_STORE });
  } catch (e) {
    return fail(e, 'task-template');
  }
}

const ENGINES = ['editor', 'word'];
const SOURCES = ['upload', 'sgc'];
const MODES = ['auto', 'revisar'];

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const g = await guard(Number(body?.id_task));
    if ('error' in g) return g.error;

    const engine = String(body.engine ?? '');
    const source = String(body.source ?? '');
    const mode = String(body.mode ?? 'auto');
    if (!ENGINES.includes(engine) || !SOURCES.includes(source) || !MODES.includes(mode)) throw new DocTemplateError('Motor, origen o modo no válidos.');
    // Motor editor: solo PDF.
    const output = engine === 'word' && body.output === 'pdf_docx' ? 'pdf_docx' : 'pdf';
    const pattern = String(body.file_name_pattern ?? '').trim().slice(0, 200) || null;

    let sourceItemId: string | null = body.source_item_id ? String(body.source_item_id).slice(0, 200) : null;
    let sourceFileName: string | null = body.source_file_name ? String(body.source_file_name).slice(0, 260) : null;
    let idSgcDocument: number | null = null;
    let idSgcVersion: number | null = null;
    if (source === 'sgc') {
      // Se toma SIEMPRE la versión vigente al guardar (así se actualiza la plantilla tras un cambio de versión).
      const s = await sgcVigenteSource(Number(body.id_sgc_document), g.task.companies);
      if (engine === 'word' && s.format !== 'docx') throw new DocTemplateError('El motor Word necesita que el vigente del SGC tenga su Word.');
      idSgcDocument = s.doc.id_document;
      idSgcVersion = s.version.id_document_version;
      sourceItemId = s.version.source_item_id;
      sourceFileName = s.version.source_file_name;
    }

    let templateHtml: string | null = null;
    const markers = buildMarkerCatalog(await loadProcessFields(g.task.id_process_category));
    if (engine === 'editor') {
      const raw = mentionsToTokens(String(body.template_html ?? ''));
      const err = getDraftHtmlError(raw);
      if (err) throw new DocTemplateError(err);
      templateHtml = sanitizeDraftHtml(raw);
      if (!templateHtml) throw new DocTemplateError('La plantilla está vacía.');
      const bad = unresolvedHtmlMarkers(templateHtml, markers);
      if (bad.length) throw new DocTemplateError(`La plantilla usa campos que ya no existen en el proceso: ${bad.join(', ')}.`);
    } else if (!sourceItemId) {
      throw new DocTemplateError('Suba el Word de la plantilla o elija un documento del SGC.');
    }

    const pool = await sql.connect(sqlConfig);
    await pool
      .request()
      .input('t', sql.Int, g.task.id)
      .input('engine', sql.NVarChar(10), engine)
      .input('source', sql.NVarChar(10), source)
      .input('doc', sql.Int, idSgcDocument)
      .input('ver', sql.Int, idSgcVersion)
      .input('item', sql.NVarChar(200), sourceItemId)
      .input('fname', sql.NVarChar(260), sourceFileName)
      .input('html', sql.NVarChar(sql.MAX), templateHtml)
      .input('output', sql.NVarChar(10), output)
      .input('mode', sql.NVarChar(10), mode)
      .input('pattern', sql.NVarChar(200), pattern)
      .input('active', sql.Bit, body.active === false ? 0 : 1)
      .input('by', sql.NVarChar(200), g.email).query(`
        MERGE dbo.task_doc_template WITH (HOLDLOCK) AS t
        USING (SELECT @t AS id_task) AS s ON t.id_task = s.id_task
        WHEN MATCHED THEN UPDATE SET engine = @engine, source = @source, id_sgc_document = @doc, id_sgc_version = @ver,
          source_item_id = @item, source_file_name = @fname, template_html = @html, output = @output, mode = @mode,
          file_name_pattern = @pattern, active = @active, updated_by = @by, updated_at = sysutcdatetime()
        WHEN NOT MATCHED THEN INSERT (id_task, engine, source, id_sgc_document, id_sgc_version, source_item_id,
          source_file_name, template_html, output, mode, file_name_pattern, active, updated_by)
          VALUES (@t, @engine, @source, @doc, @ver, @item, @fname, @html, @output, @mode, @pattern, @active, @by);
        UPDATE task_process_category SET task_kind = N'doc_template' WHERE id = @t AND ISNULL(is_authorization, 0) = 0;`);
    return NextResponse.json({ ok: true, config: await getDocTemplateConfig(g.task.id) });
  } catch (e) {
    return fail(e, 'task-template');
  }
}
