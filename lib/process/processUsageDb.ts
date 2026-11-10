import 'server-only';
import { sql, withMssqlPool } from '../mssqlPool';
import { HALF_LIFE_DAYS, type SubprocessUsage } from './processUsage';

/**
 * Recurrencia del hub de procesos guardada en el servidor (igual en cualquier equipo).
 * Tabla dbo.process_hub_usage (prisma/manual/2026-11-04-process-hub-usage-*.sql, sin modelo
 * Prisma). Si la tabla no existe lanza ProcessUsageStoreUnavailableError y el hub sigue
 * ordenando con la copia del navegador.
 */

export class ProcessUsageStoreUnavailableError extends Error {
  constructor() {
    super('El orden por uso de procesos aún no está habilitado en el servidor.');
    this.name = 'ProcessUsageStoreUnavailableError';
  }
}

function isMissingTable(err: unknown): boolean {
  const e = err as { number?: number; originalError?: { info?: { number?: number } } };
  return e?.number === 208 || e?.originalError?.info?.number === 208;
}

async function withStore<T>(fn: (pool: sql.ConnectionPool) => Promise<T>): Promise<T> {
  try {
    return await withMssqlPool(fn);
  } catch (err) {
    if (isMissingTable(err)) throw new ProcessUsageStoreUnavailableError();
    throw err;
  }
}

/** Uso de la persona por acceso (solo accesos que aún existen). */
export async function listProcessUsage(userId: string): Promise<SubprocessUsage[]> {
  return withStore(async (pool) => {
    const result = await pool
      .request()
      .input('idUser', sql.NVarChar(1000), userId)
      .query(`
        SELECT u.id_subprocess, s.id_process, u.score, u.open_count, u.last_at
        FROM dbo.process_hub_usage u
        INNER JOIN dbo.subprocess s ON s.id_subprocess = u.id_subprocess
        WHERE u.id_user = @idUser
      `);
    return (result.recordset as Array<Record<string, unknown>>).map((row) => ({
      id_subprocess: Number(row.id_subprocess),
      id_process: Number(row.id_process),
      score: Number(row.score) || 0,
      count: Number(row.open_count) || 0,
      lastAt: row.last_at instanceof Date ? row.last_at.getTime() : 0,
    }));
  });
}

/**
 * Suma una apertura: lo que quedaba (ya olvidado según HALF_LIFE_DAYS) + 1.
 * Devuelve false si el acceso no existe.
 */
export async function recordProcessOpen(userId: string, idSubprocess: number): Promise<boolean> {
  return withStore(async (pool) => {
    const result = await pool
      .request()
      .input('idUser', sql.NVarChar(1000), userId)
      .input('idSub', sql.Int, idSubprocess)
      .input('halfLifeSeconds', sql.Float, HALF_LIFE_DAYS * 86400)
      .query(`
        SET XACT_ABORT ON;
        DECLARE @affected INT;
        BEGIN TRAN;
        UPDATE dbo.process_hub_usage WITH (UPDLOCK, HOLDLOCK)
          SET score = score * POWER(CAST(0.5 AS FLOAT),
                        DATEDIFF(SECOND, last_at, SYSUTCDATETIME()) / @halfLifeSeconds) + 1,
              open_count = open_count + 1,
              last_at = SYSUTCDATETIME()
          WHERE id_user = @idUser AND id_subprocess = @idSub;
        SET @affected = @@ROWCOUNT;
        IF @affected = 0
        BEGIN
          INSERT INTO dbo.process_hub_usage (id_user, id_subprocess, score, open_count, last_at)
          SELECT @idUser, s.id_subprocess, 1, 1, SYSUTCDATETIME()
          FROM dbo.subprocess s
          WHERE s.id_subprocess = @idSub;
          SET @affected = @@ROWCOUNT;
        END;
        COMMIT TRAN;
        SELECT @affected AS affected;
      `);
    return Number(result.recordset?.[0]?.affected ?? 0) > 0;
  });
}
