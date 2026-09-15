import sql from 'mssql';
import {
  DELETE_ATTACHMENTS_NAME,
  DELETE_ATTACHMENTS_URL,
} from './access';

type SqlPool = import('mssql').ConnectionPool;

/** Permiso Eliminar adjuntos. Sin bypass admin. */
export async function userHasDeleteAttachmentsPermission(
  pool: SqlPool,
  userId: string
): Promise<boolean> {
  if (!userId) return false;

  const permitted = await pool
    .request()
    .input('id_user', sql.NVarChar(255), userId)
    .input('url', sql.NVarChar(255), DELETE_ATTACHMENTS_URL)
    .input('nameLike', sql.NVarChar(255), `%${DELETE_ATTACHMENTS_NAME}%`)
    .query(`
      SELECT TOP 1 suc.id_subprocess_user_company AS id
      FROM subprocess_user_company suc
      INNER JOIN company_user cu
        ON cu.id_company_user = suc.id_company_user
      INNER JOIN subprocess s
        ON s.id_subprocess = suc.id_subprocess
      WHERE cu.id_user = @id_user
        AND (
          LOWER(LTRIM(RTRIM(ISNULL(s.subprocess_url, N'')))) = LOWER(LTRIM(RTRIM(@url)))
          OR LOWER(LTRIM(RTRIM(ISNULL(s.subprocess, N'')))) LIKE LOWER(@nameLike)
        )
    `);

  return Boolean(permitted.recordset[0]?.id);
}
