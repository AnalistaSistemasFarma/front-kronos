import 'server-only';
import sql from 'mssql';
import type { FirmaAuthTemplate } from './signerAuthorizations';
import type { OrionSignatureTaskTemplate } from './signerTasks';

type SqlPool = import('mssql').ConnectionPool;

const AUTH_TASK_NAME = 'Autorizar firma digital';
const SIGN_TASK_NAME = 'Firmar documento';
const AUTH_TYPE_NAME = 'Firma — Empleado';

async function resolveProcessCategoryId(
  pool: SqlPool,
  requestId: number
): Promise<number | null> {
  const pc = await pool
    .request()
    .input('id', sql.Int, requestId)
    .query(`
      SELECT TOP 1 id_process_category
      FROM process_category_request_general
      WHERE id_request_general = @id
      ORDER BY id
    `);
  const id = Number(pc.recordset[0]?.id_process_category);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function ensureFirmaAuthTypeId(pool: SqlPool): Promise<number | null> {
  const existing = await pool.request().input('name', sql.NVarChar(255), AUTH_TYPE_NAME).query(`
    SELECT TOP 1 id FROM types_authorization WHERE type_authorization = @name
  `);
  if (existing.recordset[0]?.id) return Number(existing.recordset[0].id);

  const inserted = await pool.request().input('name', sql.NVarChar(255), AUTH_TYPE_NAME).query(`
    INSERT INTO types_authorization (type_authorization)
    OUTPUT INSERTED.id
    VALUES (@name)
  `);
  const id = Number(inserted.recordset[0]?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function lookupAuthTemplate(
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

async function lookupSignTemplate(
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
      AND ISNULL(tpc.is_authorization, 0) = 0
      AND (
        LOWER(tpc.task) LIKE N'%firma%'
        OR LOWER(tpc.task) LIKE N'%firmar%'
      )
    ORDER BY ISNULL(tpc.display_order, 0), tpc.id
  `);
  return result.recordset[0] ?? null;
}

/**
 * En solicitudes normales (sin proceso FIRMA) asegura plantillas de:
 * - autorización is_authorization (notificación → Autorizaciones)
 * - tarea de firma (Tareas asignadas)
 */
export async function ensureOrionSignerWorkflowTemplates(
  pool: SqlPool,
  requestId: number
): Promise<{
  authTemplate: FirmaAuthTemplate | null;
  signTemplate: OrionSignatureTaskTemplate | null;
  created: { auth: boolean; sign: boolean };
}> {
  let authTemplate = await lookupAuthTemplate(pool, requestId);
  let signTemplate = await lookupSignTemplate(pool, requestId);
  const created = { auth: false, sign: false };

  if (authTemplate && signTemplate) {
    return { authTemplate, signTemplate, created };
  }

  const processId = await resolveProcessCategoryId(pool, requestId);
  if (!processId) {
    return { authTemplate, signTemplate, created };
  }

  if (!authTemplate) {
    const typeId = await ensureFirmaAuthTypeId(pool);
    if (typeId) {
      const existingAuth = await pool
        .request()
        .input('pc', sql.Int, processId)
        .input('task', sql.NVarChar(1000), AUTH_TASK_NAME)
        .query(`
          SELECT TOP 1 id, task
          FROM task_process_category
          WHERE id_process_category = @pc
            AND is_authorization = 1
            AND (
              LOWER(task) = LOWER(@task)
              OR LOWER(task) LIKE N'%autorizar firma%'
            )
          ORDER BY active DESC, id
        `);

      let authTaskId = Number(existingAuth.recordset[0]?.id);
      if (Number.isInteger(authTaskId) && authTaskId > 0) {
        await pool
          .request()
          .input('id', sql.Int, authTaskId)
          .input('typeId', sql.Int, typeId)
          .query(`
            UPDATE task_process_category
            SET active = 1,
                is_authorization = 1,
                type_authorization = @typeId
            WHERE id = @id
          `);
      } else {
        const inserted = await pool
          .request()
          .input('task', sql.NVarChar(1000), AUTH_TASK_NAME)
          .input('pc', sql.Int, processId)
          .input('typeId', sql.Int, typeId)
          .query(`
            INSERT INTO task_process_category
              (task, id_process_category, active, cost, is_sequential, display_order, is_authorization, type_authorization)
            OUTPUT INSERTED.id
            VALUES (@task, @pc, 1, 0, 0, 910, 1, @typeId)
          `);
        authTaskId = Number(inserted.recordset[0]?.id);
        created.auth = true;
      }

      if (Number.isInteger(authTaskId) && authTaskId > 0) {
        authTemplate = {
          id: authTaskId,
          task: AUTH_TASK_NAME,
          type_authorization: AUTH_TYPE_NAME,
        };
      }
    }
  }

  if (!signTemplate) {
    const existingSign = await pool
      .request()
      .input('pc', sql.Int, processId)
      .input('task', sql.NVarChar(1000), SIGN_TASK_NAME)
      .query(`
        SELECT TOP 1
          id, task, id_process_category, display_order, is_sequential
        FROM task_process_category
        WHERE id_process_category = @pc
          AND ISNULL(is_authorization, 0) = 0
          AND (
            LOWER(task) = LOWER(@task)
            OR LOWER(task) LIKE N'%firmar documento%'
            OR LOWER(task) LIKE N'%firma%'
          )
        ORDER BY
          CASE WHEN LOWER(task) LIKE N'%firmar documento%' THEN 0 ELSE 1 END,
          active DESC,
          id
      `);

    let signTaskId = Number(existingSign.recordset[0]?.id);
    if (Number.isInteger(signTaskId) && signTaskId > 0) {
      await pool
        .request()
        .input('id', sql.Int, signTaskId)
        .query(`
          UPDATE task_process_category
          SET active = 1, is_authorization = 0
          WHERE id = @id
        `);
      signTemplate = {
        id: signTaskId,
        task: String(existingSign.recordset[0]?.task || SIGN_TASK_NAME),
        id_process_category: Number(existingSign.recordset[0]?.id_process_category) || processId,
        display_order: existingSign.recordset[0]?.display_order ?? 920,
        is_sequential: Boolean(existingSign.recordset[0]?.is_sequential),
      };
    } else {
      const inserted = await pool
        .request()
        .input('task', sql.NVarChar(1000), SIGN_TASK_NAME)
        .input('pc', sql.Int, processId)
        .query(`
          INSERT INTO task_process_category
            (task, id_process_category, active, cost, is_sequential, display_order, is_authorization)
          OUTPUT INSERTED.id, INSERTED.task, INSERTED.id_process_category, INSERTED.display_order, INSERTED.is_sequential
          VALUES (@task, @pc, 1, 0, 0, 920, 0)
        `);
      const row = inserted.recordset[0];
      signTaskId = Number(row?.id);
      if (Number.isInteger(signTaskId) && signTaskId > 0) {
        created.sign = true;
        signTemplate = {
          id: signTaskId,
          task: String(row.task || SIGN_TASK_NAME),
          id_process_category: Number(row.id_process_category) || processId,
          display_order: row.display_order ?? 920,
          is_sequential: Boolean(row.is_sequential),
        };
      }
    }
  }

  if (!authTemplate) authTemplate = await lookupAuthTemplate(pool, requestId);
  if (!signTemplate) signTemplate = await lookupSignTemplate(pool, requestId);

  return { authTemplate, signTemplate, created };
}
