import { NextRequest, NextResponse } from 'next/server';
import { canManageWorkflows, taskProcessOf } from '../../../../lib/workflow-doc/access';
import { loadProcessFields } from '../../../../lib/workflow-doc/engine';
import { buildMarkerCatalog } from '../../../../lib/workflow-doc/fields';
import { downloadSource, listSgcVigentes, prepareSource, sgcVigenteSource } from '../../../../lib/workflow-doc/sources';
import { NO_STORE, fail, sessionEmail } from '../_shared';

/**
 * Documentos VIGENTES del SGC de las empresas del flujo como origen de la plantilla.
 * GET ?id_task=N                        -> lista (codificados y no codificados).
 * POST { id_task, id_document, engine } -> toma la versión vigente: HTML (editor) o marcas (word).
 */

async function guard(idTask: number) {
  const email = await sessionEmail();
  if (!email) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!(await canManageWorkflows(email))) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  const task = await taskProcessOf(idTask);
  if (!task) return { error: NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 }) };
  return { task };
}

export async function GET(request: NextRequest) {
  try {
    const g = await guard(Number(new URL(request.url).searchParams.get('id_task')));
    if ('error' in g) return g.error;
    return NextResponse.json({ documents: await listSgcVigentes(g.task.companies) }, { headers: NO_STORE });
  } catch (e) {
    return fail(e, 'sgc-sources');
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const g = await guard(Number(body?.id_task));
    if ('error' in g) return g.error;
    const engine = body.engine === 'word' ? 'word' : 'editor';
    const s = await sgcVigenteSource(Number(body.id_document), g.task.companies);
    const markers = buildMarkerCatalog(await loadProcessFields(g.task.id_process_category));
    const prepared = await prepareSource(await downloadSource(s.version.source_item_id!), s.format, engine, markers);
    return NextResponse.json({
      ok: true,
      id_sgc_document: s.doc.id_document,
      id_sgc_version: s.version.id_document_version,
      source_item_id: s.version.source_item_id,
      source_file_name: s.version.source_file_name,
      label: `${s.doc.code} v${s.version.version_number} — ${s.doc.title}`,
      ...prepared,
    });
  } catch (e) {
    return fail(e, 'sgc-sources');
  }
}
