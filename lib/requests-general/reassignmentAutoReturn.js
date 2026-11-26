import { sql, getPool } from '../mssqlPool';
import { revertReassignment } from './reassignmentRevert';

const TAG = '[scheduler][reassignment_auto_return]';
const AUTO_REASON = 'Retorno automático en la fecha programada';

export async function runReassignmentAutoReturnJob(payload) {
  const systemUser = process.env.SCHEDULER_SYSTEM_USER_ID || payload?.created_by || null;
  if (!systemUser) {
    throw new Error('Sin usuario sistema: configure SCHEDULER_SYSTEM_USER_ID o created_by en el payload');
  }

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
  const pool = await getPool();
  const due = (
    await pool.request().input('today', sql.Date, today).query(`
      SELECT wtr.id
      FROM workflow_task_reassignment wtr
      WHERE wtr.active = 1 AND wtr.returned_at IS NULL
        AND wtr.date_to_return IS NOT NULL AND wtr.date_to_return <= @today
        AND EXISTS (SELECT 1 FROM workflow_task_reassignment_detail d WHERE d.id_reassignment = wtr.id)
      ORDER BY wtr.id DESC
    `)
  ).recordset.map((r) => Number(r.id));

  const counts = { full: 0, partial: 0, empty: 0, error: 0 };
  const errors = [];
  for (const id of due) {
    try {
      const result = await revertReassignment({
        id,
        actorId: String(systemUser),
        reason: AUTO_REASON,
        dryRun: false,
        departmentIds: null,
        origin: 'auto',
        closeIfNothing: true,
      });
      if (!result.ok) {
        counts.error += 1;
        errors.push(`#${id}: ${result.error}`);
      } else if (result.closedEmpty) {
        counts.empty += 1;
      } else if (result.skipped?.length) {
        counts.partial += 1;
      } else {
        counts.full += 1;
      }
    } catch (err) {
      console.error(`${TAG} Error retornando la reasignación #${id}:`, err);
      counts.error += 1;
      errors.push(`#${id}: ${err?.message || 'error'}`);
    }
  }

  const detail = [
    `${due.length} vencida(s): ${counts.full} retornada(s), ${counts.partial} con omisiones,`,
    `${counts.empty} sin nada que devolver, ${counts.error} con error.`,
    errors.length ? `Errores: ${errors.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 1000);

  console.log(`${TAG} ${today}: ${detail}`);
  return { ref: today, detail };
}
