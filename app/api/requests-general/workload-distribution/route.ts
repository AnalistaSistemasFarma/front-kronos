import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { sql, withMssqlPool } from '../../../../lib/mssqlPool';
import { resolveUserIdByEmail } from '../../../../lib/request-general/dashboardAccess';
import {
  fireAndForgetNotification,
  notifyActivityAssigned,
} from '../../../../lib/notificationEvents.js';
import {
  CLOSED_TASK_STATUS_IDS,
  buildReassignNote,
  computeWorkload,
  isAuthorizationTask,
  isResponsible,
  isTaskReassignable,
  isSignatureAuthorization,
  requestResponsibleSql,
  validateReassignRequest,
  type ReassignScope,
  type WorkloadTask,
} from '../../../../lib/request-general/workload';

/**
 * Distribución de carga de tareas para el RESPONSABLE DE LA SOLICITUD.
 * GET  → delegados de su departamento, % de carga y tareas abiertas (todos los procesos);
 *        solo las tareas de solicitudes de las que es responsable son reasignables
 *        (incluidas las autorizaciones, SynerLink c47 msg 16541; nunca al solicitante: 422).
 * POST { taskIds, toUserId, reason? } → reasignación masiva en una sola transacción.
 * Reglas en lib/request-general/workload.ts. Todo se valida con la sesión, no con el cliente.
 */

const CLOSED_LIST = CLOSED_TASK_STATUS_IDS.join(',');
const OWNS_RG = requestResponsibleSql('rg', '@u');

type Pool = Parameters<Parameters<typeof withMssqlPool>[0]>[0];

interface Member {
  id: string;
  name: string;
  email: string | null;
  isActive: boolean;
}

async function loadScope(pool: Pool, userId: string) {
  const owned = await pool
    .request()
    .input('u', sql.NVarChar(255), userId)
    .query(`SELECT DISTINCT rg.id AS id
             FROM requests_general rg
             INNER JOIN task_request_general trg ON trg.id_request_general = rg.id
             INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
             WHERE trg.id_status NOT IN (${CLOSED_LIST})
               AND ${OWNS_RG}`);
  const departments = await pool
    .request()
    .input('u', sql.NVarChar(255), userId)
    .query(`SELECT DISTINCT d.id_department AS id, d.department AS name
             FROM department_user du INNER JOIN department d ON d.id_department = du.id_department
             WHERE du.id_user = @u`);
  const members = departments.recordset.length
    ? await pool
        .request()
        .input('u', sql.NVarChar(255), userId)
        .query(`SELECT DISTINCT u.id, LTRIM(RTRIM(u.name)) AS name, u.email, CAST(u.isActive AS bit) AS isActive
                 FROM department_user du
                 INNER JOIN [user] u ON u.id = du.id_user
                 WHERE du.id_department IN (SELECT id_department FROM department_user WHERE id_user = @u)`)
    : { recordset: [] as Member[] };
  const all = members.recordset as Member[];
  const active = all.filter((m) => m.isActive);
  const scope: ReassignScope = {
    actorId: userId,
    ownedRequestIds: owned.recordset.map((r: { id: number }) => Number(r.id)),
    delegateIds: active.map((m) => m.id),
  };
  return { scope, members: active, departments: departments.recordset as { id: number; name: string }[] };
}

async function sessionUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const id = await resolveUserIdByEmail(session.user.email);
  return id ? { id: String(id), name: session.user.name ?? session.user.email } : null;
}

const TASK_SELECT = `
  SELECT trg.id, trg.id_assigned, trg.id_status, sc.status AS status_task, trg.start_date,
         tpc.task, tpc.id_process_category, ISNULL(tpc.is_authorization, 0) AS is_authorization,
         taut.type_authorization, trg.resolution, rg.id_requester,
         pc.process, cr.category, rg.id AS id_request_general, rg.subject_request, rg.created_at,
         c.company
  FROM task_request_general trg
  INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
  LEFT JOIN types_authorization taut ON taut.id = tpc.type_authorization
  LEFT JOIN process_category pc ON pc.id = tpc.id_process_category
  LEFT JOIN category_request cr ON cr.id = pc.id_category_request
  LEFT JOIN status_case sc ON sc.id_status_case = trg.id_status
  LEFT JOIN requests_general rg ON rg.id = trg.id_request_general
  LEFT JOIN company c ON c.id_company = rg.id_company`;

export async function GET() {
  try {
    const user = await sessionUser();
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const data = await withMssqlPool(async (pool) => {
      const { scope, members, departments } = await loadScope(pool, user.id);
      if (!isResponsible(scope)) return { isResponsible: false as const };

      const req = pool.request();
      members.forEach((m, i) => req.input(`m${i}`, sql.NVarChar(255), m.id));
      const inList = members.map((_, i) => `@m${i}`).join(',');
      const tasks = await req.query(
        `${TASK_SELECT} WHERE trg.id_assigned IN (${inList}) AND trg.id_status NOT IN (${CLOSED_LIST})
         ORDER BY trg.id DESC`
      );
      const rows = (tasks.recordset as (WorkloadTask & Record<string, unknown>)[]).map(({ resolution: _r, type_authorization: _ta, ...t }) => {
        const full = { ...t, resolution: _r as string | null, type_authorization: _ta as string | null };
        return {
          ...t,
          is_authorization: Boolean(t.is_authorization),
          is_signature: isSignatureAuthorization(full),
          reassignable: isTaskReassignable(scope, full),
        };
      });
      const load = computeWorkload(members, rows);
      return {
        isResponsible: true as const,
        actorId: user.id,
        departments,
        ownedRequestCount: scope.ownedRequestIds.length,
        total: load.total,
        members: load.members.map(({ id, name, email, openTasks, percent }) => ({ id, name, email, openTasks, percent })),
        tasks: rows,
      };
    });
    return NextResponse.json(data, { status: 200 });
  } catch (err) {
    console.error('[workload-distribution] GET', err);
    return NextResponse.json({ error: 'No se pudo calcular la carga del área' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await sessionUser();
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    const body = (await req.json().catch(() => ({}))) as { taskIds?: unknown; toUserId?: unknown; reason?: unknown };
    const reason = typeof body.reason === 'string' ? body.reason : null;

    const result = await withMssqlPool(async (pool) => {
      const { scope, members } = await loadScope(pool, user.id);
      const ids = Array.isArray(body.taskIds)
        ? [...new Set(body.taskIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 500)
        : [];
      const r = pool.request();
      ids.forEach((id, i) => r.input(`t${i}`, sql.Int, id));
      const found = ids.length
        ? ((await r.query(`${TASK_SELECT} WHERE trg.id IN (${ids.map((_, i) => `@t${i}`).join(',')})`))
            .recordset as (WorkloadTask & { task: string; id_request_general: number; subject_request: string })[])
        : [];
      const byId = new Map(found.map((t) => [Number(t.id), t]));
      const v = validateReassignRequest(scope, { taskIds: body.taskIds, toUserId: body.toUserId }, byId, scope.delegateIds);
      if (!v.ok) return v;

      const names = new Map(members.map((m) => [m.id, m.name]));
      const toUserId = String(body.toUserId).trim();
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        for (const id of v.taskIds) {
          const t = byId.get(id)!;
          const isAuth = isAuthorizationTask(t);
          const upd = await new sql.Request(tx)
            .input('id', sql.Int, id)
            .input('to', sql.NVarChar(255), toUserId)
            .input('from', sql.NVarChar(255), t.id_assigned)
            .input('u', sql.NVarChar(255), user.id)
            .query(`UPDATE task_request_general SET id_assigned = @to
                     WHERE id = @id AND id_assigned = @from AND id_status NOT IN (${CLOSED_LIST})
                       AND EXISTS (SELECT 1 FROM requests_general rg
                                   WHERE rg.id = task_request_general.id_request_general AND ${OWNS_RG}
                                     -- anti-autoaprobación: una autorización nunca va a quien creó la solicitud
                                     AND NOT (${isAuth ? 1 : 0} = 1 AND rg.id_requester = @to))`);
          if (upd.rowsAffected[0] !== 1) throw Object.assign(new Error('CONFLICT'), { taskId: id });
          await new sql.Request(tx)
            .input('note', sql.NVarChar(sql.MAX), buildReassignNote({
              taskName: t.task,
              taskId: id,
              fromName: names.get(t.id_assigned ?? '') ?? String(t.id_assigned),
              toName: names.get(toUserId) ?? toUserId,
              actorName: names.get(user.id) ?? user.name,
              reason,
              isAuthorization: isAuth,
            }))
            .input('req', sql.Int, t.id_request_general)
            .input('pc', sql.Int, t.id_process_category)
            .input('by', sql.NVarChar(255), user.id)
            .query(`INSERT INTO notes (note, id_request, created_by, creation_date, id_process_category)
                     VALUES (@note, @req, @by, GETDATE(), @pc)`);
        }
        await tx.commit();
      } catch (e) {
        await tx.rollback().catch(() => undefined);
        if ((e as Error).message === 'CONFLICT')
          return { ok: false as const, status: 409, error: 'Una tarea cambió mientras reasignabas; no se cambió ninguna. Actualiza e intenta de nuevo.' };
        throw e;
      }

      for (const id of v.taskIds) {
        const t = byId.get(id)!;
        fireAndForgetNotification(
          notifyActivityAssigned({ taskId: id, userId: toUserId, requestId: t.id_request_general, subject: t.subject_request, taskName: t.task })
        );
      }
      return { ok: true as const, reassigned: v.taskIds.length };
    });

    if (!result.ok) {
      const { status, ...rest } = result;
      return NextResponse.json(rest, { status });
    }
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error('[workload-distribution] POST', err);
    return NextResponse.json({ error: 'No se pudo reasignar' }, { status: 500 });
  }
}
