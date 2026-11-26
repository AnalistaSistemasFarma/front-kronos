import { sql, withMssqlPool } from '../mssqlPool';

/** Writes a line in the flow change log; never breaks the main action. */
export async function logFlowChange(idProcess: number, email: string, action: string, detail?: string | null): Promise<void> {
  try {
    await withMssqlPool((pool) =>
      pool
        .request()
        .input('id', sql.Int, idProcess)
        .input('email', sql.NVarChar(255), email.slice(0, 255))
        .input('action', sql.NVarChar(60), action.slice(0, 60))
        .input('detail', sql.NVarChar(2000), detail ? detail.slice(0, 2000) : null)
        .query('INSERT INTO dbo.process_category_change_log (id_process_category, actor_email, action, detail) VALUES (@id, @email, @action, @detail)')
    );
  } catch (e) {
    console.warn('[flujos] no se pudo registrar el cambio del flujo', idProcess, action, e);
  }
}
