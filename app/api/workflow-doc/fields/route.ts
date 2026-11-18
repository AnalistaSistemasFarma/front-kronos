import { NextRequest, NextResponse } from 'next/server';
import { canManageWorkflows, taskProcessOf } from '../../../../lib/workflow-doc/access';
import { loadProcessFields } from '../../../../lib/workflow-doc/engine';
import { buildMarkerCatalog, wordTag } from '../../../../lib/workflow-doc/fields';
import { NO_STORE, fail, sessionEmail } from '../_shared';

/** GET ?id_task=N -> marcas disponibles para «@» (campos activos del proceso + variables del sistema). */
export async function GET(request: NextRequest) {
  try {
    const email = await sessionEmail();
    if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!(await canManageWorkflows(email))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const task = await taskProcessOf(Number(new URL(request.url).searchParams.get('id_task')));
    if (!task) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 });
    const markers = buildMarkerCatalog(await loadProcessFields(task.id_process_category));
    return NextResponse.json({ markers: markers.map((m) => ({ ...m, wordTag: wordTag(m.label) })) }, { headers: NO_STORE });
  } catch (e) {
    return fail(e, 'fields');
  }
}
