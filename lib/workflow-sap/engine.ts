import sql from 'mssql';
import sqlConfig from '../../dbconfig.js';
import { moveDraftToAuthorize, onAuthorizationDecision } from '../purchases/authorization';
import { prisma } from '../prisma';
import { advanceSequentialTask } from '../workflow/advanceSequentialTask.js';
import { closeRequestGeneral } from '../workflow/closeRequestGeneral.js';
import { orionInternalTaskSql } from '../orion/internalTasks';
import { getSapAction } from './catalog';
import { createOrder, evaluateRules, moveToStage, reevaluateCredit, salesLinkOf } from '../sales/flow';
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
  closes_request: boolean | number | null;
}

async function pendingExecutors(idRequest: number): Promise<PendingExecutor[]> {
  const pool = await sql.connect(sqlConfig);
  const r = await pool.request().input('req', sql.Int, idRequest).query<PendingExecutor>(`
    SELECT trg.id, trg.id_task, tpc.task, tpc.display_order, tpc.id_process_category, rg.subject_request,
           tpc.closes_request
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

  // Igual que update-activities: si la tarea «cierra la solicitud» y ya no queda nada
  // abierto (sin contar la firma interna de Orion), se cierra la solicitud.
  if (task.closes_request) {
    const open = await pool.request().input('req', sql.Int, idRequest).query(`
      SELECT COUNT(*) AS n
      FROM task_request_general trg
      INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
      WHERE trg.id_request_general = @req AND trg.id_status NOT IN (2, 3)
        AND NOT ${orionInternalTaskSql('trg', 'tpc')};`);
    if (Number(open.recordset[0]?.n ?? 0) === 0) {
      await closeRequestGeneral(pool, {
        requestId: idRequest,
        closedByUserId: null,
        resolution: `Cerrada automáticamente al ejecutar en SAP la tarea «${task.task}».`,
      });
    }
  }
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
    case 'purchase.state_rejected':
    case 'purchase.state_quotation': {
      // Las aplica la decisión del autorizador (con su motivo); la tarea SAP la refleja en el flujo.
      const want = actionKey === 'purchase.state_rejected' ? 'rejected' : 'quoted';
      const link = await prisma.purchaseAuthorization.findUnique({ where: { id_request_general: idRequest } });
      if (!link) return { ok: false, error: 'La solicitud no está enlazada a un borrador de compra.' };
      if (link.status === want) {
        return { ok: true, detail: want === 'rejected' ? 'Borrador en «No aprobado»' : 'Borrador en «En cotización»' };
      }
      if (link.status === 'reject_error') return { ok: false, error: link.error ?? 'No se pudo aplicar el rechazo en SAP.' };
      return { ok: false, wait: true, error: 'Esperando que se aplique la decisión en SAP.' };
    }
    case 'purchase.state_to_authorize': {
      const r = await moveDraftToAuthorize(idRequest, triggeredBy);
      return r.ok ? { ok: true, detail: r.detail } : { ok: false, error: r.error };
    }
    // ── Ventas · Oferta de venta (lib/sales/flow.ts) ──
    case 'sales.evaluate_rules':
      return evaluateRules(idRequest, triggeredBy);
    case 'sales.reevaluate_credit':
      return reevaluateCredit(idRequest, triggeredBy);
    case 'sales.state_ap':
      return moveToStage(idRequest, 'AP', triggeredBy);
    case 'sales.state_ae':
      return moveToStage(idRequest, 'AE', triggeredBy);
    case 'sales.state_aeda':
      return moveToStage(idRequest, 'AEDA', triggeredBy);
    case 'sales.create_order':
      return createOrder(idRequest, triggeredBy);
    case 'sales.state_rejected': {
      // Lo aplica la decisión del autorizador (onSalesAuthorizationDecision); aquí solo se refleja.
      const link = await salesLinkOf(idRequest);
      if (!link) return { ok: false, error: 'La solicitud no está enlazada a una oferta de venta.' };
      if (link.status === 'rejected') return { ok: true, detail: 'Oferta devuelta con el rechazo aplicado en SAP' };
      if (link.status === 'reject_error') return { ok: false, error: 'No se pudo aplicar el rechazo en SAP.' };
      return { ok: false, wait: true, error: 'Esperando que se aplique el rechazo en SAP.' };
    }
    default:
      return { ok: false, error: `La acción «${actionKey}» no tiene ejecutor automático.` };
  }
}

type Outcome = 'pending' | 'approved' | 'rejected' | 'quoted';
const BRANCH_TRIGGERS = ['on_reject', 'on_quote'] as const;
const OUTCOME_OF_TRIGGER: Record<string, Outcome> = { on_reject: 'rejected', on_quote: 'quoted' };
const OUTCOME_LABEL: Record<Outcome, string> = {
  pending: 'pendiente',
  approved: 'aprobada',
  rejected: 'rechazada',
  quoted: 'enviada a cotizar',
};

/**
 * Resultado de la autorizacion que precede a una tarea en el flujo (la de mayor
 * orden por debajo de ella). «Cotizar» se lee del enlace de compras porque cancela
 * la solicitud del workflow en lugar de resolver la tarea.
 */
async function precedingAuthorizationOutcome(idRequest: number, task: PendingExecutor): Promise<Outcome> {
  const link = await prisma.purchaseAuthorization.findUnique({ where: { id_request_general: idRequest } });
  if (link?.status === 'quoted') return 'quoted';
  const pool = await sql.connect(sqlConfig);
  const r = await pool
    .request()
    .input('req', sql.Int, idRequest)
    .input('p', sql.Int, task.id_process_category)
    .input('ord', sql.Int, task.display_order ?? 0).query(`
      SELECT TOP 1 trg.id_status
      FROM task_process_category tpc
      INNER JOIN task_request_general trg ON trg.id_task = tpc.id AND trg.id_request_general = @req
      WHERE tpc.id_process_category = @p AND tpc.is_authorization = 1 AND ISNULL(tpc.display_order, 0) < @ord
      ORDER BY tpc.display_order DESC, trg.id DESC;`);
  const status = Number(r.recordset[0]?.id_status ?? 4);
  if (status === 2) return 'approved';
  if (status === 3) return 'rejected';
  return 'pending';
}

/** Marca como omitida una tarea SAP cuya condicion no se cumplio (no avanza el flujo). */
async function skip(task: PendingExecutor, reason: string): Promise<void> {
  const pool = await sql.connect(sqlConfig);
  await pool
    .request()
    .input('id', sql.Int, task.id)
    .input('res', sql.NVarChar(sql.MAX), reason)
    .query(`UPDATE task_request_general
            SET id_status = 3, resolution = @res, date_resolution = GETDATE(), end_date = GETDATE()
            WHERE id = @id AND id_status = 4;`);
}

async function markError(
  idRequest: number,
  task: PendingExecutor,
  actionKey: string,
  error: string,
  triggeredBy: TriggeredBy
): Promise<void> {
  const label = getSapAction(actionKey)?.label ?? actionKey;
  const id = await startStep({
    idRequest,
    idTaskRequest: task.id,
    idTask: task.id_task,
    stepKind: 'system',
    stepName: `Tarea «${task.task}» quedó en error`,
    actionKey,
    triggerEvent: 'on_execute',
    triggeredBy,
  });
  await finishStep(id, { status: 'error', error: `${label}: ${error}` });
  await release(task.id, `${ERROR_PREFIX} ${error}`.slice(0, 1000));
}

/**
 * Ejecuta las tareas SAP pendientes de una solicitud:
 *  - Tareas SAP condicionadas («si la autorización anterior se rechaza / se envía a
 *    cotizar»): se evalúan primero; si se cumple se ejecutan, si no se marcan omitidas.
 *  - Tareas SAP normales («al llegarle el turno»): se ejecutan y avanzan el flujo.
 * Repite mientras una ejecucion abra la siguiente tarea secuencial.
 */
export async function runSapExecutors(
  idRequest: number | null | undefined,
  triggeredBy: TriggeredBy = 'server'
): Promise<{ executed: number; errors: number }> {
  const result = { executed: 0, errors: 0 };
  if (!idRequest) return result;
  const req = Number(idRequest);
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const pending = await pendingExecutors(req);
      if (pending.length === 0) break;
      let progressed = false;

      // Acciones de cada tarea; las condicionadas van primero (pueden cancelar ramas antes del cierre).
      const withActions = await Promise.all(
        pending.map(async (task) => {
          const actions = (await processActions(task.id_process_category, 'sap_executor')).filter(
            (a) => a.id_task === task.id_task
          );
          const branch = actions.find((a) => (BRANCH_TRIGGERS as readonly string[]).includes(a.trigger_event));
          return { task, actions, branch };
        })
      );
      withActions.sort((a, b) => Number(Boolean(b.branch)) - Number(Boolean(a.branch)));

      for (const { task, actions, branch } of withActions) {
        if (branch) {
          const outcome = await precedingAuthorizationOutcome(req, task);
          if (outcome === 'pending') continue; // aún no se decide
          if (!(await claim(task.id))) continue;
          if (OUTCOME_OF_TRIGGER[branch.trigger_event] !== outcome) {
            await skip(task, `Omitida: la autorización anterior fue ${OUTCOME_LABEL[outcome]}.`);
            progressed = true;
            continue;
          }
          const r = await runAction(req, branch.action_key, triggeredBy);
          if (r.ok) {
            await complete(task, req, `Ejecutada en SAP · ${r.detail}`);
            result.executed++;
            progressed = true;
          } else if (r.wait) {
            await release(task.id, null);
          } else {
            await markError(req, task, branch.action_key, r.error, triggeredBy);
            result.errors++;
          }
          continue;
        }

        if (!(await claim(task.id))) continue;
        const run = actions.filter((a) => a.trigger_event === 'on_execute');
        if (run.length === 0) {
          await release(task.id, `${ERROR_PREFIX} La tarea no tiene acciones SAP configuradas.`);
          result.errors++;
          continue;
        }
        const details: string[] = [];
        let failure: { wait?: boolean; error: string; key: string } | null = null;
        for (const a of run) {
          const r = await runAction(req, a.action_key, triggeredBy);
          if (r.ok) details.push(r.detail);
          else {
            failure = { ...r, key: a.action_key };
            break;
          }
        }
        if (failure) {
          if (failure.wait) await release(task.id, null);
          else {
            await markError(req, task, failure.key, failure.error, triggeredBy);
            result.errors++;
          }
          continue;
        }
        await complete(task, req, `Ejecutada en SAP · ${details.join(' · ')}`);
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
