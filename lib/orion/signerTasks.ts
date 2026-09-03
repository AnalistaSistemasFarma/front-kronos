import 'server-only';
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
import {
  buildOrionFileTaskMarker,
  parseOrionFileIdFromResolution,
} from './signerAuthMarkers';

export {
  buildOrionFileTaskMarker,
  parseOrionFileIdFromResolution,
} from './signerAuthMarkers';

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

function normalizeSignerEmail(email?: string | null): string {
  return String(email || '').trim().toLowerCase();
}

function matchesOrionFileId(resolution: string | null | undefined, fileId?: string | null): boolean {
  const wanted = String(fileId || '').trim();
  if (!wanted) return true;
  const found = parseOrionFileIdFromResolution(resolution);
  // Tareas legacy sin marcador solo coinciden si no pedimos fileId específico... 
  // Si pedimos fileId, legacy sin marcador NO coincide (salvo un solo doc legacy).
  if (!found) return false;
  return found === wanted;
}

async function findOpenSignerTask(
  pool: SqlPool,
  requestId: number,
  templateTaskId: number,
  userId: string,
  fileId?: string | null
): Promise<number | null> {
  const result = await pool
    .request()
    .input('id_request', sql.Int, requestId)
    .input('id_task', sql.Int, templateTaskId)
    .input('id_user', sql.NVarChar(255), userId)
    .query(`
      SELECT id, resolution
      FROM task_request_general
      WHERE id_request_general = @id_request
        AND id_task = @id_task
        AND id_assigned = @id_user
        AND id_status NOT IN (2, 3)
      ORDER BY id DESC
    `);

  const wanted = String(fileId || '').trim();
  if (!wanted) {
    return result.recordset[0]?.id ?? null;
  }

  const exact = result.recordset.find((row) => matchesOrionFileId(row.resolution, wanted));
  if (exact) return exact.id;

  // Compat: una sola tarea abierta sin marcador → reutilizarla
  if (result.recordset.length === 1 && !parseOrionFileIdFromResolution(result.recordset[0].resolution)) {
    return result.recordset[0].id;
  }

  return null;
}

async function cancelOrphanSignerTasks(
  pool: SqlPool,
  requestId: number,
  templateTaskId: number,
  activeSignerEmails: Set<string>,
  fileId?: string | null
): Promise<number> {
  const open = await pool
    .request()
    .input('id_request', sql.Int, requestId)
    .input('id_task', sql.Int, templateTaskId)
    .query(`
      SELECT trg.id, trg.id_assigned, trg.resolution, u.email
      FROM task_request_general trg
      INNER JOIN [user] u ON u.id = trg.id_assigned
      WHERE trg.id_request_general = @id_request
        AND trg.id_task = @id_task
        AND trg.id_status NOT IN (2, 3)
    `);

  let count = 0;
  for (const row of open.recordset) {
    if (fileId && !matchesOrionFileId(row.resolution, fileId)) {
      // Sin marcador y hay fileId: solo cancelar huérfanos sin marcador si el email no está activo
      const hasMarker = Boolean(parseOrionFileIdFromResolution(row.resolution));
      if (hasMarker) continue;
    }

    const email = normalizeSignerEmail(row.email);
    if (!email || activeSignerEmails.has(email) || !row.id_assigned) continue;

    await closeSignerTask(
      pool,
      row.id,
      row.id_assigned,
      'Firmante removido de la asignación.',
      3
    );
    count += 1;
  }

  return count;
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
    fileId?: string | null;
    fileName?: string | null;
  }
): Promise<{ taskId: number; created: boolean } | null> {
  const existing = await findOpenSignerTask(
    pool,
    params.requestId,
    params.template.id,
    params.userId,
    params.fileId
  );
  if (existing) {
    // Asegura marcador de archivo en tareas legacy
    const marker = buildOrionFileTaskMarker(params.fileId);
    if (marker) {
      await pool
        .request()
        .input('id', sql.Int, existing)
        .input(
          'resolution',
          sql.NVarChar(sql.MAX),
          `${marker} Pendiente de firma${params.fileName ? `: ${params.fileName}` : ''}`
        )
        .query(`
          UPDATE task_request_general
          SET resolution = CASE
            WHEN resolution IS NULL OR resolution NOT LIKE '%[orionFile:%' THEN @resolution
            ELSE resolution
          END
          WHERE id = @id AND id_status NOT IN (2, 3)
        `);
    }
    return { taskId: existing, created: false };
  }

  const marker = buildOrionFileTaskMarker(params.fileId);
  const resolution = `${marker} Pendiente de firma${params.fileName ? `: ${params.fileName}` : ''}`.trim();

  const inserted = await pool
    .request()
    .input('id_request', sql.Int, params.requestId)
    .input('id_task', sql.Int, params.template.id)
    .input('id_user', sql.NVarChar(255), params.userId)
    .input('resolution', sql.NVarChar(sql.MAX), resolution || null)
    .query(`
      INSERT INTO task_request_general
      (id_request_general, id_task, id_status, id_assigned, resolution)
      OUTPUT INSERTED.id
      VALUES (@id_request, @id_task, 4, @id_user, @resolution)
    `);

  const taskId = inserted.recordset[0]?.id as number | undefined;
  if (!taskId) return null;

  try {
    await notifyActivityAssigned({
      taskId,
      userId: params.userId,
      requestId: params.requestId,
      subject: params.subject ?? undefined,
      taskName: params.fileName
        ? `${params.template.task} (${params.fileName})`
        : params.template.task,
    });
  } catch (err) {
    console.warn('[orion/signerTasks] No se pudo notificar actividad asignada:', err);
  }

  return { taskId, created: true };
}

export type SyncOrionSignerTasksResult = {
  tasksClosed: number;
  tasksOpened: number;
  currentSignerEmail: string | null;
  completedSigners: OrionSignerState[];
};

/**
 * Sincroniza task_request_general con el estado de firmantes de Orion.
 * Cada firmante de la solicitud recibe su propia tarea colaborativa en la misma solicitud.
 * El turno de firma lo controla Orion; las tareas en espera siguen visibles en Tareas asignadas.
 */
export async function syncOrionSignerTasks(
  pool: SqlPool,
  params: {
    requestId: number;
    state: OrionSignatureState;
    previousSigners?: OrionSignerState[] | null;
    subject?: string | null;
    documentStatus?: string | null;
    fileId?: string | null;
    fileName?: string | null;
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
  const hasDocument = Boolean(params.state.orionDocumentId);
  const shouldManageTasks =
    hasDocument && signers.length > 0 && !documentRejected && !documentFullySigned;
  const fileId = String(params.fileId || params.state.fileId || '').trim() || null;
  const fileName = params.fileName ?? params.state.fileName ?? null;
  const marker = buildOrionFileTaskMarker(fileId);

  const activeSignerEmails = new Set(
    signers
      .map((signer) => normalizeSignerEmail(signer.email))
      .filter(Boolean)
  );

  let tasksClosed = 0;
  let tasksOpened = 0;

  if (shouldManageTasks) {
    tasksClosed += await cancelOrphanSignerTasks(
      pool,
      params.requestId,
      template.id,
      activeSignerEmails,
      fileId
    );
  }

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
      const openTaskId = await findOpenSignerTask(
        pool,
        params.requestId,
        template.id,
        user.id,
        fileId
      );
      if (!openTaskId) continue;

      const resolution = isSignerRejected(signer.status) || documentRejected
        ? `${marker} Firma rechazada (${signer.name || email}).`.trim()
        : `${marker} Firma completada por ${signer.name || email}.`.trim();

      await closeSignerTask(
        pool,
        openTaskId,
        user.id,
        resolution,
        isSignerRejected(signer.status) || documentRejected ? 3 : 2
      );
      tasksClosed += 1;
      continue;
    }

    if (!shouldManageTasks) continue;

    const opened = await openSignerTask(pool, {
      requestId: params.requestId,
      template,
      userId: user.id,
      email: user.email,
      subject: params.subject,
      fileId,
      fileName,
    });

    if (opened?.created) tasksOpened += 1;
  }

  if (documentRejected) {
    tasksClosed += await cancelOpenSignerTasks(
      pool,
      params.requestId,
      `${marker} Documento rechazado en GSS Firma (Orion).`.trim(),
      fileId
    );
  }

  const currentSigner = getCurrentPendingSigner(signers);

  return {
    tasksClosed,
    tasksOpened,
    currentSignerEmail: currentSigner?.email ?? null,
    completedSigners,
  };
}

export async function cancelOpenSignerTasks(
  pool: SqlPool,
  requestId: number,
  resolution: string,
  fileId?: string | null
): Promise<number> {
  const template = await findOrionSignatureTaskTemplate(pool, requestId);
  if (!template) return 0;

  const open = await pool
    .request()
    .input('id_request', sql.Int, requestId)
    .input('id_task', sql.Int, template.id)
    .query(`
      SELECT id, id_assigned, resolution
      FROM task_request_general
      WHERE id_request_general = @id_request
        AND id_task = @id_task
        AND id_status NOT IN (2, 3)
    `);

  let count = 0;
  for (const row of open.recordset) {
    if (!row.id_assigned) continue;
    if (fileId && !matchesOrionFileId(row.resolution, fileId)) {
      const hasMarker = Boolean(parseOrionFileIdFromResolution(row.resolution));
      if (hasMarker) continue;
    }
    await closeSignerTask(pool, row.id, row.id_assigned, resolution, 3);
    count += 1;
  }
  return count;
}
