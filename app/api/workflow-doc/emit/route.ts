import { NextRequest, NextResponse } from 'next/server';
import { canEmitTask, docTaskOf, userIdOf } from '../../../../lib/workflow-doc/access';
import { DocTemplateError, emitDocument, getDocTemplateConfig, renderDocument } from '../../../../lib/workflow-doc/engine';
import { getDraftHtmlError } from '../../../../lib/sgc/draft/html';
import { fail, sessionEmail } from '../_shared';

/**
 * Emisión desde la vista de la tarea (modo «revisar», o reintento de una automática).
 * POST { id_task_request, action: 'preview' } -> motor editor: HTML ya lleno para ajustarlo en el editor.
 * POST { id_task_request, action: 'emit', html? } -> genera una versión nueva (v1, v2…). En motor editor
 *      acepta el HTML ajustado (se sanea con la lista blanca del SGC).
 * Acceso: responsable de la tarea, encargado del proceso o quien administra flujos.
 */
export async function POST(request: NextRequest) {
  try {
    const email = await sessionEmail();
    if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const task = await docTaskOf(Number(body?.id_task_request));
    if (!task) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 });
    if (!(await canEmitTask(email, task))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (Number(task.id_status) === 2 || Number(task.id_status) === 3) throw new DocTemplateError('La tarea ya está cerrada.', 409);

    const cfg = await getDocTemplateConfig(task.id_task);
    if (!cfg || !cfg.active) throw new DocTemplateError('La tarea no tiene plantilla de documento configurada.');

    if (body.action === 'preview') {
      if (cfg.engine !== 'editor') throw new DocTemplateError('La vista para editar solo aplica al motor editor.');
      const r = await renderDocument(cfg, task.id_request_general, task.id);
      return NextResponse.json({ html: r.html, unknown: r.unknown, fileBase: r.fileBase });
    }

    let html: string | null = null;
    if (cfg.engine === 'editor' && typeof body.html === 'string' && body.html.trim()) {
      const err = getDraftHtmlError(body.html);
      if (err) throw new DocTemplateError(err);
      html = body.html;
    }
    const doc = await emitDocument({
      idRequest: task.id_request_general,
      idTask: task.id_task,
      idTaskRequest: task.id,
      actorEmail: email,
      actorUserId: await userIdOf(email),
      triggeredBy: 'user',
      editedHtml: html,
    });
    return NextResponse.json({ ok: true, document: doc });
  } catch (e) {
    return fail(e, 'emit');
  }
}
