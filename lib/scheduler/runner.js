import * as cronParser from 'cron-parser';
import { sql, getPool } from '../mssqlPool';
import { JOB_HANDLERS } from './handlers.js';

/**
 * Runner único del servicio central de tareas automáticas.
 *
 * Idempotente por CLAIM ATÓMICO en BD: cada job vencido se "toma" con un UPDATE
 * condicionado a su next_run_date actual; solo el invocador que logra rowsAffected=1
 * lo ejecuta. Así es seguro con PM2 cluster ×2 y con la tarea programada de Windows
 * y el respaldo oportunista disparándose a la vez.
 */

/** Compat cron-parser v4 (parseExpression) / v5 (CronExpressionParser.parse). */
function parseCron(expression, options) {
  const parse =
    cronParser.CronExpressionParser?.parse ||
    cronParser.parseExpression ||
    cronParser.default?.parseExpression;
  if (!parse) throw new Error('cron-parser: API de parseo no encontrada');
  return parse(expression, options);
}

/** Próxima ocurrencia FUTURA de la expresión (catch-up natural: 1 sola ejecución). */
export function getNextRunDate(cronExpression, from = new Date()) {
  return parseCron(cronExpression, { currentDate: from }).next().toDate();
}

/** Valida una expresión cron; devuelve null si es válida o el mensaje de error. */
export function validateCronExpression(cronExpression) {
  try {
    parseCron(cronExpression, { currentDate: new Date() }).next();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Expresión cron inválida';
  }
}

async function logRun(pool, idJob, status, detail, resultRef) {
  await pool
    .request()
    .input('id_job', sql.Int, idJob)
    .input('status', sql.NVarChar(20), status)
    .input('detail', sql.NVarChar(1000), detail ? String(detail).slice(0, 1000) : null)
    .input('result_ref', sql.NVarChar(255), resultRef ? String(resultRef).slice(0, 255) : null)
    .query(`
      INSERT INTO scheduled_job_run (id_job, status, detail, result_ref)
      VALUES (@id_job, @status, @detail, @result_ref);
      UPDATE scheduled_job
      SET last_run_date = GETDATE(), last_status = @status
      WHERE id = @id_job;
    `);
}

/**
 * Ejecuta los jobs vencidos (active=1 y next_run_date <= ahora).
 * Devuelve { due, ran: [{id, name, status, ref?, detail?}], errors }.
 */
export async function runDueJobs() {
  const pool = await getPool();

  const dueResult = await pool.request().query(`
    SELECT id, name, job_type, payload, cron_expression, next_run_date
    FROM scheduled_job
    WHERE active = 1 AND next_run_date <= GETDATE()
    ORDER BY next_run_date ASC
  `);

  const dueJobs = dueResult.recordset;
  const ran = [];
  let errors = 0;

  for (const job of dueJobs) {
    let newNext;
    try {
      newNext = getNextRunDate(job.cron_expression);
    } catch (err) {
      // Cron ilegible (no debería pasar: se valida al guardar). Registrar y desactivar
      // el reintento inmediato empujando la fecha 1 día, para no ciclar en cada run.
      newNext = new Date(Date.now() + 24 * 60 * 60 * 1000);
      console.error(`[scheduler] Cron inválido en job ${job.id} (${job.name}):`, err);
    }

    // Claim atómico: solo quien mueve next_run_date ejecuta este vencimiento.
    const claim = await pool
      .request()
      .input('id', sql.Int, job.id)
      .input('newNext', sql.DateTime, newNext)
      .input('oldNext', sql.DateTime, job.next_run_date)
      .query(`
        UPDATE scheduled_job
        SET next_run_date = @newNext
        WHERE id = @id AND next_run_date = @oldNext AND active = 1
      `);

    if (claim.rowsAffected[0] !== 1) continue; // otro proceso lo tomó

    const handler = JOB_HANDLERS[job.job_type];
    try {
      if (!handler) {
        throw new Error(`job_type desconocido: ${job.job_type}`);
      }
      let payload = null;
      if (job.payload) {
        payload = JSON.parse(job.payload);
      }
      const result = (await handler(payload)) || {};
      await logRun(pool, job.id, 'ok', result.detail || null, result.ref || null);
      ran.push({ id: job.id, name: job.name, status: 'ok', ref: result.ref || null });
    } catch (err) {
      errors += 1;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[scheduler] Job ${job.id} (${job.name}) falló:`, err);
      try {
        await logRun(pool, job.id, 'error', message, null);
      } catch (logErr) {
        console.error(`[scheduler] No se pudo registrar el error del job ${job.id}:`, logErr);
      }
      ran.push({ id: job.id, name: job.name, status: 'error', detail: message });
    }
  }

  return { due: dueJobs.length, ran, errors };
}

// Respaldo oportunista: throttle en memoria por proceso (>=10 min). El claim atómico
// hace que dispararlo desde varios procesos/usuarios a la vez sea inocuo.
const OPPORTUNISTIC_INTERVAL_MS = 10 * 60 * 1000;
let lastOpportunisticRun = 0;

export function maybeRunScheduler() {
  const now = Date.now();
  if (now - lastOpportunisticRun < OPPORTUNISTIC_INTERVAL_MS) return;
  lastOpportunisticRun = now;
  runDueJobs().catch((err) => {
    console.error('[scheduler] Respaldo oportunista falló:', err);
  });
}
