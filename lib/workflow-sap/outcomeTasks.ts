import sql from 'mssql';
import sqlConfig from '../../dbconfig.js';

/**
 * Tareas SAP condicionadas al resultado de la autorización («si se rechaza», «si se envía a
 * cotizar»): no se crean con la solicitud (así no quedan varias tareas pendientes a la vez);
 * se crean aquí cuando ese resultado ocurre. Idempotente.
 */
export async function instantiateOutcomeTasks(idRequest: number, trigger: 'on_reject' | 'on_quote'): Promise<number> {
  const pool = await sql.connect(sqlConfig);
  const r = await pool.request().input('req', sql.Int, idRequest).input('t', sql.NVarChar(20), trigger).query(`
    INSERT INTO task_request_general (id_request_general, id_task, id_status, id_assigned)
    SELECT rg.id, tpc.id, 4, NULL
    FROM requests_general rg
    INNER JOIN process_category_request_general pcr ON pcr.id_request_general = rg.id
    INNER JOIN task_process_category tpc ON tpc.id_process_category = pcr.id_process_category AND tpc.active = 1
    WHERE rg.id = @req AND tpc.task_kind = N'sap_executor'
      AND EXISTS (SELECT 1 FROM dbo.task_sap_action a WHERE a.id_task = tpc.id AND a.active = 1 AND a.trigger_event = @t)
      AND NOT EXISTS (SELECT 1 FROM task_request_general x WHERE x.id_request_general = rg.id AND x.id_task = tpc.id);`);
  return r.rowsAffected[0] ?? 0;
}
