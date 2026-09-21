import 'server-only';
import { getBalancesPool, sql } from './adminPool';
import { getBalanceCompany, readBalanceSql, type BalanceCompanyConfig } from './companies';

export type BalanceKind = 'balance' | 'acumulado';

export interface BalanceRunResult {
  idCompany: number;
  ok: boolean;
  balance: { ok: boolean; durationMs: number; error?: string };
  acumulado: { ok: boolean; durationMs: number; error?: string };
}

/**
 * Ejecuta el balance (normal + acumulado) de UNA empresa, en secuencia —
 * mismo orden que el botón viejo de SAPSEND (`executeBalance` luego
 * `executeBalanceAccrued`). Corre el SQL EXACTO extraído del paso
 * correspondiente del job compartido, directo contra FARMA_IND_PROD en el
 * 10.7, SIN pasar por SQL Agent — así queda aislado por empresa sin tocar el
 * job compartido (ver hallazgo de Sprint 0, 2026-09-21).
 *
 * Registra el resultado en la tabla `balance_run` (ver
 * docs/balances-module.md para el DDL — tabla NUEVA, pendiente de crear en
 * KRONOSDB antes de desplegar).
 */
export async function runCompanyBalance(
  company: BalanceCompanyConfig,
  triggeredByEmail: string
): Promise<BalanceRunResult> {
  const pool = await getBalancesPool();

  const result: BalanceRunResult = {
    idCompany: company.idCompany,
    ok: false,
    balance: { ok: false, durationMs: 0 },
    acumulado: { ok: false, durationMs: 0 },
  };

  const alreadyRunning = await pool
    .request()
    .input('idCompany', sql.Int, company.idCompany)
    .query(`SELECT TOP 1 id FROM [dbo].[balance_run] WHERE id_company = @idCompany AND status = 'running'`);
  if (alreadyRunning.recordset.length > 0) {
    throw new Error('Ya hay una corrida en curso para esta empresa. Espere a que termine.');
  }

  const runId = await insertRunRow(pool, company.idCompany, triggeredByEmail, 'running');

  for (const kind of ['balance', 'acumulado'] as const) {
    const fileName = kind === 'balance' ? company.balanceSqlFile : company.acumuladoSqlFile;
    const started = Date.now();
    try {
      const text = readBalanceSql(fileName);
      await pool.request().query(text);
      result[kind] = { ok: true, durationMs: Date.now() - started };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result[kind] = { ok: false, durationMs: Date.now() - started, error: message };
      // Si falla el balance normal, no tiene sentido correr el acumulado detrás.
      break;
    }
  }

  result.ok = result.balance.ok && result.acumulado.ok;

  await finishRunRow(pool, runId, result);

  return result;
}

async function insertRunRow(
  pool: Awaited<ReturnType<typeof getBalancesPool>>,
  idCompany: number,
  triggeredByEmail: string,
  status: string
): Promise<number> {
  const r = await pool
    .request()
    .input('idCompany', sql.Int, idCompany)
    .input('triggeredBy', sql.NVarChar, triggeredByEmail)
    .input('status', sql.NVarChar, status)
    .query(`
      INSERT INTO [dbo].[balance_run] (id_company, triggered_by, status, started_at)
      OUTPUT INSERTED.id
      VALUES (@idCompany, @triggeredBy, @status, GETDATE())
    `);
  return r.recordset[0].id as number;
}

async function finishRunRow(
  pool: Awaited<ReturnType<typeof getBalancesPool>>,
  runId: number,
  result: BalanceRunResult
): Promise<void> {
  const status = result.ok ? 'success' : 'failed';
  const errorMessage = [result.balance.error, result.acumulado.error].filter(Boolean).join(' | ') || null;
  await pool
    .request()
    .input('id', sql.Int, runId)
    .input('status', sql.NVarChar, status)
    .input('balanceMs', sql.Int, result.balance.durationMs)
    .input('acumuladoMs', sql.Int, result.acumulado.durationMs)
    .input('errorMessage', sql.NVarChar, errorMessage)
    .query(`
      UPDATE [dbo].[balance_run]
      SET status = @status,
          finished_at = GETDATE(),
          balance_duration_ms = @balanceMs,
          acumulado_duration_ms = @acumuladoMs,
          error_message = @errorMessage
      WHERE id = @id
    `);
}

export { getBalanceCompany };
