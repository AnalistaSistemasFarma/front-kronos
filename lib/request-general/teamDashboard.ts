import 'server-only';
import { sql, withMssqlPool } from '../mssqlPool';
import { requestResponsibleSql } from './workload';
import type { TeamActivityRow } from './teamWorkload';

/**
 * Datos del dashboard «Mi equipo» (reglas en teamWorkload.ts).
 * Pendientes: todas. Cerradas: solo las de los últimos 13 meses (el filtro de periodo
 * más amplio es el año, más el mes de referencia).
 */

const TEAM_SCOPE_SQL = `
  FROM task_request_general trg
  INNER JOIN requests_general rg ON rg.id = trg.id_request_general
  WHERE NULLIF(LTRIM(RTRIM(trg.id_assigned)), '') IS NOT NULL
    AND trg.id_assigned <> @idUser
    AND trg.id_status <> 6
    AND ${requestResponsibleSql('rg', '@idUser')}`;

/** Líder = responsable de al menos una solicitud con actividades asignadas a otra persona. */
export async function isTeamLeader(userId: string): Promise<boolean> {
  return withMssqlPool(async (pool) => {
    const result = await pool
      .request()
      .input('idUser', sql.NVarChar(255), userId)
      .query(`SELECT TOP 1 trg.id ${TEAM_SCOPE_SQL}`);
    return result.recordset.length > 0;
  });
}

export async function loadTeamActivities(userId: string): Promise<TeamActivityRow[]> {
  return withMssqlPool(async (pool) => {
    const result = await pool
      .request()
      .input('idUser', sql.NVarChar(255), userId)
      .query(`
        SELECT
          trg.id,
          trg.id_request_general,
          tpc.task,
          trg.id_status,
          sc.status AS status_task,
          trg.id_assigned,
          ua.name AS assigned,
          ua.email AS assigned_email,
          rg.subject_request AS subject,
          c.company,
          pc.process,
          trg.start_date,
          trg.date_resolution
        FROM task_request_general trg
        INNER JOIN requests_general rg ON rg.id = trg.id_request_general
        INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
        INNER JOIN status_case sc ON sc.id_status_case = trg.id_status
        INNER JOIN company c ON c.id_company = rg.id_company
        LEFT JOIN [user] ua ON ua.id = trg.id_assigned
        OUTER APPLY (
          -- Un solo proceso por solicitud para no duplicar actividades.
          SELECT TOP 1 pc.process
          FROM process_category_request_general pcrg
          INNER JOIN process_category pc ON pc.id = pcrg.id_process_category
          WHERE pcrg.id_request_general = rg.id
          ORDER BY pcrg.id_process_category
        ) pc
        WHERE trg.id IN (SELECT trg.id ${TEAM_SCOPE_SQL})
          AND (
            trg.id_status NOT IN (2, 3)
            OR trg.date_resolution >= DATEADD(MONTH, -13, GETDATE())
          )
        ORDER BY trg.id DESC
      `);
    return result.recordset as TeamActivityRow[];
  });
}
