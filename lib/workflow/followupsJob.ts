import { sql, withMssqlPool } from '../mssqlPool';
import { advanceSequentialTask } from './advanceSequentialTask.js';
import { classifyRows, type DateTrackingConfig } from './followups';

/**
 * job_type «workflow_followups» (2026-11-26), todos los días a las 6:00 a. m.:
 *  1. crea las tareas DIFERIDAS que ya llegaron a su fecha (p. ej. verificación de eficacia a los 90 días);
 *  2. avisa en la campana las fechas comprometidas por vencer (N días hábiles antes) y las vencidas de las solicitudes
 *     abiertas de los flujos que tienen seguimiento de fechas.
 */
export async function runWorkflowFollowups(): Promise<{ ref: string; detail: string }> {
  const { notifyCommittedDates } = await import('../notificationEvents.js');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

  const deferred = await withMssqlPool(async (pool) => {
    const due = await pool.request().query<{ id: number; id_request_general: number; prev_id_task: number | null; prev_display_order: number | null; id_process_category: number | null; subject_request: string | null; status_req: number }>(`
      SELECT TOP 200 d.id, d.id_request_general, d.prev_id_task, d.prev_display_order, d.id_process_category, rg.subject_request, rg.status_req
      FROM dbo.task_deferred d INNER JOIN requests_general rg ON rg.id = d.id_request_general
      WHERE d.done_at IS NULL AND d.due_at <= GETDATE()
      ORDER BY d.due_at`);
    let created = 0;
    for (const d of due.recordset) {
      // A closed or cancelled request no longer needs the task.
      if ([2, 3].includes(Number(d.status_req)) || d.prev_id_task == null || d.id_process_category == null) {
        await pool.request().input('id', sql.Int, d.id).query('UPDATE dbo.task_deferred SET done_at = GETDATE() WHERE id = @id');
        continue;
      }
      await advanceSequentialTask(pool, {
        id_request_general: d.id_request_general,
        id_task: d.prev_id_task,
        id_process_category: d.id_process_category,
        display_order: d.prev_display_order,
        subject_request: d.subject_request,
        skipDelay: true,
      } as never);
      await pool.request().input('id', sql.Int, d.id).query('UPDATE dbo.task_deferred SET done_at = GETDATE() WHERE id = @id');
      created++;
    }
    return created;
  });

  const alerts = await withMssqlPool(async (pool) => {
    const rows = await pool.request().query<DateTrackingConfig & { id_request_general: number; subject_request: string | null; consecutive: string | null; value_text: string | null }>(`
      SELECT t.id_form_field, t.date_col, t.extension_col, t.status_col, t.done_value, t.warn_business_days, t.single_extension,
             rg.id AS id_request_general, rg.subject_request, rg.consecutive, v.value_text
      FROM dbo.process_date_tracking t
      INNER JOIN process_category_request_general pcrg ON pcrg.id_process_category = t.id_process_category
      INNER JOIN requests_general rg ON rg.id = pcrg.id_request_general AND rg.status_req NOT IN (2, 3)
      INNER JOIN request_form_value v ON v.id_request_general = rg.id AND v.id_form_field = t.id_form_field`);
    let n = 0;
    for (const r of rows.recordset) {
      let parsed: Record<string, unknown>[] = [];
      try {
        const v = JSON.parse(String(r.value_text ?? ''));
        parsed = Array.isArray(v?.rows) ? v.rows : [];
      } catch {
        parsed = [];
      }
      const c = classifyRows(parsed, { ...r, single_extension: Boolean(r.single_extension) }, today);
      if (!c.overdue.length && !c.dueSoon.length) continue;
      await notifyCommittedDates({ requestId: r.id_request_general, consecutive: r.consecutive, subject: r.subject_request, overdue: c.overdue, dueSoon: c.dueSoon });
      n++;
    }
    return n;
  });

  return { ref: today, detail: `Tareas diferidas creadas: ${deferred}. Solicitudes con fechas por vencer o vencidas avisadas: ${alerts}.` };
}
