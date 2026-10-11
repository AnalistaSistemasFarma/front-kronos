import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { sql, withMssqlPool } from '../../../../lib/mssqlPool';
import { resolveUserIdByEmail } from '../../../../lib/request-general/dashboardAccess';
import {
  CLOSED_TASK_STATUS_IDS,
  SELF_APPROVAL_ERROR,
  buildReassignNote,
  isAuthorizationTask,
  isSignatureAuthorization,
  requestResponsibleSql,
} from '../../../../lib/request-general/workload';
import {
  fireAndForgetNotification,
  notifyActivityAssigned,
} from '../../../../lib/notificationEvents.js';

/**
 * Cambio individual del asignado de una tarea (task_request_general).
 * Regla (SynerLink c47, msg 16540): solo el RESPONSABLE DE LA SOLICITUD puede reasignar
 * sus tareas (ver lib/request-general/workload.ts). El actor sale de la sesión, no del cliente.
 * AUTORIZACIONES (c47 msg 16541): misma regla; además no se reasignan cerradas
 * (aprobadas/rechazadas), ni firmas/validaciones Orion, ni al creador de la solicitud
 * (anti-autoaprobación → 422). La reasignación queda en notes (bitácora).
 * GET ?id=<taskId> → { canReassign } para que la UI muestre u oculte el selector.
 */

const json = (body, status) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function sessionUserId() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const id = await resolveUserIdByEmail(session.user.email);
  return id ? String(id) : null;
}

async function loadTask(pool, taskId, userId) {
  const r = await pool
    .request()
    .input('id', sql.Int, taskId)
    .input('u', sql.NVarChar(255), userId)
    .query(`SELECT trg.id_request_general, rg.subject_request, sc.status, trg.id_status, trg.id_assigned, trg.resolution,
                   rg.id_requester, tpc.task, tpc.id_process_category, ISNULL(tpc.is_authorization, 0) AS is_authorization, taut.type_authorization,
                   CASE WHEN ${requestResponsibleSql('rg', '@u')} THEN 1 ELSE 0 END AS is_owner
            FROM task_request_general trg
            INNER JOIN requests_general rg ON rg.id = trg.id_request_general
            LEFT JOIN status_case sc ON sc.id_status_case = trg.id_status
            LEFT JOIN task_process_category tpc ON tpc.id = trg.id_task
            LEFT JOIN types_authorization taut ON taut.id = tpc.type_authorization
            WHERE trg.id = @id`);
  return r.recordset[0] ?? null;
}

export async function GET(req) {
  try {
    const userId = await sessionUserId();
    if (!userId) return json({ error: 'No autorizado' }, 401);
    const taskId = Number(new URL(req.url).searchParams.get('id'));
    if (!Number.isInteger(taskId) || taskId <= 0) return json({ error: 'id inválido' }, 400);
    const row = await withMssqlPool((pool) => loadTask(pool, taskId, userId));
    if (!row) return json({ error: 'Tarea no encontrada' }, 404);
    const isAuth = isAuthorizationTask(row);
    const blocked = isSignatureAuthorization(row) || (isAuth && CLOSED_TASK_STATUS_IDS.includes(Number(row.id_status)));
    return json({ canReassign: row.is_owner === 1 && !blocked, isAuthorization: isAuth }, 200);
  } catch (err) {
    console.error('[update-task-assigned] GET', err);
    return json({ error: 'Error del servidor' }, 500);
  }
}

export async function POST(req) {
  try {
    const userId = await sessionUserId();
    if (!userId) return json({ error: 'No autorizado' }, 401);

    const body = await req.json().catch(() => ({}));
    const id = Number(body?.id);
    const idAssigned = typeof body?.id_assigned === 'string' || typeof body?.id_assigned === 'number'
      ? String(body.id_assigned).trim()
      : '';
    if (!Number.isInteger(id) || id <= 0 || !idAssigned) return json({ error: 'Faltan campos obligatorios' }, 400);

    const result = await withMssqlPool(async (pool) => {
      const row = await loadTask(pool, id, userId);
      if (!row) return { status: 404, body: { error: 'Tarea no encontrada' } };
      if (row.is_owner !== 1)
        return { status: 403, body: { error: 'Solo el responsable de la solicitud puede reasignar sus tareas' } };
      // Autorizaciones (msg 16541): se reasignan, pero no las de firma/Orion (ligadas al
      // firmante) ni hacia el solicitante o el propio actor (autoaprobación).
      if (isSignatureAuthorization(row))
        return { status: 409, body: { error: 'Las autorizaciones de firma van ligadas al firmante y no se reasignan' } };
      if (isAuthorizationTask(row) && (String(row.id_requester ?? '').trim() === idAssigned || idAssigned === userId))
        return { status: 422, body: { error: SELF_APPROVAL_ERROR } };
      if (String(row.status || '').toLowerCase() === 'resuelto')
        return { status: 409, body: { error: 'No se puede modificar el asignado de una tarea resuelta' } };
      const isAuth = isAuthorizationTask(row);
      if (isAuth && CLOSED_TASK_STATUS_IDS.includes(Number(row.id_status)))
        return { status: 409, body: { error: 'La autorización ya fue aprobada, rechazada o cerrada; no se puede reasignar' } };
      if (isAuth && String(row.id_assigned ?? '') === idAssigned)
        return { status: 409, body: { error: 'La autorización ya está asignada a esa persona' } };

      const dest = await pool
        .request()
        .input('to', sql.NVarChar(255), idAssigned)
        .query('SELECT TOP 1 id, name FROM [user] WHERE id = @to AND isActive = 1');
      if (!dest.recordset.length) return { status: 422, body: { error: 'El nuevo asignado debe ser un usuario activo' } };

      if (!isAuth) {
        await pool
          .request()
          .input('id', sql.Int, id)
          .input('id_assigned', sql.NVarChar(255), idAssigned)
          .query('UPDATE task_request_general SET id_assigned = @id_assigned WHERE id = @id');
      } else {
        // Autorización: cambio condicionado (sigue abierta, mismo asignado, no al solicitante) + nota, atómico.
        const names = await pool
          .request()
          .input('a', sql.NVarChar(255), userId)
          .input('f', sql.NVarChar(255), row.id_assigned ?? '')
          .query('SELECT id, LTRIM(RTRIM(name)) AS name FROM [user] WHERE id IN (@a, @f)');
        const nameOf = (uid) => names.recordset.find((u) => u.id === uid)?.name ?? (uid || 'sin asignar');
        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
          const upd = await new sql.Request(tx)
            .input('id', sql.Int, id)
            .input('to', sql.NVarChar(255), idAssigned)
            .input('from', sql.NVarChar(255), row.id_assigned ?? null)
            .query(`UPDATE trg SET id_assigned = @to
                     FROM task_request_general trg
                     INNER JOIN requests_general rg ON rg.id = trg.id_request_general
                     WHERE trg.id = @id AND trg.id_status NOT IN (${CLOSED_TASK_STATUS_IDS.join(',')})
                       AND ((@from IS NULL AND trg.id_assigned IS NULL) OR trg.id_assigned = @from)
                       AND ISNULL(rg.id_requester, '') <> @to`);
          if (upd.rowsAffected[0] !== 1) throw new Error('CONFLICT');
          await new sql.Request(tx)
            .input('note', sql.NVarChar(sql.MAX), buildReassignNote({
              taskName: row.task ?? 'Autorización',
              taskId: id,
              fromName: nameOf(row.id_assigned),
              toName: dest.recordset[0].name?.trim() || idAssigned,
              actorName: nameOf(userId),
              isAuthorization: true,
            }))
            .input('req', sql.Int, row.id_request_general)
            .input('pc', sql.Int, row.id_process_category ?? null)
            .input('by', sql.NVarChar(255), userId)
            .query(`INSERT INTO notes (note, id_request, created_by, creation_date, id_process_category)
                     VALUES (@note, @req, @by, GETDATE(), @pc)`);
          await tx.commit();
        } catch (e) {
          await tx.rollback().catch(() => undefined);
          if (e.message === 'CONFLICT')
            return { status: 409, body: { error: 'La autorización cambió mientras la reasignabas; actualiza e intenta de nuevo' } };
          throw e;
        }
      }

      fireAndForgetNotification(
        notifyActivityAssigned({
          taskId: id,
          userId: idAssigned,
          requestId: row.id_request_general,
          subject: row.subject_request,
          taskName: row.task,
        })
      );
      return { status: 200, body: { success: true, message: 'Asignado actualizado correctamente' } };
    });
    return json(result.body, result.status);
  } catch (err) {
    console.error('[update-task-assigned] POST', err);
    return json({ error: 'Error del servidor' }, 500);
  }
}
