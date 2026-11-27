import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { sql, withMssqlPool } from '../../../../lib/mssqlPool';
import { canReadRequestDocuments } from '../../../../lib/workflow-doc/access';
import { notifyActivityReminder } from '../../../../lib/notificationEvents';

export const dynamic = 'force-dynamic';

/** One reminder per activity every 4 hours (per server instance; the bell already groups by tag). */
const REMINDER_GAP_MS = 4 * 60 * 60 * 1000;
const lastSent = new Map<number, number>();

/**
 * POST { taskId } — «Enviar recordatorio» al responsable de una actividad ABIERTA (2026-11-24).
 * Lo envían los participantes de la solicitud (solicitante, responsables, encargado del proceso) o quien administra flujos.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ? String(session.user.email) : null;
  if (!email) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { taskId?: unknown } | null;
  const taskId = Number(body?.taskId);
  if (!Number.isInteger(taskId) || taskId <= 0) return NextResponse.json({ error: 'Actividad no válida' }, { status: 400 });
  try {
    const t = await withMssqlPool(async (pool) => {
      const r = await pool.request().input('id', sql.Int, taskId).query<{
        id_request_general: number;
        id_assigned: string | null;
        id_status: number;
        task: string | null;
        subject_request: string | null;
        consecutive: string | null;
      }>(`
        SELECT trg.id_request_general, trg.id_assigned, trg.id_status, tpc.task, rg.subject_request, rg.consecutive
        FROM task_request_general trg
        INNER JOIN requests_general rg ON rg.id = trg.id_request_general
        LEFT JOIN task_process_category tpc ON tpc.id = trg.id_task
        WHERE trg.id = @id`);
      const me = await pool.request().input('e', sql.NVarChar(255), email).query<{ name: string | null }>('SELECT TOP 1 name FROM [user] WHERE email = @e');
      return r.recordset[0] ? { ...r.recordset[0], fromName: me.recordset[0]?.name ?? email } : null;
    });
    if (!t) return NextResponse.json({ error: 'Actividad no encontrada' }, { status: 404 });
    if ([2, 3].includes(Number(t.id_status))) return NextResponse.json({ error: 'La actividad ya no está abierta.' }, { status: 409 });
    if (!t.id_assigned) return NextResponse.json({ error: 'La actividad no tiene responsable a quien recordar.' }, { status: 409 });
    if (!(await canReadRequestDocuments(email, t.id_request_general))) return NextResponse.json({ error: 'Solo los participantes de la solicitud envían recordatorios.' }, { status: 403 });
    const prev = lastSent.get(taskId);
    if (prev && Date.now() - prev < REMINDER_GAP_MS) return NextResponse.json({ error: 'Ya se envió un recordatorio de esta actividad hace poco. Intente más tarde.' }, { status: 429 });
    lastSent.set(taskId, Date.now());
    await notifyActivityReminder({
      taskId,
      userId: t.id_assigned,
      requestId: t.consecutive ? `${t.id_request_general} (${t.consecutive})` : t.id_request_general,
      subject: t.subject_request,
      taskName: t.task,
      fromName: t.fromName,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Error task-reminder:', e);
    return NextResponse.json({ error: 'No se pudo enviar el recordatorio' }, { status: 500 });
  }
}
