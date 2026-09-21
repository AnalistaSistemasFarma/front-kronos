import 'server-only';
import { getBalancesPool, sql } from './adminPool';
import { getBalanceCompany, readBalanceSql, type BalanceCompanyConfig } from './companies';

export type BalanceKind = 'balance' | 'acumulado';

/** Ya hay una corrida en curso (de cualquier empresa) — candado global, ver runCompanyBalance. */
export class BalanceRunLockedError extends Error {
  constructor() {
    super(
      'Ya hay un balance en curso (de cualquiera de las 3 empresas). Espere a que termine antes de disparar otro — evita sobrecargar el 10.7.'
    );
    this.name = 'BalanceRunLockedError';
  }
}

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
 * CANDADO GLOBAL (pedido explícito de Nicolás, 2026-09-21): los 3 botones se
 * disparan de forma independiente, PERO nunca deben correr dos empresas a la
 * vez contra el 10.7 ("no colguemos 3 bases al mismo tiempo") — es un candado
 * de UNA sola corrida activa en TODO el módulo, no por empresa. El check +
 * insert va en un único INSERT ... WHERE NOT EXISTS con TABLOCKX/HOLDLOCK
 * para que sea atómico (dos clics casi simultáneos no pueden colarse los dos).
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

  const runId = await acquireGlobalRunLock(pool, company.idCompany, triggeredByEmail);
  if (runId == null) {
    throw new BalanceRunLockedError();
  }

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

/**
 * Inserta la fila `running` SOLO si no hay ninguna otra fila `running` en
 * TODA la tabla (cualquier empresa) — atómico vía TABLOCKX/HOLDLOCK dentro
 * del mismo INSERT, para que dos clics casi simultáneos no se cuelen los dos.
 * Devuelve el id insertado, o `null` si ya había una corrida en curso.
 */
async function acquireGlobalRunLock(
  pool: Awaited<ReturnType<typeof getBalancesPool>>,
  idCompany: number,
  triggeredByEmail: string
): Promise<number | null> {
  const r = await pool
    .request()
    .input('idCompany', sql.Int, idCompany)
    .input('triggeredBy', sql.NVarChar, triggeredByEmail)
    .query(`
      INSERT INTO [dbo].[balance_run] (id_company, triggered_by, status, started_at)
      OUTPUT INSERTED.id
      SELECT @idCompany, @triggeredBy, 'running', GETDATE()
      WHERE NOT EXISTS (
        SELECT 1 FROM [dbo].[balance_run] WITH (TABLOCKX, HOLDLOCK) WHERE status = 'running'
      )
    `);
  if (r.recordset.length === 0) return null;
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
