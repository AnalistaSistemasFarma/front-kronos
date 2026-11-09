import { sql, withMssqlPool } from '../mssqlPool';
import { TEAM_TASKS_NAME, TEAM_TASKS_URL } from './teamTasksAccess';

/**
 * Alcance del Líder de solicitudes (permiso "Ver tareas de mi equipo"): solo server.
 * Devuelve true si `leaderId` tiene el permiso y TODOS los `userIds` comparten
 * al menos un departamento con él (el propio líder cuenta como parte de su equipo).
 */
export async function canManageTeamMembers(leaderId: string, userIds: string[]): Promise<boolean> {
  const targets = [...new Set(userIds.filter(Boolean))];
  if (!leaderId || targets.length === 0) return false;

  return withMssqlPool(async (pool) => {
    const request = pool.request();
    request.input('leaderId', sql.NVarChar, leaderId);
    request.input('teamUrl', sql.NVarChar, TEAM_TASKS_URL);
    request.input('teamName', sql.NVarChar, TEAM_TASKS_NAME);
    targets.forEach((id, i) => request.input(`u${i}`, sql.NVarChar, id));
    const inList = targets.map((_, i) => `@u${i}`).join(', ');

    const result = await request.query(`
      SELECT
        CASE WHEN EXISTS (
          SELECT 1
          FROM subprocess_user_company suc
          INNER JOIN company_user cu ON cu.id_company_user = suc.id_company_user
          INNER JOIN subprocess s    ON s.id_subprocess   = suc.id_subprocess
          WHERE cu.id_user = @leaderId
            AND (s.subprocess_url = @teamUrl OR s.subprocess = @teamName)
        ) THEN 1 ELSE 0 END AS canViewTeam,
        (
          SELECT COUNT(DISTINCT du.id_user)
          FROM department_user du
          WHERE du.id_user IN (${inList})
            AND du.id_department IN (
              SELECT id_department FROM department_user WHERE id_user = @leaderId
            )
        ) AS inTeam;
    `);
    const row = result.recordset[0];
    return row?.canViewTeam === 1 && Number(row?.inTeam) === targets.length;
  });
}
