import { withMssqlPool } from '../mssqlPool';

/**
 * Mismo criterio que GET /api/help-desk/technical y el dashboard operativo:
 * técnicos = usuarios en subprocess_user_company del subproceso de mesa de ayuda (id 1).
 */
export const HELP_DESK_TECHNICIAN_SUBPROCESS_ID = 1;

const TECHNICIAN_BASE_SQL = `
  FROM subprocess_user_company suc
  INNER JOIN company_user cu ON cu.id_company_user = suc.id_company_user
  INNER JOIN [user] u ON u.id = cu.id_user
  WHERE suc.id_subprocess = @subprocess_id
`;

/** ¿El correo pertenece al roster de técnicos de mesa de ayuda? */
export async function isHelpDeskTechnician(userEmail: string): Promise<boolean> {
  if (!userEmail?.trim()) return false;

  try {
    return await withMssqlPool(async (pool) => {
      const result = await pool
        .request()
        .input('subprocess_id', HELP_DESK_TECHNICIAN_SUBPROCESS_ID)
        .input('email', userEmail.trim())
        .query(`
        SELECT TOP 1 u.id
        ${TECHNICIAN_BASE_SQL}
          AND LOWER(LTRIM(RTRIM(u.email))) = LOWER(LTRIM(RTRIM(@email)))
      `);

      return result.recordset.length > 0;
    });
  } catch (error) {
    console.error('Error checking help desk technician:', error);
    return false;
  }
}

export interface HelpDeskTechnicianRow {
  id_subprocess_user_company: number;
  subprocess: string;
  id_company_user: number;
  name: string;
  email: string;
}

/** Lista de técnicos (misma fuente que /api/help-desk/technical). */
export async function listHelpDeskTechnicians(): Promise<HelpDeskTechnicianRow[]> {
  return withMssqlPool(async (pool) => {
    const result = await pool
      .request()
      .input('subprocess_id', HELP_DESK_TECHNICIAN_SUBPROCESS_ID)
      .query(`
      SELECT
        suc.id_subprocess_user_company,
        s.subprocess,
        suc.id_company_user,
        u.name,
        u.email
      FROM subprocess_user_company suc
      INNER JOIN subprocess s ON s.id_subprocess = suc.id_subprocess
      INNER JOIN company_user cu ON cu.id_company_user = suc.id_company_user
      INNER JOIN [user] u ON u.id = cu.id_user
      WHERE suc.id_subprocess = @subprocess_id
      ORDER BY u.name
    `);

    return result.recordset as HelpDeskTechnicianRow[];
  });
}
