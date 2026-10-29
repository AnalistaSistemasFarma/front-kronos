import 'server-only';
import sql from 'mssql';
import { orionInternalTaskSql, orionSignatureTemplateSql } from '../orion/internalTasks';
import {
  buildRequestFlow,
  type FlowTaskInstance,
  type FlowTemplateTask,
  type RequestFlow,
} from './flowProgress';

export const FLOW_MAX_IDS = 200;

function idParams(request: sql.Request, ids: number[]): string {
  return ids
    .map((id, i) => {
      request.input(`id${i}`, sql.Int, id);
      return `@id${i}`;
    })
    .join(', ');
}

/**
 * Flujo de varias solicitudes de una vez (listados). Solo devuelve las que el usuario puede ver:
 * las que creó, las que tiene a cargo, en las que tiene alguna tarea, o todas si es admin.
 * Las tareas internas de firma (Orion) no son parte del flujo de la solicitud y no se cuentan.
 */
export async function loadRequestFlows(
  pool: sql.ConnectionPool,
  ids: number[],
  viewer: { userId: string; isAdmin: boolean }
): Promise<Record<number, RequestFlow>> {
  const unique = Array.from(new Set(ids.filter((n) => Number.isInteger(n) && n > 0))).slice(0, FLOW_MAX_IDS);
  if (unique.length === 0) return {};

  const access = pool.request();
  access.input('userId', sql.NVarChar, viewer.userId);
  access.input('isAdmin', sql.Bit, viewer.isAdmin ? 1 : 0);
  const accessRows = await access.query<{ id: number }>(`
    SELECT rg.id
    FROM requests_general rg
    WHERE rg.id IN (${idParams(access, unique)})
      AND (
        @isAdmin = 1
        OR CAST(rg.id_requester AS NVARCHAR(64)) = @userId
        OR CAST(rg.[user] AS NVARCHAR(64)) = @userId
        OR EXISTS (
          SELECT 1 FROM task_request_general t
          WHERE t.id_request_general = rg.id AND CAST(t.id_assigned AS NVARCHAR(64)) = @userId
        )
      )
  `);
  const allowed = accessRows.recordset.map((r) => r.id);
  if (allowed.length === 0) return {};

  const templateReq = pool.request();
  const templateRows = await templateReq.query<{
    id_request: number;
    id: number;
    task: string;
    display_order: number | null;
    is_sequential: boolean | null;
  }>(`
    SELECT pcrg.id_request_general AS id_request, tpc.id, tpc.task, tpc.display_order, tpc.is_sequential
    FROM process_category_request_general pcrg
    INNER JOIN task_process_category tpc
      ON tpc.id_process_category = pcrg.id_process_category AND tpc.active = 1
    WHERE pcrg.id_request_general IN (${idParams(templateReq, allowed)})
      AND NOT ${orionSignatureTemplateSql('tpc')}
      AND (
        NOT EXISTS (SELECT 1 FROM task_condition_option tco WHERE tco.id_task = tpc.id)
        OR EXISTS (
          SELECT 1 FROM task_condition_option tco
          INNER JOIN request_form_value rfv ON rfv.id_option = tco.id_option
          WHERE tco.id_task = tpc.id AND rfv.id_request_general = pcrg.id_request_general
        )
      )
  `);

  const instReq = pool.request();
  const instanceRows = await instReq.query<{
    id_request: number;
    id_task: number;
    task: string;
    display_order: number | null;
    id_status: number | null;
    assigned: string | null;
  }>(`
    SELECT trg.id_request_general AS id_request, trg.id_task, tpc.task, tpc.display_order, trg.id_status,
      u.name AS assigned
    FROM task_request_general trg
    INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
    LEFT JOIN [user] u ON u.id = trg.id_assigned
    WHERE trg.id_request_general IN (${idParams(instReq, allowed)})
      AND NOT ${orionInternalTaskSql('trg', 'tpc')}
  `);

  const templates = new Map<number, FlowTemplateTask[]>();
  for (const r of templateRows.recordset) {
    const list = templates.get(r.id_request) ?? [];
    list.push({ id: r.id, task: r.task, displayOrder: r.display_order, isSequential: Boolean(r.is_sequential) });
    templates.set(r.id_request, list);
  }
  const instances = new Map<number, FlowTaskInstance[]>();
  for (const r of instanceRows.recordset) {
    const list = instances.get(r.id_request) ?? [];
    list.push({
      idTask: r.id_task,
      task: r.task,
      displayOrder: r.display_order,
      idStatus: r.id_status,
      assigned: r.assigned,
    });
    instances.set(r.id_request, list);
  }

  const out: Record<number, RequestFlow> = {};
  for (const id of allowed) {
    out[id] = buildRequestFlow(templates.get(id) ?? [], instances.get(id) ?? []);
  }
  return out;
}
