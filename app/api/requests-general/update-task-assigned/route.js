import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { sql, withMssqlPool } from '../../../../lib/mssqlPool';
import { resolveUserIdByEmail } from '../../../../lib/request-general/dashboardAccess';
import {
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
    .query(`SELECT trg.id_request_general, rg.subject_request, sc.status, trg.id_assigned, trg.resolution,
                   rg.id_requester, tpc.task, ISNULL(tpc.is_authorization, 0) AS is_authorization, taut.type_authorization,
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
    return json({ canReassign: row.is_owner === 1 && !isSignatureAuthorization(row) }, 200);
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
        return { status: 422, body: { error: 'Una autorización no puede asignarse al solicitante ni a quien reasigna (autoaprobación)' } };
      if (String(row.status || '').toLowerCase() === 'resuelto')
        return { status: 409, body: { error: 'No se puede modificar el asignado de una tarea resuelta' } };

      const dest = await pool
        .request()
        .input('to', sql.NVarChar(255), idAssigned)
        .query('SELECT TOP 1 id FROM [user] WHERE id = @to AND isActive = 1');
      if (!dest.recordset.length) return { status: 422, body: { error: 'El nuevo asignado debe ser un usuario activo' } };

      await pool
        .request()
        .input('id', sql.Int, id)
        .input('id_assigned', sql.NVarChar(255), idAssigned)
        .query('UPDATE task_request_general SET id_assigned = @id_assigned WHERE id = @id');

      fireAndForgetNotification(
        notifyActivityAssigned({
          taskId: id,
          userId: idAssigned,
          requestId: row.id_request_general,
          subject: row.subject_request,
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
