import sql from 'mssql';
import { notifyActivityAssigned } from '../notificationEvents.js';
import type { OrionSignatureState, OrionSignerState } from './types';
import {
  allSignersCompleted,
  getCurrentPendingSigner,
  isSignerCompleted,
  isSignerRejected,
  newlyCompletedSigners,
  orderedSigners,
} from './signerStatus';

type SqlPool = import('mssql').ConnectionPool;

export type OrionSignatureTaskTemplate = {
  id: number;
  task: string;
  id_process_category: number;
  display_order: number | null;
  is_sequential: boolean;
};

export async function findUserIdByEmail(
  pool: SqlPool,
  email: string
): Promise<{ id: string; name: string | null; email: string } | null> {
  const normalized = String(email || '').trim();
  if (!normalized) return null;

  const result = await pool
    .request()
    .input('email', sql.NVarChar(255), normalized)
    .query(`
      SELECT TOP 1 id, name, email
      FROM [user]
      WHERE LOWER(LTRIM(RTRIM(email))) = LOWER(LTRIM(RTRIM(@email)))
    `);

  return result.recordset[0] ?? null;
}

export async function findOrionSignatureTaskTemplate(
  pool: SqlPool,
  requestId: number
): Promise<OrionSignatureTaskTemplate | null> {
  const result = await pool.request().input('id_request', sql.Int, requestId).query(`
    SELECT TOP 1
      tpc.id,
      tpc.task,
      tpc.id_process_category,
      tpc.display_order,
      tpc.is_sequential
    FROM process_category_request_general pcr
    INNER JOIN task_process_category tpc ON tpc.id_process_category = pcr.id_process_category
    WHERE pcr.id_request_general = @id_request
      AND tpc.active = 1
      AND (
        LOWER(tpc.task) LIKE '%firma%'
        OR LOWER(tpc.task) LIKE '%firmar%'
      )
    ORDER BY ISNULL(tpc.display_order, 0), tpc.id
  `);

  return result.recordset[0] ?? null;
}

async function findOpenSignerTask(
  pool: SqlPool,
  requestId: number,
  templateTaskId: number,
  userId: string
): Promise<number | null> {
  const result = await pool
    .request()
    .input('id_request', sql.Int, requestId)
    .input('id_task', sql.Int, templateTaskId)
    .input('id_user', sql.NVarChar(255), userId)
    .query(`
      SELECT TOP 1 id
      FROM task_request_general
      WHERE id_request_general = @id_request
        AND id_task = @id_task
        AND id_assigned = @id_user
        AND id_status NOT IN (2, 3)
      ORDER BY id DESC
    `);

  return result.recordset[0]?.id ?? null;
}

async function closeSignerTask(
  pool: SqlPool,
  taskId: number,
  userId: string,
  resolution: string,
  status: 2 | 3 = 2
): Promise<void> {
  await pool
    .request()
    .input('id', sql.Int, taskId)
    .input('id_status', sql.Int, status)
    .input('id_assigned', sql.NVarChar(255), userId)
    .input('resolution', sql.NVarChar(sql.MAX), resolution)
    .query(`
      UPDATE task_request_general
      SET id_status = @id_status,
          id_assigned = @id_assigned,
          resolution = @resolution,
          end_date = GETDATE(),
          date_resolution = GETDATE(),
          id_executor_final = @id_assigned
      WHERE id = @id
    `);
}

async function openSignerTask(
  pool: SqlPool,
  params: {
    requestId: number;
    template: OrionSignatureTaskTemplate;
    userId: string;
    email: string;
    subject?: string | null;
  }
): Promise<number | null> {
  const existing = await findOpenSignerTask(
    pool,
    params.requestId,
    params.template.id,
    params.userId
  );
  if (existing) return existing;

  const inserted = await pool
    .request()
    .input('id_request', sql.Int, params.requestId)
    .input('id_task', sql.Int, params.template.id)
    .input('id_user', sql.NVarChar(255), params.userId)
    .query(`
      INSERT INTO task_request_general
      (id_request_general, id_task, id_status, id_assigned)
      OUTPUT INSERTED.id
      VALUES (@id_request, @id_task, 4, @id_user)
    `);

  const taskId = inserted.recordset[0]?.id as number | undefined;
  if (!taskId) return null;

  try {
    await notifyActivityAssigned({
      taskId,
      userId: params.userId,
      requestId: params.requestId,
      subject: params.subject ?? undefined,
      taskName: params.template.task,
    });
  } catch (err) {
    console.warn('[orion/signerTasks] No se pudo notificar actividad asignada:', err);
  }

  return taskId;
}

export type SyncOrionSignerTasksResult = {
  tasksClosed: number;
  tasksOpened: number;
  currentSignerEmail: string | null;
  completedSigners: OrionSignerState[];
};

/**
 * Sincroniza task_request_general con el estado de firmantes de Orion.
 * Cada firmante pendiente recibe una tarea asignada; al firmar se cierra y se abre la del siguiente.
 */
export async function syncOrionSignerTasks(
  pool: SqlPool,
  params: {
    requestId: number;
    state: OrionSignatureState;
    previousSigners?: OrionSignerState[] | null;
    subject?: string | null;
    documentStatus?: string | null;
  }
): Promise<SyncOrionSignerTasksResult> {
  const template = await findOrionSignatureTaskTemplate(pool, params.requestId);
  if (!template) {
    console.warn(
      `[orion/signerTasks] Solicitud ${params.requestId}: no hay plantilla de tarea con "firma" en el proceso`
    );
    return { tasksClosed: 0, tasksOpened: 0, currentSignerEmail: null, completedSigners: [] };
  }

  const signers = orderedSigners(params.state.signers);
  if (signers.length === 0) {
    return { tasksClosed: 0, tasksOpened: 0, currentSignerEmail: null, completedSigners: [] };
  }

  const completedSigners = newlyCompletedSigners(params.previousSigners, signers);
  const statusUpper = String(params.documentStatus || params.state.status || '').toUpperCase();
  const documentRejected = statusUpper === 'RECHAZADO';
  const documentFullySigned =
    statusUpper === 'FIRMADO' || allSignersCompleted(signers);

  let tasksClosed = 0;
  let tasksOpened = 0;

  for (const signer of signers) {
    const email = String(signer.email || '').trim();
    if (!email) continue;

    const user = await findUserIdByEmail(pool, email);
    if (!user) {
      console.warn(`[orion/signerTasks] Firmante sin usuario SynerLink: ${email}`);
      continue;
    }

    const shouldClose =
      isSignerCompleted(signer.status) ||
      isSignerRejected(signer.status) ||
      documentRejected ||
      documentFullySigned;

    if (shouldClose) {
      const openTaskId = await findOpenSignerTask(pool, params.requestId, template.id, user.id);
      if (!openTaskId) continue;

      const resolution = isSignerRejected(signer.status) || documentRejected
        ? `Firma rechazada (${signer.name || email}).`
        : `Firma completada por ${signer.name || email}.`;

      await closeSignerTask(
        pool,
        openTaskId,
        user.id,
        resolution,
        isSignerRejected(signer.status) || documentRejected ? 3 : 2
      );
      tasksClosed += 1;
    }
  }

  if (documentRejected || documentFullySigned) {
    const current = getCurrentPendingSigner(signers);
    return {
      tasksClosed,
      tasksOpened,
      currentSignerEmail: current?.email ?? null,
      completedSigners,
    };
  }

  const currentSigner = getCurrentPendingSigner(signers);
  if (!currentSigner?.email) {
    return { tasksClosed, tasksOpened, currentSignerEmail: null, completedSigners };
  }

  const currentUser = await findUserIdByEmail(pool, currentSigner.email);
  if (!currentUser) {
    return {
      tasksClosed,
      tasksOpened,
      currentSignerEmail: currentSigner.email,
      completedSigners,
    };
  }

  const opened = await openSignerTask(pool, {
    requestId: params.requestId,
    template,
    userId: currentUser.id,
    email: currentUser.email,
    subject: params.subject,
  });

  if (opened) tasksOpened += 1;

  return {
    tasksClosed,
    tasksOpened,
    currentSignerEmail: currentSigner.email,
    completedSigners,
  };
}

export async function cancelOpenSignerTasks(
  pool: SqlPool,
  requestId: number,
  resolution: string
): Promise<number> {
  const template = await findOrionSignatureTaskTemplate(pool, requestId);
  if (!template) return 0;

  const open = await pool
    .request()
    .input('id_request', sql.Int, requestId)
    .input('id_task', sql.Int, template.id)
    .query(`
      SELECT id, id_assigned
      FROM task_request_general
      WHERE id_request_general = @id_request
        AND id_task = @id_task
        AND id_status NOT IN (2, 3)
    `);

  let count = 0;
  for (const row of open.recordset) {
    if (!row.id_assigned) continue;
    await closeSignerTask(pool, row.id, row.id_assigned, resolution, 3);
    count += 1;
  }
  return count;
}
