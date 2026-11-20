import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { prisma } from '../../../../../lib/prisma';
import { sql, getPool } from '../../../../../lib/mssqlPool';
import { fireAndForgetNotification, notifyActivityAssigned } from '../../../../../lib/notificationEvents';

const TAG = '[reassignment-workflow-request/reassign]';
const MODULE_URL = '/process/request-general/reassignment-workflow-request';
const MODULE_NAME = 'Reasignación Flujos y Solicitudes';
const MAX_IDS = 1000;
const MAX_REASON = 500;
const OPEN_STATUSES = [1, 4, 5, 6, 7];
const OPEN_LIST = OPEN_STATUSES.join(', ');
const TIME_ZONE = 'America/Bogota';

const parseIds = (value) =>
  Array.isArray(value) ? [...new Set(value.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [];

const bindIds = (request, prefix, ids, type = sql.Int) =>
  ids
    .map((value, i) => {
      request.input(`${prefix}${i}`, type, value);
      return `@${prefix}${i}`;
    })
    .join(', ');

const fail = (error, status) => NextResponse.json({ error }, { status });

const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());

const formatDate = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

function parseReturnDate(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { error: 'Indica la fecha de retorno' };
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    return { error: 'La fecha de retorno no es válida' };
  }
  if (text <= todayIso()) return { error: 'La fecha de retorno debe ser posterior a hoy' };
  return { value: text };
}

const listLine = (label, items) =>
  items.length ? `${label} (${items.length}): ${items.join('; ')}` : `${label}: ninguna`;

function buildLogReason({ reason, fromName, toName, actorName, dateToReturn, workflows, requests, tasks }) {
  return [
    `Motivo: ${reason}`,
    `Reasignación de ${fromName || 'sin asignar'} a ${toName}, realizada por ${actorName}.`,
    dateToReturn ? `Retorno: se retornará el ${formatDate(dateToReturn)}.` : 'Retorno: sin retorno.',
    listLine('Flujos', workflows.map((w) => `#${w.id} ${w.process ?? ''}`.trim())),
    listLine('Solicitudes', requests.map((r) => `#${r.id} ${r.subject ?? ''}`.trim())),
    listLine('Tareas', tasks.map((t) => `#${t.id} ${t.task ?? ''} (solicitud #${t.id_request_general})`)),
  ].join('\n');
}

async function insertLog(transaction, { reason, actorId, userRemoved, userNew, dateToReturn }) {
  const res = await new sql.Request(transaction)
    .input('reason', sql.NVarChar(sql.MAX), reason)
    .input('by', sql.NVarChar(1000), actorId)
    .input('removed', sql.NVarChar(1000), userRemoved ?? null)
    .input('new', sql.NVarChar(1000), userNew)
    .input('ret', sql.Date, dateToReturn ?? null).query(`
      INSERT INTO workflow_task_reassignment (reason, created_by, user_removed, user_new, date_to_return, active)
      VALUES (@reason, @by, @removed, @new, @ret, 1);
      SELECT CAST(SCOPE_IDENTITY() AS int) AS id;
    `);
  return res.recordset?.[0]?.id ?? null;
}

export async function POST(req) {
  const session = await getServerSession(authOptions);
  const actorId = session?.user?.id != null ? String(session.user.id) : '';
  if (!actorId) return fail('No autorizado', 401);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return fail('Cuerpo inválido', 400);

  const mode = body.mode === 'person' ? 'person' : 'selected';
  const dryRun = mode === 'person' && body.dryRun === true;
  const toUserId = body.toUserId != null ? String(body.toUserId).trim() : '';
  const fromUserId = body.fromUserId != null ? String(body.fromUserId).trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, MAX_REASON) : '';

  const workflowIds = parseIds(body.workflowIds);
  const requestIds = parseIds(body.requestIds);
  const taskIds = parseIds(body.taskIds);

  if (mode === 'person') {
    if (!fromUserId) return fail('Selecciona la persona que entrega', 400);
    if (!dryRun && !toUserId) return fail('Selecciona la persona a la que se reasignará', 400);
    if (toUserId && toUserId === fromUserId) return fail('La persona que entrega y la que recibe deben ser distintas', 400);
  } else {
    if (!toUserId) return fail('Selecciona la persona a la que se reasignará', 400);
    if (workflowIds.length + requestIds.length + taskIds.length === 0) {
      return fail('No hay flujos, solicitudes ni tareas seleccionados', 400);
    }
    if ([workflowIds, requestIds, taskIds].some((ids) => ids.length > MAX_IDS)) {
      return fail(
        `Máximo ${MAX_IDS} elementos por tipo. Para mover todo lo de una persona usa «Todo de una persona».`,
        400
      );
    }
  }
  if (!dryRun && !reason) return fail('El motivo de la reasignación es obligatorio', 400);

  let dateToReturn = null;
  if (!dryRun && body.willReturn === true) {
    const parsed = parseReturnDate(body.dateToReturn);
    if (parsed.error) return fail(parsed.error, 400);
    dateToReturn = parsed.value;
  }

  const [grants, departmentRows] = await Promise.all([
    prisma.subprocessUserCompany.findMany({
      where: {
        companyUser: { id_user: actorId },
        subprocess: { OR: [{ subprocess_url: MODULE_URL }, { subprocess: MODULE_NAME }] },
      },
      select: { companyUser: { select: { id_company: true } } },
      take: 1,
    }),
    prisma.departmentUser.findMany({ where: { id_user: actorId }, select: { id_department: true } }),
  ]);
  if (grants.length === 0) return fail('No tienes permiso para reasignar en este módulo', 403);
  const departmentIds = [...new Set(departmentRows.map((d) => Number(d.id_department)))].filter(Number.isInteger);
  if (departmentIds.length === 0) return fail('No perteneces a ningún departamento', 403);

  let transaction;
  let committed = false;

  try {
    const pool = await getPool();

    const userReq = pool.request();
    userReq.input('toUserId', sql.NVarChar(255), toUserId || '');
    userReq.input('fromUserId', sql.NVarChar(255), fromUserId || '');
    userReq.input('actorId', sql.NVarChar(255), actorId);
    const deptList = bindIds(userReq, 'd', departmentIds);
    const users = (
      await userReq.query(`
        SELECT u.id, u.name,
          CASE WHEN EXISTS (
            SELECT 1 FROM department_user du
            WHERE du.id_user = u.id AND du.id_department IN (${deptList})
          ) THEN 1 ELSE 0 END AS in_scope
        FROM [user] u
        WHERE u.id IN (@toUserId, @fromUserId, @actorId)
      `)
    ).recordset;
    const findUser = (id) => users.find((u) => String(u.id) === id);
    const actorName = findUser(actorId)?.name || session.user.name || actorId;

    let target = null;
    if (toUserId) {
      target = findUser(toUserId);
      if (!target) return fail('La persona que recibe no existe', 404);
      if (!target.in_scope) return fail('La persona que recibe no pertenece a tu departamento', 403);
    }

    if (mode === 'person') {
      const source = findUser(fromUserId);
      if (!source) return fail('La persona que entrega no existe', 404);
      if (!source.in_scope) return fail('La persona que entrega no pertenece a tu departamento', 403);
      return await reassignPerson({ pool, source, target, actorId, actorName, reason, dryRun, dateToReturn });
    }

    const processes = new Map();
    if (workflowIds.length || requestIds.length) {
      const pReq = pool.request();
      const dl = bindIds(pReq, 'd', departmentIds);
      const sources = [];
      if (workflowIds.length) {
        sources.push(`
          SELECT pc.id, NULL AS id_request, NULL AS subject
          FROM process_category pc
          WHERE pc.id IN (${bindIds(pReq, 'w', workflowIds)})`);
      }
      if (requestIds.length) {
        sources.push(`
          SELECT pcrg.id_process_category AS id, pcrg.id_request_general AS id_request, rg.subject_request AS subject
          FROM process_category_request_general pcrg
          LEFT JOIN requests_general rg ON rg.id = pcrg.id_request_general
          WHERE pcrg.id_request_general IN (${bindIds(pReq, 'r', requestIds)})`);
      }
      const rows = await pReq.query(`
        SELECT src.id, src.id_request, src.subject, pc.process,
          CASE WHEN EXISTS (
            SELECT 1
            FROM user_process_category_request_general upf
            INNER JOIN department_user duf ON duf.id_user = upf.id_user
            WHERE upf.id_process_category = pc.id AND duf.id_department IN (${dl})
          ) THEN 1 ELSE 0 END AS in_scope
        FROM (${sources.join(' UNION ALL ')}) src
        INNER JOIN process_category pc ON pc.id = src.id
      `);

      if (rows.recordset.some((r) => !r.in_scope)) {
        return fail('Algunos flujos o solicitudes no pertenecen a tu departamento; no se cambió nada.', 403);
      }
      const foundWorkflows = new Set(rows.recordset.filter((r) => r.id_request == null).map((r) => Number(r.id)));
      const foundRequests = new Set(rows.recordset.filter((r) => r.id_request != null).map((r) => Number(r.id_request)));
      if (workflowIds.some((id) => !foundWorkflows.has(id)) || requestIds.some((id) => !foundRequests.has(id))) {
        return fail('Algunos flujos o solicitudes ya no existen. Actualiza el tablero e intenta de nuevo.', 404);
      }

      for (const r of rows.recordset) {
        const id = Number(r.id);
        const entry = processes.get(id) ?? { id, process: r.process, leaders: [], selected: false, requests: [] };
        if (r.id_request == null) entry.selected = true;
        else entry.requests.push({ id: Number(r.id_request), subject: r.subject });
        processes.set(id, entry);
      }

      const lReq = pool.request();
      const leaders = await lReq.query(`
        SELECT upc.id_process_category, upc.id_user, u.name
        FROM user_process_category_request_general upc
        LEFT JOIN [user] u ON u.id = upc.id_user
        WHERE upc.id_process_category IN (${bindIds(lReq, 'p', [...processes.keys()])})
      `);
      for (const l of leaders.recordset) {
        processes.get(Number(l.id_process_category))?.leaders.push({ id: String(l.id_user), name: l.name });
      }
    }

    let tasks = [];
    if (taskIds.length) {
      const tReq = pool.request();
      const dl = bindIds(tReq, 'd', departmentIds);
      tasks = (
        await tReq.query(`
          SELECT trg.id, trg.id_assigned, trg.id_status, trg.id_request_general, tpc.task,
                 rg.subject_request, pcrg.id_process_category, ua.name AS assigned_name,
                 CASE WHEN EXISTS (
                   SELECT 1 FROM department_user du
                   WHERE du.id_user = trg.id_assigned AND du.id_department IN (${dl})
                 ) THEN 1 ELSE 0 END AS in_scope
          FROM task_request_general trg
          INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
          LEFT JOIN requests_general rg ON rg.id = trg.id_request_general
          LEFT JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
          LEFT JOIN [user] ua ON ua.id = trg.id_assigned
          WHERE trg.id IN (${bindIds(tReq, 't', taskIds)})
        `)
      ).recordset;
      if (tasks.length !== taskIds.length) {
        return fail('Algunas tareas ya no existen. Actualiza el tablero e intenta de nuevo.', 404);
      }
      if (tasks.some((t) => !t.in_scope)) {
        return fail('Algunas tareas no están asignadas a personas de tu departamento; no se cambió nada.', 403);
      }
      if (tasks.some((t) => !OPEN_STATUSES.includes(Number(t.id_status)))) {
        return fail('Algunas tareas ya están cerradas y no se pueden reasignar. Actualiza el tablero.', 409);
      }
    }

    const groups = new Map();
    const groupOf = (id, name) => {
      const key = id ?? '';
      const g = groups.get(key) ?? { id: id ?? null, name: name ?? null, workflows: [], requests: [], tasks: [] };
      groups.set(key, g);
      return g;
    };
    for (const p of processes.values()) {
      const removed = p.leaders.filter((l) => l.id !== String(target.id));
      const owners = removed.length ? removed : [{ id: null, name: null }];
      for (const owner of owners) {
        const g = groupOf(owner.id, owner.name);
        if (p.selected) g.workflows.push(p);
        g.requests.push(...p.requests);
      }
    }
    for (const t of tasks) {
      const from = t.id_assigned != null ? String(t.id_assigned) : null;
      groupOf(from === String(target.id) ? null : from, t.assigned_name).tasks.push(t);
    }

    transaction = new sql.Transaction(pool);
    await transaction.begin();

    for (const p of processes.values()) {
      await new sql.Request(transaction)
        .input('id', sql.Int, p.id)
        .query(`DELETE FROM user_process_category_request_general WHERE id_process_category = @id`);
      await new sql.Request(transaction)
        .input('id', sql.Int, p.id)
        .input('to', sql.NVarChar(1000), toUserId)
        .query(`INSERT INTO user_process_category_request_general (id_process_category, id_user) VALUES (@id, @to)`);

      const leaderNames = p.leaders.map((l) => l.name).filter(Boolean).join(', ') || 'Sin asignar';
      const note = `Reasignación del líder del flujo «${p.process}»: de ${leaderNames} a ${target.name}. Realizada por ${actorName}. Motivo: ${reason}`;
      await new sql.Request(transaction)
        .input('note', sql.NVarChar(sql.MAX), note)
        .input('pc', sql.Int, p.id)
        .input('by', sql.NVarChar(255), actorId)
        .query(`INSERT INTO notes (note, id_process_category, created_by, creation_date) VALUES (@note, @pc, @by, GETDATE())`);
      for (const r of p.requests) {
        await new sql.Request(transaction)
          .input('note', sql.NVarChar(sql.MAX), note)
          .input('req', sql.Int, r.id)
          .input('pc', sql.Int, p.id)
          .input('by', sql.NVarChar(255), actorId)
          .query(`INSERT INTO notes (note, id_request, created_by, creation_date, id_process_category) VALUES (@note, @req, @by, GETDATE(), @pc)`);
      }
    }

    for (const t of tasks) {
      const update = await new sql.Request(transaction)
        .input('id', sql.Int, t.id)
        .input('to', sql.NVarChar(255), toUserId)
        .input('from', sql.NVarChar(255), t.id_assigned)
        .query(`UPDATE task_request_general SET id_assigned = @to WHERE id = @id AND id_assigned = @from`);
      if (update.rowsAffected[0] !== 1) {
        throw Object.assign(new Error('CONFLICT'), { taskId: t.id });
      }
      await new sql.Request(transaction)
        .input(
          'note',
          sql.NVarChar(sql.MAX),
          `Se reasigna la tarea «${t.task}» de ${t.assigned_name || 'sin asignar'} a ${target.name}. Realizada por ${actorName}. Motivo: ${reason}`
        )
        .input('req', sql.Int, t.id_request_general)
        .input('pc', sql.Int, t.id_process_category ?? null)
        .input('by', sql.NVarChar(255), actorId)
        .query(`INSERT INTO notes (note, id_request, created_by, creation_date, id_process_category) VALUES (@note, @req, @by, GETDATE(), @pc)`);
    }

    const logIds = [];
    for (const g of groups.values()) {
      logIds.push(
        await insertLog(transaction, {
          reason: buildLogReason({
            reason,
            fromName: g.name,
            toName: target.name,
            actorName,
            dateToReturn,
            workflows: g.workflows,
            requests: g.requests,
            tasks: g.tasks,
          }),
          actorId,
          userRemoved: g.id,
          userNew: toUserId,
          dateToReturn,
        })
      );
    }

    await transaction.commit();
    committed = true;

    notifyTasks(tasks, toUserId);

    const result = {
      workflows: processes.size,
      requests: requestIds.length,
      tasks: tasks.length,
    };
    console.log(`${TAG} ${actorId} reasignó (seleccionados) a ${toUserId}:`, result, 'registros:', logIds);
    return NextResponse.json({ success: true, reassigned: result, logIds }, { status: 200 });
  } catch (err) {
    if (transaction && !committed) {
      await transaction.rollback().catch((e) => console.error(`${TAG} Error en rollback:`, e));
    }
    if (err?.message === 'CONFLICT') {
      return fail('Una tarea cambió mientras reasignabas; no se cambió nada. Actualiza e intenta de nuevo.', 409);
    }
    console.error(`${TAG} Error:`, err);
    return fail('Error al reasignar', 500);
  }
}

function notifyTasks(tasks, toUserId) {
  for (const t of tasks) {
    fireAndForgetNotification(
      notifyActivityAssigned({
        taskId: t.id,
        userId: toUserId,
        requestId: t.id_request_general,
        subject: t.subject_request,
        taskName: t.task,
      })
    );
  }
}

async function reassignPerson({ pool, source, target, actorId, actorName, reason, dryRun, dateToReturn }) {
  const fromId = String(source.id);

  const countReq = pool.request();
  countReq.input('from', sql.NVarChar(255), fromId);
  const counts = (
    await countReq.query(`
      SELECT
        (SELECT COUNT(DISTINCT upc.id_process_category)
           FROM user_process_category_request_general upc
          WHERE upc.id_user = @from) AS workflows,
        (SELECT COUNT(DISTINCT rg.id)
           FROM requests_general rg
           INNER JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
          WHERE rg.status_req IN (${OPEN_LIST})
            AND pcrg.id_process_category IN (
              SELECT id_process_category FROM user_process_category_request_general WHERE id_user = @from
            )) AS requests,
        (SELECT COUNT(*)
           FROM task_request_general trg
          WHERE trg.id_assigned = @from AND trg.id_status IN (${OPEN_LIST})) AS tasks
    `)
  ).recordset[0];
  const summary = {
    workflows: Number(counts?.workflows ?? 0),
    requests: Number(counts?.requests ?? 0),
    tasks: Number(counts?.tasks ?? 0),
  };

  if (dryRun) {
    return NextResponse.json({ success: true, dryRun: true, from: source.name, preview: summary }, { status: 200 });
  }
  if (summary.workflows + summary.tasks === 0) {
    return fail(`${source.name} no tiene flujos ni tareas abiertas para reasignar`, 409);
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  const q = () =>
    new sql.Request(transaction)
      .input('from', sql.NVarChar(255), fromId)
      .input('to', sql.NVarChar(255), String(target.id))
      .input('fromName', sql.NVarChar(255), source.name)
      .input('toName', sql.NVarChar(255), target.name)
      .input('actorName', sql.NVarChar(255), actorName)
      .input('reason', sql.NVarChar(sql.MAX), reason)
      .input('by', sql.NVarChar(255), actorId);

  try {
    const flowRows = (
      await q().query(`
        SELECT pc.id, pc.process
        FROM process_category pc
        WHERE pc.id IN (SELECT id_process_category FROM user_process_category_request_general WHERE id_user = @from)
        ORDER BY pc.process
      `)
    ).recordset;
    const requestRows = (
      await q().query(`
        SELECT DISTINCT rg.id, rg.subject_request AS subject
        FROM requests_general rg
        INNER JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
        WHERE rg.status_req IN (${OPEN_LIST})
          AND pcrg.id_process_category IN (
            SELECT id_process_category FROM user_process_category_request_general WHERE id_user = @from
          )
        ORDER BY rg.id
      `)
    ).recordset;
    const toMove = (
      await q().query(`
        SELECT trg.id, trg.id_request_general, tpc.task, rg.subject_request
        FROM task_request_general trg WITH (UPDLOCK, HOLDLOCK)
        INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
        LEFT JOIN requests_general rg ON rg.id = trg.id_request_general
        WHERE trg.id_assigned = @from AND trg.id_status IN (${OPEN_LIST})
        ORDER BY trg.id
      `)
    ).recordset;

    await q().query(`
      INSERT INTO notes (note, id_process_category, created_by, creation_date)
      SELECT CONCAT(N'Reasignación del líder del flujo «', pc.process, N'»: de ', @fromName, N' a ', @toName,
                    N'. Realizada por ', @actorName, N'. Motivo: ', @reason),
             pc.id, @by, GETDATE()
      FROM process_category pc
      WHERE pc.id IN (SELECT id_process_category FROM user_process_category_request_general WHERE id_user = @from)
    `);
    await q().query(`
      INSERT INTO notes (note, id_request, created_by, creation_date, id_process_category)
      SELECT CONCAT(N'La solicitud pasa a cargo de ', @toName, N' (antes ', @fromName, N') por reasignación del flujo «',
                    pc.process, N'». Realizada por ', @actorName, N'. Motivo: ', @reason),
             rg.id, @by, GETDATE(), pc.id
      FROM requests_general rg
      INNER JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
      INNER JOIN process_category pc ON pc.id = pcrg.id_process_category
      WHERE rg.status_req IN (${OPEN_LIST})
        AND pc.id IN (SELECT id_process_category FROM user_process_category_request_general WHERE id_user = @from)
    `);
    await q().query(`
      INSERT INTO notes (note, id_request, created_by, creation_date, id_process_category)
      SELECT CONCAT(N'Se reasigna la tarea «', tpc.task, N'» de ', @fromName, N' a ', @toName,
                    N'. Realizada por ', @actorName, N'. Motivo: ', @reason),
             trg.id_request_general, @by, GETDATE(), pcrg.id_process_category
      FROM task_request_general trg
      INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
      LEFT JOIN process_category_request_general pcrg ON pcrg.id_request_general = trg.id_request_general
      WHERE trg.id_assigned = @from AND trg.id_status IN (${OPEN_LIST})
    `);

    await q().query(`
      DELETE FROM user_process_category_request_general
      WHERE id_user = @from
        AND id_process_category IN (
          SELECT id_process_category FROM user_process_category_request_general WHERE id_user = @to
        )
    `);
    const flows = await q().query(`
      UPDATE user_process_category_request_general SET id_user = @to WHERE id_user = @from
    `);

    await q().query(`
      UPDATE task_request_general SET id_assigned = @to
      WHERE id_assigned = @from AND id_status IN (${OPEN_LIST})
    `);

    const logId = await insertLog(transaction, {
      reason: buildLogReason({
        reason,
        fromName: source.name,
        toName: target.name,
        actorName,
        dateToReturn,
        workflows: flowRows,
        requests: requestRows,
        tasks: toMove,
      }),
      actorId,
      userRemoved: fromId,
      userNew: String(target.id),
      dateToReturn,
    });

    await transaction.commit();

    notifyTasks(toMove, String(target.id));

    const result = { workflows: flowRows.length, requests: requestRows.length, tasks: toMove.length };
    console.log(
      `${TAG} ${actorId} reasignó todo de ${fromId} a ${target.id}:`,
      result,
      `filas líder: ${flows.rowsAffected[0]}, registro: ${logId}`
    );
    return NextResponse.json({ success: true, reassigned: result, logIds: [logId] }, { status: 200 });
  } catch (err) {
    await transaction.rollback().catch((e) => console.error(`${TAG} Error en rollback:`, e));
    throw err;
  }
}
