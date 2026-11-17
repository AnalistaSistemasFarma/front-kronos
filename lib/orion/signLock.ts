import 'server-only';
import sql from 'mssql';

type SqlPool = import('mssql').ConnectionPool;

/**
 * Serializa complete-sign por requestId+fileId entre instancias (pm2 / varias
 * réplicas) con sp_getapplock. El trabajo de `fn` puede usar el pool normal:
 * el candado vive en una transacción aparte hasta commit/rollback.
 */
export async function withOrionSignAppLock<T>(
  pool: SqlPool,
  resource: string,
  fn: () => Promise<T>
): Promise<T> {
  const name = `orion-sign:${resource}`.slice(0, 255);
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const lock = await new sql.Request(tx)
      .input('res', sql.NVarChar(255), name)
      .query(`
        DECLARE @r INT;
        EXEC @r = sp_getapplock
          @Resource = @res,
          @LockMode = N'Exclusive',
          @LockOwner = N'Transaction',
          @LockTimeout = 10000; -- menor que el requestTimeout de mssql (15 s por defecto): así responde 409 y no un 500 por tiempo agotado
        SELECT @r AS r;
      `);
    if (Number(lock.recordset[0]?.r) < 0) {
      throw Object.assign(
        new Error(
          'Ya hay una firma en curso para este documento. Espere un momento e intente de nuevo.'
        ),
        { status: 409, code: 'SIGN_IN_PROGRESS' }
      );
    }
    const result = await fn();
    await tx.commit();
    return result;
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* ya cerrada */
    }
    throw err;
  }
}
