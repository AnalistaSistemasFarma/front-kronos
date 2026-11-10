import sql from 'mssql';
import sqlConfig from '../../dbconfig.js';
import { DEFAULT_AUTHORIZATION_EFFECTS, type TaskKind, type TriggerEvent } from './catalog';

/**
 * Lectura de la configuracion SAP de los flujos (task_process_category.task_kind y
 * dbo.task_sap_action), del lado del servidor.
 *
 * Compatibilidad: si el proceso de una solicitud NO tiene ninguna accion SAP
 * configurada, se usan los efectos con los que siempre trabajo Compras
 * (DEFAULT_AUTHORIZATION_EFFECTS). Desde que se configura algo, manda la configuracion.
 */

export interface TaskSapActionRow {
  id: number;
  id_task: number;
  trigger_event: TriggerEvent;
  action_key: string;
  mapping: string | null;
  display_order: number;
}

/** Proceso (plantilla) de una solicitud del workflow. */
async function processOfRequest(idRequest: number): Promise<number | null> {
  const pool = await sql.connect(sqlConfig);
  const r = await pool.request().input('req', sql.Int, idRequest).query(`
    SELECT TOP 1 tpc.id_process_category AS p
    FROM task_request_general trg
    INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
    WHERE trg.id_request_general = @req;`);
  return r.recordset[0]?.p ?? null;
}

/** Acciones activas de un proceso, opcionalmente filtradas por tipo de tarea. */
export async function processActions(idProcess: number, taskKind?: TaskKind): Promise<TaskSapActionRow[]> {
  const pool = await sql.connect(sqlConfig);
  const req = pool.request().input('p', sql.Int, idProcess);
  if (taskKind) req.input('kind', sql.NVarChar(20), taskKind);
  const r = await req.query<TaskSapActionRow>(`
    SELECT tsa.id, tsa.id_task, tsa.trigger_event, tsa.action_key, tsa.mapping, tsa.display_order
    FROM dbo.task_sap_action tsa
    INNER JOIN task_process_category tpc ON tpc.id = tsa.id_task
    WHERE tpc.id_process_category = @p AND tsa.active = 1
      ${
        // «autorizacion» se deriva de is_authorization (los INSERT existentes no llenan task_kind).
        taskKind === 'authorization'
          ? 'AND tpc.is_authorization = 1'
          : taskKind
            ? "AND tpc.task_kind = @kind AND ISNULL(tpc.is_authorization, 0) = 0"
            : ''
      }
    ORDER BY tsa.display_order, tsa.id;`);
  return r.recordset;
}

/**
 * ¿Debe ejecutarse este efecto SAP de una tarea de autorizacion en esta solicitud?
 * Sin configuracion en el proceso -> efectos por defecto de Compras.
 */
export async function isAuthorizationEffectEnabled(
  idRequest: number,
  trigger: TriggerEvent,
  actionKey: string
): Promise<boolean> {
  try {
    const idProcess = await processOfRequest(idRequest);
    if (!idProcess) return true;
    const all = await processActions(idProcess);
    if (all.length === 0) {
      return DEFAULT_AUTHORIZATION_EFFECTS.some((d) => d.trigger === trigger && d.actionKey === actionKey);
    }
    const auth = await processActions(idProcess, 'authorization');
    if (auth.some((a) => a.trigger_event === trigger && a.action_key === actionKey)) return true;
    // También cuando el flujo lo tiene como Tarea SAP condicionada («si se rechaza», «si se cotiza»).
    const sapTasks = await processActions(idProcess, 'sap_executor');
    return sapTasks.some((a) => a.trigger_event === trigger && a.action_key === actionKey);
  } catch (e) {
    // Si la configuracion no se puede leer, se conserva el comportamiento de siempre.
    console.error('[workflow-sap] no se pudo leer la configuración; se usan los efectos por defecto:', e);
    return DEFAULT_AUTHORIZATION_EFFECTS.some((d) => d.trigger === trigger && d.actionKey === actionKey);
  }
}
