/** Columna y JOIN para el usuario que cerró/resolvió el caso. */

let columnEnsured = false;

/** Solo el usuario que cerró el caso (id_executor_final), no el técnico asignado. */
export const CASE_EXECUTOR_NAME_SQL = 'uex.name AS executor_final';

export const CASE_EXECUTOR_JOIN_SQL = `
  LEFT JOIN [user] uex ON CAST(uex.id AS NVARCHAR(255)) = CAST(c.id_executor_final AS NVARCHAR(255))
`;

/** Filtro por técnico del roster: asignado en abiertos, quien cerró en resueltos/cancelados. */
export const TECHNICIAN_FILTER_SQL = `
  (
    (
      sc.id_status_case IN (2, 3)
      AND EXISTS (
        SELECT 1
        FROM subprocess_user_company suc_filter
        INNER JOIN company_user cu_filter ON cu_filter.id_company_user = suc_filter.id_company_user
        WHERE suc_filter.id_subprocess_user_company = @technician
          AND CAST(c.id_executor_final AS NVARCHAR(255)) = CAST(cu_filter.id_user AS NVARCHAR(255))
      )
    )
    OR (
      sc.id_status_case NOT IN (2, 3)
      AND c.id_technical = @technician
    )
  )
`;

export const TECHNICIAN_UNASSIGNED_FILTER_SQL = `
  (
    (
      sc.id_status_case IN (2, 3)
      AND NULLIF(LTRIM(RTRIM(CAST(c.id_executor_final AS NVARCHAR(255)))), '') IS NULL
    )
    OR (
      sc.id_status_case NOT IN (2, 3)
      AND (c.id_technical IS NULL OR c.id_technical = 0)
    )
  )
`;

export const ASSIGNED_USER_FILTER_SQL = `
  (
    (sc.id_status_case IN (2, 3) AND uex.name LIKE '%' + @assigned_user + '%')
    OR (sc.id_status_case NOT IN (2, 3) AND u.name LIKE '%' + @assigned_user + '%')
  )
`;

/** Casos cerrados por el usuario autenticado (id_executor_final). */
export const MY_TICKETS_RESOLVED_BY_USER_SQL = `
  EXISTS (
    SELECT 1
    FROM [user] u_resolver
    WHERE LOWER(LTRIM(RTRIM(u_resolver.email))) = LOWER(LTRIM(RTRIM(@user_email)))
      AND CAST(u_resolver.id AS NVARCHAR(255)) = CAST(c.id_executor_final AS NVARCHAR(255))
  )
`;

export async function ensureCaseExecutorColumn(pool) {
  if (columnEnsured) return;

  await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'case' AND COLUMN_NAME = 'id_executor_final'
    )
    BEGIN
      ALTER TABLE [case] ADD id_executor_final NVARCHAR(255) NULL;
    END
  `);

  columnEnsured = true;
}
