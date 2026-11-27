import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { sql, withMssqlPool } from '../../../../lib/mssqlPool';
import { flowEditDecision, logFlowChange, requireFlowEditor } from '../../../../lib/workflow/flowAccess';

export const dynamic = 'force-dynamic';

/**
 * Tasks with a linked flow (2026-11-26).
 * GET ?id=ID → { canEdit, tasks[{ id, task, linkedProcess, linkedMultiple }] }
 * PUT { id, tasks[{ id, linkedMultiple }] } → «Permitir varias solicitudes vinculadas» per task.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ? String(session.user.email) : null;
  if (!email) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Flujo no válido' }, { status: 400 });
  try {
    const d = await flowEditDecision(email, id);
    if (!d.flags) return NextResponse.json({ error: 'Flujo no encontrado' }, { status: 404 });
    const tasks = await withMssqlPool(async (pool) => {
      const r = await pool.request().input('p', sql.Int, id).query<{ id: number; task: string; linked_process: string | null; linked_multiple: boolean }>(`
        SELECT t.id, t.task, lp.process AS linked_process, t.linked_multiple
        FROM task_process_category t LEFT JOIN process_category lp ON lp.id = t.id_linked_process
        WHERE t.id_process_category = @p AND t.active = 1 AND t.id_linked_process IS NOT NULL
        ORDER BY t.display_order, t.id`);
      return r.recordset.map((x) => ({ id: x.id, task: x.task, linkedProcess: x.linked_process, linkedMultiple: Boolean(x.linked_multiple) }));
    });
    return NextResponse.json({ canEdit: d.canEdit, tasks }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('Error linked-tasks GET:', e);
    return NextResponse.json({ error: 'No se pudieron consultar las tareas vinculadas' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => null)) as { id?: unknown; tasks?: { id?: unknown; linkedMultiple?: unknown }[] } | null;
  const id = Number(body?.id);
  const guard = await requireFlowEditor(id);
  if (guard instanceof Response) return guard;
  const tasks = (Array.isArray(body?.tasks) ? body!.tasks : []).map((t) => ({ id: Number(t.id), on: t.linkedMultiple === true })).filter((t) => Number.isInteger(t.id));
  try {
    const changed = await withMssqlPool(async (pool) => {
      let n = 0;
      for (const t of tasks) {
        const r = await pool
          .request()
          .input('t', sql.Int, t.id)
          .input('p', sql.Int, id)
          .input('on', sql.Bit, t.on ? 1 : 0)
          .query('UPDATE task_process_category SET linked_multiple = @on WHERE id = @t AND id_process_category = @p AND id_linked_process IS NOT NULL AND linked_multiple <> @on');
        n += r.rowsAffected[0] ?? 0;
      }
      return n;
    });
    if (changed) await logFlowChange(id, guard.email, 'flujo vinculado', `${changed} tarea(s): varias solicitudes vinculadas ${tasks.filter((t) => t.on).length ? 'activado' : 'ajustado'}.`);
    return NextResponse.json({ ok: true, changed });
  } catch (e) {
    console.error('Error linked-tasks PUT:', e);
    return NextResponse.json({ error: 'No se pudo guardar' }, { status: 500 });
  }
}
