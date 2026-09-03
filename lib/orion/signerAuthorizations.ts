import 'server-only';
import sql from 'mssql';
import { buildAppUrl, resolveEmailByUserId } from '../notificationEvents.js';
import { createAndSendNotifications } from '../notifications.js';
import type { OrionSignerState } from './types';
import { findUserIdByEmail } from './signerTasks';
import { getCurrentPendingSigner, orderedSigners } from './signerStatus';
import {
  buildOrionAuthResolution,
  buildOrionFileTaskMarker,
  parseOrionFileIdFromResolution,
} from './signerAuthMarkers';

type SqlPool = import('mssql').ConnectionPool;

export type FirmaAuthTemplate = {
  id: number;
  task: string;
  type_authorization: string;
};

/** Plantilla de autorización FIRMA del proceso (preferencia Empleado / genérica). */
export async function findFirmaAuthorizationTemplate(
  pool: SqlPool,
  requestId: number
): Promise<FirmaAuthTemplate | null> {
  const result = await pool.request().input('id_request', sql.Int, requestId).query(`
    SELECT TOP 1
      tpc.id,
      tpc.task,
      tp.type_authorization
    FROM process_category_request_general pcr
    INNER JOIN task_process_category tpc ON tpc.id_process_category = pcr.id_process_category
    INNER JOIN types_authorization tp ON tp.id = tpc.type_authorization
    WHERE pcr.id_request_general = @id_request
      AND tpc.active = 1
      AND tpc.is_authorization = 1
      AND tpc.type_authorization IS NOT NULL
      AND (
        LOWER(tp.type_authorization) LIKE N'%firma%'
        OR LOWER(tpc.task) LIKE N'%firma%'
        OR LOWER(tpc.task) LIKE N'%autorizaci%'
      )
    ORDER BY
      CASE WHEN LOWER(tpc.task) LIKE N'%previa%' THEN 1 ELSE 0 END,
      CASE WHEN ISNULL(tpc.is_sequential, 0) = 0 THEN 0 ELSE 1 END,
      CASE
        WHEN LOWER(tp.type_authorization) LIKE N'%empleado%' THEN 0
        WHEN LOWER(tp.type_authorization) LIKE N'%aprobaci%' THEN 1
        ELSE 2
      END,
      ISNULL(tpc.display_order, 999),
      tpc.id
  `);

  return result.recordset[0] ?? null;
}

async function findExistingSignerAuth(
  pool: SqlPool,
  requestId: number,
  templateTaskId: number,
  userId: string,
  fileId: string
): Promise<number | null> {
  const result = await pool
    .request()
    .input('id_request', sql.Int, requestId)
    .input('id_task', sql.Int, templateTaskId)
    .input('id_user', sql.NVarChar(255), userId)
    .input('fileNeedle', sql.NVarChar(400), `[orionFile:${fileId}]`)
    .query(`
      SELECT TOP 1 id
      FROM task_request_general
      WHERE id_request_general = @id_request
        AND id_task = @id_task
        AND id_assigned = @id_user
        AND CHARINDEX(@fileNeedle, ISNULL(resolution, N'')) > 0
        AND CHARINDEX(N'[orionAuth]', ISNULL(resolution, N'')) > 0
      ORDER BY id DESC
    `);

  return result.recordset[0]?.id ?? null;
}

export type CreateOrionSignerAuthorizationsResult = {
  created: number;
  skipped: number;
  templateId: number | null;
  errors: string[];
};

/**
 * Tras "Enviar a firma" / avance de turno: crea autorización Kronos solo para el
 * firmante pendiente actual. El siguiente se crea al cerrar el turno anterior.
 *
 * Nota de producto: en la UI el firmante ve "Firmar" (no "Autorizar a sí mismo");
 * la auth se consume al iniciar la firma o desde /process/authorization.
 */
export async function createOrionSignerAuthorizations(
  pool: SqlPool,
  params: {
    requestId: number;
    fileId: string;
    fileName?: string | null;
    signers?: OrionSignerState[] | null;
    subject?: string | null;
    /** Solo el firmante pendiente actual (secuencial). Default true. */
    onlyCurrentTurn?: boolean;
  }
): Promise<CreateOrionSignerAuthorizationsResult> {
  const fileId = String(params.fileId || '').trim();
  if (!fileId) {
    return { created: 0, skipped: 0, templateId: null, errors: ['fileId vacío'] };
  }

  const template = await findFirmaAuthorizationTemplate(pool, params.requestId);
  if (!template) {
    return {
      created: 0,
      skipped: 0,
      templateId: null,
      errors: [
        'No hay plantilla de autorización FIRMA en el proceso. Configure una tarea is_authorization con tipo Firma — *.',
      ],
    };
  }

  const allSigners = Array.isArray(params.signers) ? params.signers : [];
  const onlyCurrent = params.onlyCurrentTurn !== false;
  let signers = allSigners;
  if (onlyCurrent) {
    const current = getCurrentPendingSigner(allSigners);
    signers = current ? [current] : [];
  }
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const signer of signers) {
    const email = String(signer.email || '').trim();
    if (!email) continue;

    const user = await findUserIdByEmail(pool, email);
    if (!user) {
      errors.push(`Firmante sin usuario SynerLink: ${email}`);
      continue;
    }

    const existing = await findExistingSignerAuth(
      pool,
      params.requestId,
      template.id,
      user.id,
      fileId
    );
    if (existing) {
      skipped += 1;
      continue;
    }

    const resolution = buildOrionAuthResolution({
      fileId,
      fileName: params.fileName,
      signerEmail: email,
    });

    const inserted = await pool
      .request()
      .input('id_request', sql.Int, params.requestId)
      .input('id_task', sql.Int, template.id)
      .input('id_user', sql.NVarChar(255), user.id)
      .input('resolution', sql.NVarChar(sql.MAX), resolution)
      .query(`
        INSERT INTO task_request_general
        (id_request_general, id_task, id_status, id_assigned, resolution)
        OUTPUT INSERTED.id
        VALUES (@id_request, @id_task, 4, @id_user, @resolution)
      `);

    const taskId = inserted.recordset[0]?.id as number | undefined;
    if (!taskId) {
      errors.push(`No se pudo crear autorización para ${email}`);
      continue;
    }

    created += 1;

    try {
      const emailAddr = await resolveEmailByUserId(user.id);
      if (emailAddr) {
        await createAndSendNotifications([emailAddr], {
          title: 'Autorizar firma · SynerLink',
          body: `Solicitud #${params.requestId}${
            params.fileName ? ` · ${params.fileName}` : ''
          }${params.subject ? ` — ${params.subject}` : ''}. Autorice para ver y firmar el documento.`,
          url: buildAppUrl('/process/authorization'),
          tag: `orion-auth-${taskId}`,
        });
      }
    } catch (err) {
      console.warn('[orion/signerAuthorizations] Notificación falló:', err);
    }
  }

  return { created, skipped, templateId: template.id, errors };
}

/** Abre autorización Kronos para el primer firmante pendiente que aún no tenga una (abierta o cerrada). */
export async function openNextOrionSignerAuthorization(
  pool: SqlPool,
  params: {
    requestId: number;
    fileId: string;
    fileName?: string | null;
    signers?: OrionSignerState[] | null;
    subject?: string | null;
  }
): Promise<CreateOrionSignerAuthorizationsResult> {
  const pending = orderedSigners(params.signers).filter((s) => {
    const status = String(s.status || '').toUpperCase();
    return !['FIRMADO', 'SIGNED', 'COMPLETED', 'RECHAZADO', 'REJECTED'].includes(status);
  });
  if (pending.length === 0) {
    return { created: 0, skipped: 0, templateId: null, errors: [] };
  }

  let last: CreateOrionSignerAuthorizationsResult = {
    created: 0,
    skipped: 0,
    templateId: null,
    errors: [],
  };
  for (const signer of pending) {
    last = await createOrionSignerAuthorizations(pool, {
      ...params,
      signers: [signer],
      onlyCurrentTurn: false,
    });
    if (last.created > 0) return last;
  }
  return last;
}

/** ¿El usuario tiene autorización FIRMA pendiente para este fileId? */
export async function userHasPendingOrionSignerAuth(
  pool: SqlPool,
  params: { requestId: number; userId: string; fileId: string }
): Promise<boolean> {
  const result = await pool
    .request()
    .input('id_request', sql.Int, params.requestId)
    .input('id_user', sql.NVarChar(255), params.userId)
    .input('fileNeedle', sql.NVarChar(400), `[orionFile:${params.fileId}]`)
    .query(`
      SELECT TOP 1 trg.id
      FROM task_request_general trg
      INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
      WHERE trg.id_request_general = @id_request
        AND trg.id_assigned = @id_user
        AND trg.id_status NOT IN (2, 3)
        AND tpc.is_authorization = 1
        AND CHARINDEX(@fileNeedle, ISNULL(trg.resolution, N'')) > 0
        AND CHARINDEX(N'[orionAuth]', ISNULL(trg.resolution, N'')) > 0
    `);

  return Boolean(result.recordset[0]);
}

/**
 * Cierra la autorización FIRMA pendiente del usuario para este PDF
 * (p. ej. al pulsar Firmar: no hace falta pasar por /process/authorization).
 */
export async function closePendingOrionSignerAuth(
  pool: SqlPool,
  params: { requestId: number; userId: string; fileId: string }
): Promise<{ closed: number }> {
  const fileId = String(params.fileId || '').trim();
  if (!fileId || !params.userId) return { closed: 0 };

  const result = await pool
    .request()
    .input('id_request', sql.Int, params.requestId)
    .input('id_user', sql.NVarChar(255), String(params.userId))
    .input('fileNeedle', sql.NVarChar(400), `[orionFile:${fileId}]`)
    .query(`
      SELECT trg.id, trg.resolution
      FROM task_request_general trg
      INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
      WHERE trg.id_request_general = @id_request
        AND trg.id_assigned = @id_user
        AND trg.id_status NOT IN (2, 3)
        AND tpc.is_authorization = 1
        AND CHARINDEX(@fileNeedle, ISNULL(trg.resolution, N'')) > 0
        AND CHARINDEX(N'[orionAuth]', ISNULL(trg.resolution, N'')) > 0
    `);

  let closed = 0;
  for (const row of result.recordset) {
    await pool
      .request()
      .input('id', sql.Int, row.id)
      .input('id_user', sql.NVarChar(255), String(params.userId))
      .input(
        'resolution',
        sql.NVarChar(sql.MAX),
        String(row.resolution || '').trim() ||
          `[orionFile:${fileId}][orionAuth] Autorización consumida al firmar`
      )
      .query(`
        UPDATE task_request_general
        SET id_status = 2,
            end_date = GETDATE(),
            date_resolution = GETDATE(),
            id_executor_final = @id_user,
            resolution = @resolution
        WHERE id = @id AND id_status NOT IN (2, 3)
      `);
    closed += 1;
  }
  return { closed };
}

/**
 * Cierra una autorización por id de tarea (sin gate secuencial).
 * El firmante puede verla por tipo/departamento aunque no esté en id_assigned.
 */
export async function closeAuthorizationTaskById(
  pool: SqlPool,
  params: { taskId: number; userId: string }
): Promise<{
  closed: boolean;
  requestId: number | null;
  fileId: string | null;
  resolution: string | null;
}> {
  const loaded = await pool
    .request()
    .input('id', sql.Int, params.taskId)
    .query(`
      SELECT
        trg.id,
        trg.id_request_general,
        trg.resolution,
        trg.id_status,
        tpc.is_authorization
      FROM task_request_general trg
      INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
      WHERE trg.id = @id
    `);

  const row = loaded.recordset[0];
      if (!row || !(Number(row.is_authorization) === 1 || row.is_authorization === true)) {
    return { closed: false, requestId: null, fileId: null, resolution: null };
  }
  if (Number(row.id_status) === 2 || Number(row.id_status) === 3) {
    return {
      closed: true,
      requestId: row.id_request_general ?? null,
      fileId: parseOrionFileIdFromResolution(row.resolution),
      resolution: row.resolution ?? null,
    };
  }

  const fileId = parseOrionFileIdFromResolution(row.resolution);
  await pool
    .request()
    .input('id', sql.Int, params.taskId)
    .input('id_user', sql.NVarChar(255), String(params.userId))
    .input(
      'resolution',
      sql.NVarChar(sql.MAX),
      String(row.resolution || '').trim() || '[orionAuth] Autorización consumida al firmar'
    )
    .query(`
      UPDATE task_request_general
      SET id_status = 2,
          id_assigned = @id_user,
          end_date = GETDATE(),
          start_date = COALESCE(start_date, GETDATE()),
          date_resolution = GETDATE(),
          id_executor_final = @id_user,
          resolution = @resolution
      WHERE id = @id AND id_status NOT IN (2, 3)
    `);

  return {
    closed: true,
    requestId: row.id_request_general ?? null,
    fileId,
    resolution: row.resolution ?? null,
  };
}

export async function findOpenOrionSignTaskId(
  pool: SqlPool,
  params: { requestId: number; userId: string; fileId?: string | null }
): Promise<number | null> {
  const fileMarker = params.fileId ? `[orionFile:${params.fileId}]` : null;
  const result = await pool
    .request()
    .input('id_request', sql.Int, params.requestId)
    .input('id_user', sql.NVarChar(255), String(params.userId))
    .input('fileMarker', sql.NVarChar(200), fileMarker)
    .query(`
      SELECT TOP 1 trg.id
      FROM task_request_general trg
      WHERE trg.id_request_general = @id_request
        AND trg.id_assigned = @id_user
        AND trg.id_status NOT IN (2, 3)
        AND CHARINDEX(N'[orionAuth]', ISNULL(trg.resolution, N'')) = 0
        AND (
          @fileMarker IS NULL
          OR CHARINDEX(@fileMarker, ISNULL(trg.resolution, N'')) > 0
          OR CHARINDEX(N'[orionFile:', ISNULL(trg.resolution, N'')) > 0
          OR CHARINDEX(N'Pendiente de firma', ISNULL(trg.resolution, N'')) > 0
        )
      ORDER BY
        CASE WHEN CHARINDEX(N'Pendiente de firma', ISNULL(trg.resolution, N'')) > 0 THEN 0 ELSE 1 END,
        trg.id DESC
    `);
  return result.recordset[0]?.id ?? null;
}
