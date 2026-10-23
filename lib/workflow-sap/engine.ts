import sql from 'mssql';
import sqlConfig from '../../dbconfig.js';
import { onAuthorizationDecision } from '../purchases/authorization';
import { prisma } from '../prisma';
import { advanceSequentialTask } from '../workflow/advanceSequentialTask.js';
import { getSapAction } from './catalog';
import { processActions } from './config';
import { finishStep, startStep, type TriggeredBy } from './executionLog';

/**
 * Motor de las tareas «Ejecutora SAP».
 *
 * Toma las instancias pendientes (id_status 4) de tareas sap_executor de una
 * solicitud, ejecuta sus acciones del catalogo (disparador on_execute) y, si salen
 * bien, cierra la tarea (id_status 2) y avanza el flujo como lo hace una tarea humana
 * (advanceSequentialTask). Si falla, la tarea queda pendiente marcada con
 * «[sap:error] …» para reintentar.
 *
 * Toma atomica: la tarea se marca «[sap:ejecutando]» con un UPDATE condicionado, asi
 * dos procesos nunca la ejecutan a la vez. Nunca lanza: se invoca en segundo plano.
 */

const RUNNING = '[sap:ejecutando]';
const ERROR_PREFIX = '[sap:error]';
const MAX_ROUNDS = 5;

interface PendingExecutor {
  id: number;
  id_task: number;
  task: string;
  display_order: number | null;
  id_process_category: number;
  subject_request: string | null;
}

async function pendingExecutors(idRequest: number): Promise<PendingExecutor[]> {
  const pool = await sql.connect(sqlConfig);
  const r = await pool.request().input('req', sql.Int, idRequest).query<PendingExecutor>(`
    SELECT trg.id, trg.id_task, tpc.task, tpc.display_order, tpc.id_process_category, rg.subject_request
    FROM task_request_general trg
    INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
    INNER JOIN requests_general rg ON rg.id = trg.id_request_general
    WHERE trg.id_request_general = @req AND trg.id_status = 4 AND tpc.task_kind = N'sap_executor'
      AND ISNULL(tpc.is_authorization, 0) = 0
    ORDER BY tpc.display_order, trg.id;`);
  return r.recordset;
}

async function claim(idTaskRequest: number): Promise<boolean> {
  const pool = await sql.connect(sqlConfig);
  const r = await pool
    .request()
    .input('id', sql.Int, idTaskRequest)
    .input('running', sql.NVarChar(50), RUNNING)
    .input('err', sql.NVarChar(50), `${ERROR_PREFIX}%`).query(`
      UPDATE task_request_general SET resolution = @running
      WHERE id = @id AND id_status = 4 AND (resolution IS NULL OR resolution = N'' OR resolution LIKE @err);`);
  return (r.rowsAffected[0] ?? 0) === 1;
}

async function release(idTaskRequest: number, resolution: string | null): Promise<void> {
  const pool = await sql.connect(sqlConfig);
  await pool
    .request()
    .input('id', sql.Int, idTaskRequest)
    .input('res', sql.NVarChar(sql.MAX), resolution)
    .query(`UPDATE task_request_general SET resolution = @res WHERE id = @id AND id_status = 4;`);
}

async function complete(task: PendingExecutor, idRequest: number, resolution: string): Promise<void> {
  const pool = await sql.connect(sqlConfig);
  await pool
    .request()
    .input('id', sql.Int, task.id)
    .input('res', sql.NVarChar(sql.MAX), resolution)
    .query(`UPDATE task_request_general
            SET id_status = 2, resolution = @res, date_resolution = GETDATE(),
                start_date = COALESCE(start_date, GETDATE()), end_date = GETDATE()
            WHERE id = @id AND id_status = 4;`);
  await advanceSequentialTask(pool, {
    id_request_general: idRequest,
    id_task: task.id_task,
    id_process_category: task.id_process_category,
    display_order: task.display_order,
    subject_request: task.subject_request,
  });
}

/** Ejecuta una accion del catalogo en el contexto de una solicitud. */
async function runAction(
  idRequest: number,
  actionKey: string,
  triggeredBy: TriggeredBy
): Promise<{ ok: true; detail: string } | { ok: false; wait?: boolean; error: string }> {
  switch (actionKey) {
    case 'purchase.publish_firm': {
      // Ya publicada (p. ej. por un reintento manual): la tarea se da por hecha.
      const link = await prisma.purchaseAuthorization.findUnique({ where: { id_request_general: idRequest } });
      if (!link) return { ok: false, error: 'La solicitud no está enlazada a un borrador de compra.' };
      if (link.status === 'approved') {
        return { ok: true, detail: `Solicitud en firme ${link.firm_doc_entry ?? ''} (ya publicada)`.trim() };
      }
      const r = await onAuthorizationDecision(idRequest, true, null, triggeredBy, 'executor');
      if (r.skipped) return { ok: false, wait: true, error: 'Esperando que se aprueben todas las autorizaciones.' };
      if (r.status === 'approved') return { ok: true, detail: 'Solicitud en firme publicada en SAP' };
      return { ok: false, error: r.error ?? `Estado ${r.status}` };
    }
    default:
      return { ok: false, error: `La acción «${actionKey}» no tiene ejecutor automático.` };
  }
}

/**
 * Ejecuta las tareas «Ejecutora SAP» pendientes de una solicitud. Repite mientras
 * una ejecucion abra la siguiente tarea secuencial y esta tambien sea ejecutora.
 */
export async function runSapExecutors(
  idRequest: number | null | undefined,
  triggeredBy: TriggeredBy = 'server'
): Promise<{ executed: number; errors: number }> {
  const result = { executed: 0, errors: 0 };
  if (!idRequest) return result;
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const pending = await pendingExecutors(Number(idRequest));
      if (pending.length === 0) break;
      let progressed = false;

      for (const task of pending) {
        if (!(await claim(task.id))) continue;
        const actions = (await processActions(task.id_process_category, 'sap_executor')).filter(
          (a) => a.id_task === task.id_task && a.trigger_event === 'on_execute'
        );
        if (actions.length === 0) {
          await release(task.id, `${ERROR_PREFIX} La tarea no tiene acciones SAP configuradas.`);
          result.errors++;
          continue;
        }

        const details: string[] = [];
        let failure: { wait?: boolean; error: string } | null = null;
        for (const a of actions) {
          const r = await runAction(Number(idRequest), a.action_key, triggeredBy);
          if (r.ok) details.push(r.detail);
          else {
            failure = r;
            break;
          }
        }

        if (failure) {
          if (failure.wait) {
            // No es error: la tarea quedo lista antes de tiempo (p. ej. flujo no secuencial).
            await release(task.id, null);
          } else {
            const label = getSapAction(actions[0].action_key)?.label ?? actions[0].action_key;
            const id = await startStep({
              idRequest: Number(idRequest),
              idTaskRequest: task.id,
              idTask: task.id_task,
              stepKind: 'system',
              stepName: `Tarea «${task.task}» quedó en error`,
              actionKey: actions[0].action_key,
              triggerEvent: 'on_execute',
              triggeredBy,
            });
            await finishStep(id, { status: 'error', error: `${label}: ${failure.error}` });
            await release(task.id, `${ERROR_PREFIX} ${failure.error}`.slice(0, 1000));
            result.errors++;
          }
          continue;
        }

        await complete(task, Number(idRequest), `Ejecutada en SAP · ${details.join(' · ')}`);
        result.executed++;
        progressed = true;
      }
      if (!progressed) break;
    }
  } catch (e) {
    console.error(`[workflow-sap] error ejecutando tareas SAP de la solicitud ${idRequest}:`, e);
    result.errors++;
  }
  return result;
}
