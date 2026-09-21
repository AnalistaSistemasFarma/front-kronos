import 'server-only';
import { getBalancesPool, sql } from './adminPool';
import { getBalanceCompany, readBalanceSql, type BalanceCompanyConfig } from './companies';
import { prisma } from '../prisma';

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
 * Registra el resultado en la tabla `balance_run`.
 */
export async function runCompanyBalance(
  company: BalanceCompanyConfig,
  triggeredByEmail: string
): Promise<BalanceRunResult> {
  const runId = await startCompanyBalance(company, triggeredByEmail);
  return executeCompanyBalance(company, runId);
}

/** Crea la corrida en estado `running` y devuelve su id sin ejecutar SQL operativo. */
export async function startCompanyBalance(
  company: BalanceCompanyConfig,
  triggeredByEmail: string
): Promise<number> {
  const runId = await acquireGlobalRunLock(company.idCompany, triggeredByEmail);
  if (runId == null) throw new BalanceRunLockedError();
  return runId;
}

/** Ejecuta la corrida ya registrada; está diseñada para ejecutarse en background. */
export async function executeCompanyBalance(
  company: BalanceCompanyConfig,
  runId: number
): Promise<BalanceRunResult> {
  const result: BalanceRunResult = {
    idCompany: company.idCompany,
    ok: false,
    balance: { ok: false, durationMs: 0 },
    acumulado: { ok: false, durationMs: 0 },
  };

  try {
    const pool = await getBalancesPool();
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
  } catch (err) {
    result.balance.error = err instanceof Error ? err.message : String(err);
  }

  result.ok = result.balance.ok && result.acumulado.ok;

  await finishRunRow(runId, result);

  return result;
}

/**
 * Inserta la fila `running` SOLO si no hay ninguna otra fila `running` en
 * TODA la tabla (cualquier empresa) — atómico vía TABLOCKX/HOLDLOCK dentro
 * del mismo INSERT, para que dos clics casi simultáneos no se cuelen los dos.
 * Devuelve el id insertado, o `null` si ya había una corrida en curso.
 */
async function acquireGlobalRunLock(
  idCompany: number,
  triggeredByEmail: string
): Promise<number | null> {
  const rows = await prisma.$queryRaw<Array<{ id: number }>>`
      INSERT INTO [dbo].[balance_run] (id_company, triggered_by, status, started_at)
      OUTPUT INSERTED.id
      SELECT ${idCompany}, ${triggeredByEmail}, 'running', GETDATE()
      WHERE NOT EXISTS (
        SELECT 1 FROM [dbo].[balance_run] WITH (TABLOCKX, HOLDLOCK) WHERE status = 'running'
      )
  `;
  return rows[0]?.id ?? null;
}

async function finishRunRow(
  runId: number,
  result: BalanceRunResult
): Promise<void> {
  const status = result.ok ? 'success' : 'failed';
  const errorMessage = [result.balance.error, result.acumulado.error].filter(Boolean).join(' | ') || null;
  await prisma.balanceRun.update({
    where: { id: runId },
    data: {
      status,
      finished_at: new Date(),
      balance_duration_ms: result.balance.durationMs,
      acumulado_duration_ms: result.acumulado.durationMs,
      error_message: errorMessage,
    },
  });
}

export { getBalanceCompany };
