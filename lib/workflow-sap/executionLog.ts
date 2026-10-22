import sql from 'mssql';
import sqlConfig from '../../dbconfig.js';

/**
 * Historial de ejecuciones del flujo (dbo.workflow_execution_log). Registra cada
 * ejecucion en SAP, reintento, cambio externo y evento del sistema de una solicitud.
 * Los pasos humanos no se duplican aqui: se leen de task_request_general.
 *
 * Nunca rompe el flujo: si el historial falla, se registra en consola y sigue.
 * Los resumenes se recortan y NUNCA llevan credenciales.
 */

export type StepKind = 'human' | 'sap' | 'external' | 'system';
export type TriggeredBy = 'user' | 'server' | 'retry' | 'sync';
export type StepStatus = 'started' | 'ok' | 'error' | 'skipped';

export interface StepInput {
  idRequest: number;
  stepKind: StepKind;
  stepName: string;
  triggeredBy: TriggeredBy;
  actionKey?: string | null;
  triggerEvent?: string | null;
  idTask?: number | null;
  idTaskRequest?: number | null;
  idUser?: string | null;
  idCompany?: number | null;
  sapEntity?: string | null;
  attempt?: number;
  requestSummary?: unknown;
}

export interface StepResult {
  status: Exclude<StepStatus, 'started'>;
  sapDocEntry?: number | null;
  sapDocNum?: number | null;
  responseSummary?: unknown;
  error?: string | null;
}

/** Texto recortado para el historial (objetos a JSON). */
export function summarize(value: unknown, max = 2000): string | null {
  if (value == null) return null;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Abre un paso (status started). Devuelve su id, o null si no se pudo registrar. */
export async function startStep(s: StepInput): Promise<number | null> {
  try {
    const pool = await sql.connect(sqlConfig);
    const r = await pool
      .request()
      .input('req', sql.Int, s.idRequest)
      .input('taskReq', sql.Int, s.idTaskRequest ?? null)
      .input('task', sql.Int, s.idTask ?? null)
      .input('kind', sql.NVarChar(20), s.stepKind)
      .input('name', sql.NVarChar(200), s.stepName.slice(0, 200))
      .input('action', sql.NVarChar(50), s.actionKey ?? null)
      .input('trigger', sql.NVarChar(20), s.triggerEvent ?? null)
      .input('by', sql.NVarChar(20), s.triggeredBy)
      .input('user', sql.NVarChar(50), s.idUser ?? null)
      .input('attempt', sql.Int, s.attempt ?? 1)
      .input('company', sql.Int, s.idCompany ?? null)
      .input('entity', sql.NVarChar(50), s.sapEntity ?? null)
      .input('reqSum', sql.NVarChar(2000), summarize(s.requestSummary)).query(`
        INSERT INTO dbo.workflow_execution_log
          (id_request_general, id_task_request, id_task, step_kind, step_name, action_key, trigger_event,
           triggered_by, id_user, status, attempt, id_company, sap_entity, request_summary)
        OUTPUT INSERTED.id
        VALUES (@req, @taskReq, @task, @kind, @name, @action, @trigger, @by, @user, N'started', @attempt,
                @company, @entity, @reqSum);`);
    return Number(r.recordset[0]?.id) || null;
  } catch (e) {
    console.error('[workflow_execution_log] no se pudo abrir el paso:', e);
    return null;
  }
}

/** Cierra un paso con su resultado. */
export async function finishStep(id: number | null, r: StepResult): Promise<void> {
  if (!id) return;
  try {
    const pool = await sql.connect(sqlConfig);
    await pool
      .request()
      .input('id', sql.BigInt, id)
      .input('status', sql.NVarChar(20), r.status)
      .input('docEntry', sql.Int, r.sapDocEntry ?? null)
      .input('docNum', sql.Int, r.sapDocNum ?? null)
      .input('resSum', sql.NVarChar(2000), summarize(r.responseSummary))
      .input('error', sql.NVarChar(1000), r.error ? r.error.slice(0, 1000) : null).query(`
        UPDATE dbo.workflow_execution_log
           SET status = @status, sap_doc_entry = @docEntry, sap_doc_num = @docNum,
               response_summary = @resSum, error = @error, finished_at = sysutcdatetime()
         WHERE id = @id;`);
  } catch (e) {
    console.error('[workflow_execution_log] no se pudo cerrar el paso:', e);
  }
}

/**
 * Ejecuta `fn` registrando el paso: started -> ok | error. El resultado de `fn`
 * decide el cierre; una excepcion se registra como error y se relanza.
 */
export async function withStep<T>(
  s: StepInput,
  fn: () => Promise<T>,
  describe: (result: T) => StepResult = () => ({ status: 'ok' })
): Promise<T> {
  const id = await startStep(s);
  try {
    const result = await fn();
    await finishStep(id, describe(result));
    return result;
  } catch (e) {
    await finishStep(id, { status: 'error', error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
