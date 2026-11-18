import sql from 'mssql';
import sqlConfig from '../../dbconfig.js';
import { checkAdminPrivileges } from '../access-control';
import { prisma } from '../prisma';

/**
 * Permisos de la tarea «Plantilla de documento».
 *  - Configurar: el mismo criterio que la configuración SAP de los flujos
 *    (app/api/workflow-sap/task-actions): administradores o el subproceso de flujos.
 *  - Emitir: el responsable de la tarea, el encargado del proceso o quien administra flujos.
 *  - Ver los documentos: además, el solicitante y quien tenga o haya tenido una tarea de la solicitud.
 */

const WORKFLOW_URLS = ['/process/request-general/workflows', '/process/request-general/admin-workflow'];

export async function canManageWorkflows(email: string): Promise<boolean> {
  if (await checkAdminPrivileges(email)) return true;
  const row = await prisma.subprocessUserCompany.findFirst({
    where: { companyUser: { user: { email } }, subprocess: { subprocess_url: { in: WORKFLOW_URLS } } },
    select: { id_subprocess_user_company: true },
  });
  return Boolean(row);
}

export async function userIdOf(email: string): Promise<string | null> {
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  return u?.id ?? null;
}

/** Tarea de la solicitud (instancia) con su plantilla; null si no es una tarea doc_template. */
export async function docTaskOf(idTaskRequest: number) {
  const pool = await sql.connect(sqlConfig);
  const r = await pool.request().input('id', sql.Int, idTaskRequest).query<{
    id: number;
    id_task: number;
    id_request_general: number;
    id_status: number;
    id_assigned: string | null;
    task: string;
    task_kind: string | null;
  }>(`
    SELECT trg.id, trg.id_task, trg.id_request_general, trg.id_status, trg.id_assigned, tpc.task, tpc.task_kind
    FROM task_request_general trg INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
    WHERE trg.id = @id;`);
  const row = r.recordset[0];
  return row && row.task_kind === 'doc_template' ? row : null;
}

async function isProcessManager(userId: string, idRequest: number): Promise<boolean> {
  const pool = await sql.connect(sqlConfig);
  const r = await pool.request().input('req', sql.Int, idRequest).input('u', sql.NVarChar(50), userId).query(`
    SELECT TOP 1 1 AS ok
    FROM process_category_request_general pcrg
    INNER JOIN user_process_category_request_general upcrg ON upcrg.id_process_category = pcrg.id_process_category
    WHERE pcrg.id_request_general = @req AND upcrg.id_user = @u;`);
  return r.recordset.length > 0;
}

export async function canEmitTask(email: string, task: { id_assigned: string | null; id_request_general: number }): Promise<boolean> {
  const userId = await userIdOf(email);
  if (!userId) return false;
  if (task.id_assigned && task.id_assigned === userId) return true;
  if (await isProcessManager(userId, task.id_request_general)) return true;
  return canManageWorkflows(email);
}

export async function canReadRequestDocuments(email: string, idRequest: number): Promise<boolean> {
  const userId = await userIdOf(email);
  if (!userId) return false;
  const pool = await sql.connect(sqlConfig);
  const r = await pool.request().input('req', sql.Int, idRequest).input('u', sql.NVarChar(50), userId).query(`
    SELECT TOP 1 1 AS ok FROM requests_general rg
    WHERE rg.id = @req AND (
      rg.id_requester = @u
      OR EXISTS (SELECT 1 FROM task_request_general t
                 WHERE t.id_request_general = rg.id AND (t.id_assigned = @u OR t.id_executor_final = @u)));`);
  if (r.recordset.length > 0) return true;
  if (await isProcessManager(userId, idRequest)) return true;
  return canManageWorkflows(email);
}

/** Proceso (flujo) de una tarea plantilla y las empresas del flujo. */
export async function taskProcessOf(idTask: number) {
  const pool = await sql.connect(sqlConfig);
  const r = await pool.request().input('t', sql.Int, idTask).query<{ id: number; task: string; task_kind: string | null; id_process_category: number }>(`
    SELECT id, task, task_kind, id_process_category FROM task_process_category WHERE id = @t;`);
  const task = r.recordset[0] ?? null;
  if (!task) return null;
  const c = await pool.request().input('p', sql.Int, task.id_process_category).query<{ id_company: number }>(`
    SELECT DISTINCT ccr.id_company
    FROM process_category pc
    INNER JOIN company_category_request ccr ON ccr.id_category_request = pc.id_category_request
    WHERE pc.id = @p;`);
  return { ...task, companies: c.recordset.map((x) => x.id_company) };
}
