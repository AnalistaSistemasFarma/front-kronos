import { sql, getPool } from '../mssqlPool';
import { fireAndForgetNotification, notifyActivityAssigned } from '../notificationEvents';
import { TEMPLATE_ITEM } from './reassignmentDelegation';

const TAG = '[reassignment-revert]';
export const REVERT_MAX_REASON = 500;
const OPEN_STATUSES = [1, 4, 5, 6, 7];
const OPEN_LIST = OPEN_STATUSES.join(', ');
const CHUNK = 1000;

const splitUsers = (value) => (value ? String(value).split(',').filter(Boolean) : []);
const userList = (ids) => [...new Set(ids.filter((v) => v != null && v !== '').map(String))].sort().join(',');

const chunks = (list, size = CHUNK) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

const bindIds = (request, prefix, ids, type = sql.Int) =>
  ids
    .map((value, i) => {
      request.input(`${prefix}${i}`, type, value);
      return `@${prefix}${i}`;
    })
    .join(', ');

async function queryByChunks(newRequest, ids, build, type = sql.Int) {
  const rows = [];
  for (const part of chunks(ids)) {
    const request = newRequest();
    const res = await request.query(build(bindIds(request, 'x', part, type)));
    rows.push(...(res.recordset ?? []));
  }
  return rows;
}

const failure = (status, error, extra = {}) => ({ ok: false, status, error, ...extra });

/**
 * @param {object} args
 * @param {number} args.id                 Registro de workflow_task_reassignment.
 * @param {string} args.actorId            Quien deshace (usuario de la sesión o usuario sistema).
 * @param {string} [args.actorName]        Nombre para notas (si falta, se busca en [user]).
 * @param {string} args.reason             Motivo (obligatorio salvo dryRun).
 * @param {boolean} [args.dryRun]          Solo vista previa.
 * @param {number[]|null} args.departmentIds  Departamentos de quien deshace (manual). null = job del
 *                                         programador: sin chequeo de alcance; la regla «la persona
 *                                         sigue en el departamento» usa los departamentos de quien
 *                                         hizo la reasignación.
 * @param {'manual'|'auto'} [args.origin]
 * @param {boolean} [args.closeIfNothing]  Si no hay nada que devolver, igual cierra el registro
 *                                         (solo el job, para no reintentarlo cada día).
 * @returns {Promise<{ok: true, isReturn: boolean, preview?: object, reverted?: object, skipped?: object[], closedEmpty?: boolean}
 *                  | {ok: false, status: number, error: string, skipped?: object[]}>}
 */
export async function revertReassignment({
  id,
  actorId,
  actorName: actorNameArg,
  reason,
  dryRun = false,
  departmentIds,
  origin = 'manual',
  closeIfNothing = false,
}) {
  const auto = origin === 'auto';
  let transaction;
  let committed = false;

  try {
    const pool = await getPool();

    const logReq = pool.request().input('id', sql.Int, id);
    let scopeSql = '1';
    if (departmentIds) {
      const deptList = bindIds(logReq, 'd', departmentIds);
      const inDepartments = (column) =>
        `EXISTS (SELECT 1 FROM department_user du WHERE du.id_user = ${column} AND du.id_department IN (${deptList}))`;
      scopeSql = `CASE WHEN ${inDepartments('wtr.created_by')} OR ${inDepartments('wtr.user_removed')}
                    OR ${inDepartments('wtr.user_new')} THEN 1 ELSE 0 END`;
    }
    const log = (
      await logReq.query(`
        SELECT wtr.id, wtr.active, wtr.returned_at, wtr.created_by,
               CONVERT(varchar(10), wtr.date_to_return, 23) AS date_to_return,
               ${scopeSql} AS in_scope
        FROM workflow_task_reassignment wtr
        WHERE wtr.id = @id
      `)
    ).recordset[0];
    if (!log || !log.in_scope) return failure(404, 'La reasignación no existe o no es de tu departamento');
    if (log.returned_at || log.active === 0 || log.active === false) {
      return failure(409, 'Esta reasignación ya fue retornada o deshecha');
    }
    const isReturn = Boolean(log.date_to_return);

    let scopeDepartments = departmentIds;
    if (!scopeDepartments) {
      scopeDepartments = (
        await pool
          .request()
          .input('u', sql.NVarChar(1000), log.created_by ?? '')
          .query(`SELECT DISTINCT id_department FROM department_user WHERE id_user = @u`)
      ).recordset
        .map((r) => Number(r.id_department))
        .filter(Number.isInteger);
    }

    const details = (
      await pool.request().input('id', sql.Int, id).query(`
        SELECT d.id, d.item_type, d.id_item, d.users_before, d.users_after,
               COALESCE(pc.process, tplp.process) AS process, COALESCE(tpc.task, tpl.task) AS task,
               trg.id_request_general
        FROM workflow_task_reassignment_detail d
        LEFT JOIN process_category pc ON d.item_type = 'workflow' AND pc.id = d.id_item
        LEFT JOIN task_request_general trg ON d.item_type = 'task' AND trg.id = d.id_item
        LEFT JOIN task_process_category tpc ON tpc.id = trg.id_task
        -- Reglas de tareas futuras (plantilla): solo se desactivan, no cambian datos.
        LEFT JOIN task_process_category tpl ON d.item_type = '${TEMPLATE_ITEM}' AND tpl.id = d.id_item
        LEFT JOIN process_category tplp ON tplp.id = tpl.id_process_category
        WHERE d.id_reassignment = @id
        ORDER BY d.item_type, d.id_item
      `)
    ).recordset;
    if (details.length === 0) {
      return failure(409, 'Esta reasignación no tiene detalle guardado (es anterior); se debe corregir a mano');
    }

    const peopleIds = [
      ...new Set([
        ...details.flatMap((d) => [...splitUsers(d.users_before), ...splitUsers(d.users_after)]),
        String(actorId),
      ]),
    ];
    const people = new Map();
    for (const row of await queryByChunks(
      () => {
        const r = pool.request();
        if (scopeDepartments.length) bindIds(r, 'd', scopeDepartments);
        return r;
      },
      peopleIds,
      (inList) => `
        SELECT u.id, u.name,
          ${
            scopeDepartments.length
              ? `CASE WHEN EXISTS (
                   SELECT 1 FROM department_user du
                   WHERE du.id_user = u.id AND du.id_department IN (${scopeDepartments.map((_, i) => `@d${i}`).join(', ')})
                 ) THEN 1 ELSE 0 END`
              : '1'
          } AS in_scope
        FROM [user] u WHERE u.id IN (${inList})`,
      sql.NVarChar(1000)
    )) {
      people.set(String(row.id), { name: row.name, inScope: Boolean(row.in_scope) });
    }
    const nameOf = (uid) => people.get(String(uid))?.name || String(uid);
    const namesOf = (list) => splitUsers(list).map(nameOf).join(', ') || 'sin asignar';
    const actorName = actorNameArg || people.get(String(actorId))?.name || String(actorId);

    const newer = new Map();
    for (const type of ['workflow', 'task']) {
      const itemIds = details.filter((d) => d.item_type === type).map((d) => Number(d.id_item));
      if (!itemIds.length) continue;
      const rows = await queryByChunks(
        () => pool.request().input('id', sql.Int, id).input('type', sql.VarChar(20), type),
        itemIds,
        (inList) => `
          SELECT d.id_item, MAX(d.id_reassignment) AS newer_id
          FROM workflow_task_reassignment_detail d
          INNER JOIN workflow_task_reassignment w ON w.id = d.id_reassignment
          WHERE d.item_type = @type AND d.id_item IN (${inList})
            AND d.id_reassignment > @id AND w.active = 1 AND w.returned_at IS NULL
          GROUP BY d.id_item`
      );
      for (const r of rows) newer.set(`${type}-${r.id_item}`, Number(r.newer_id));
    }

    const loadCurrent = async (newRequest, lock) => {
      const hint = lock ? 'WITH (UPDLOCK, HOLDLOCK)' : '';
      const flowIds = details.filter((d) => d.item_type === 'workflow').map((d) => Number(d.id_item));
      const taskIds = details.filter((d) => d.item_type === 'task').map((d) => Number(d.id_item));
      const leaders = new Map(flowIds.map((f) => [f, []]));
      if (flowIds.length) {
        for (const r of await queryByChunks(
          newRequest,
          flowIds,
          (inList) =>
            `SELECT id_process_category, id_user FROM user_process_category_request_general ${hint}
             WHERE id_process_category IN (${inList})`
        )) {
          leaders.get(Number(r.id_process_category))?.push(String(r.id_user));
        }
      }
      const tasks = new Map();
      if (taskIds.length) {
        for (const r of await queryByChunks(
          newRequest,
          taskIds,
          (inList) =>
            `SELECT trg.id, trg.id_assigned, trg.id_status, ua.name AS assigned_name
             FROM task_request_general trg ${hint}
             LEFT JOIN [user] ua ON ua.id = trg.id_assigned
             WHERE trg.id IN (${inList})`
        )) {
          tasks.set(Number(r.id), r);
        }
      }
      return { leaders, tasks };
    };

    const evaluate = ({ leaders, tasks }) =>
      details.map((d) => {
        const key = `${d.item_type}-${d.id_item}`;
        const before = userList(splitUsers(d.users_before));
        const after = userList(splitUsers(d.users_after));
        const title =
          d.item_type === 'workflow'
            ? `Flujo #${d.id_item} ${d.process ?? ''}`.trim()
            : d.item_type === TEMPLATE_ITEM
              ? `Tareas nuevas de ${d.task ?? `#${d.id_item}`}${d.process ? ` (${d.process})` : ''}`
              : `Tarea #${d.id_item} ${d.task ?? ''} (solicitud #${d.id_request_general ?? '—'})`;
        const base = { detailId: d.id, type: d.item_type, id: Number(d.id_item), title, before, after, request: d.id_request_general };
        const skip = (why) => ({ ...base, ok: false, why });

        // salir según la plantilla (o la regla anterior en una cadena). Siempre se puede.
        if (d.item_type === TEMPLATE_ITEM) return { ...base, ok: true };

        let current;
        let currentName = null;
        if (d.item_type === 'task') {
          const t = tasks.get(Number(d.id_item));
          if (!t) return skip('La tarea ya no existe');
          if (!OPEN_STATUSES.includes(Number(t.id_status))) return skip('La tarea ya se cerró');
          current = userList([t.id_assigned]);
          currentName = t.assigned_name;
        } else {
          current = userList(leaders.get(Number(d.id_item)) ?? []);
        }

        if (current === before) return skip(`Ya está con ${namesOf(before)}`);
        if (current !== after) {
          const newerId = newer.get(key);
          if (newerId) return skip(`Se reasignó otra vez después: deshaz primero la reasignación #${newerId}`);
          return skip(
            d.item_type === 'task'
              ? `Ahora la tiene ${currentName || namesOf(current)}`
              : `Los líderes del flujo cambiaron (ahora: ${namesOf(current)})`
          );
        }
        if (!before) return skip('No tenía asignado antes');
        const gone = splitUsers(before).filter((uid) => !people.get(uid)?.inScope);
        if (gone.length) return skip(`${gone.map(nameOf).join(', ')} ya no pertenece al departamento`);
        return { ...base, ok: true };
      });

    const summarize = (items) => {
      const back = items.filter((i) => i.ok);
      return {
        back: {
          workflows: back.filter((i) => i.type === 'workflow').length,
          tasks: back.filter((i) => i.type === 'task').length,
          templates: back.filter((i) => i.type === TEMPLATE_ITEM).length,
        },
        items: back.map((i) => ({ type: i.type, id: i.id, title: i.title, to: namesOf(i.before) })),
        skipped: items.filter((i) => !i.ok).map((i) => ({ type: i.type, id: i.id, title: i.title, reason: i.why })),
      };
    };

    if (dryRun) {
      const preview = summarize(evaluate(await loadCurrent(() => pool.request(), false)));
      return { ok: true, isReturn, preview };
    }

    transaction = new sql.Transaction(pool);
    await transaction.begin();
    const tx = () => new sql.Request(transaction);

    const items = evaluate(await loadCurrent(tx, true));
    const summary = summarize(items);
    const toReturn = items.filter((i) => i.ok);
    if (toReturn.length === 0 && !closeIfNothing) {
      await transaction.rollback();
      transaction = null;
      return failure(409, 'No hay nada que se pueda devolver', { skipped: summary.skipped });
    }

    const verb = auto ? 'Retorno automático de' : isReturn ? 'Se retorna' : 'Se deshace';
    const tail = auto ? `Motivo: ${reason}` : `Realizado por ${actorName}. Motivo: ${reason}`;

    for (const item of toReturn) {
      if (item.type === TEMPLATE_ITEM) {
        continue; // basta con marcar el detalle como devuelto (abajo)
      }
      if (item.type === 'workflow') {
        await tx()
          .input('pc', sql.Int, item.id)
          .query(`DELETE FROM user_process_category_request_general WHERE id_process_category = @pc`);
        for (const uid of splitUsers(item.before)) {
          await tx()
            .input('pc', sql.Int, item.id)
            .input('u', sql.NVarChar(1000), uid)
            .query(`INSERT INTO user_process_category_request_general (id_process_category, id_user) VALUES (@pc, @u)`);
        }
        const note = `${verb} la reasignación #${id}: el liderazgo del ${item.title} vuelve a ${namesOf(item.before)} (estaba con ${namesOf(item.after)}). ${tail}`;
        await tx()
          .input('note', sql.NVarChar(sql.MAX), note)
          .input('pc', sql.Int, item.id)
          .input('by', sql.NVarChar(255), String(actorId))
          .query(`INSERT INTO notes (note, id_process_category, created_by, creation_date) VALUES (@note, @pc, @by, GETDATE())`);
        await tx()
          .input('note', sql.NVarChar(sql.MAX), note)
          .input('pc', sql.Int, item.id)
          .input('by', sql.NVarChar(255), String(actorId)).query(`
            INSERT INTO notes (note, id_request, created_by, creation_date, id_process_category)
            SELECT @note, rg.id, @by, GETDATE(), @pc
            FROM requests_general rg
            INNER JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
            WHERE pcrg.id_process_category = @pc AND rg.status_req IN (${OPEN_LIST})
          `);
      } else {
        const update = await tx()
          .input('id', sql.Int, item.id)
          .input('to', sql.NVarChar(1000), item.before)
          .input('from', sql.NVarChar(1000), item.after)
          .query(`UPDATE task_request_general SET id_assigned = @to WHERE id = @id AND id_assigned = @from`);
        if (update.rowsAffected[0] !== 1) throw new Error('CONFLICT');
        await tx()
          .input(
            'note',
            sql.NVarChar(sql.MAX),
            `${verb} la reasignación #${id}: la ${item.title} vuelve a ${namesOf(item.before)} (estaba con ${namesOf(item.after)}). ${tail}`
          )
          .input('req', sql.Int, item.request ?? null)
          .input('by', sql.NVarChar(255), String(actorId)).query(`
            INSERT INTO notes (note, id_request, created_by, creation_date, id_process_category)
            SELECT @note, @req, @by, GETDATE(),
                   (SELECT TOP 1 id_process_category FROM process_category_request_general WHERE id_request_general = @req)
          `);
      }
    }

    for (const part of chunks(toReturn.map((i) => i.detailId))) {
      const r = tx();
      await r.query(`UPDATE workflow_task_reassignment_detail SET returned = 1 WHERE id IN (${bindIds(r, 'x', part)})`);
    }
    const byReason = new Map();
    for (const i of items.filter((x) => !x.ok)) byReason.set(i.why, [...(byReason.get(i.why) ?? []), i.detailId]);
    for (const [why, ids] of byReason) {
      for (const part of chunks(ids)) {
        const r = tx().input('why', sql.NVarChar(500), why.slice(0, 500));
        await r.query(`UPDATE workflow_task_reassignment_detail SET skip_reason = @why WHERE id IN (${bindIds(r, 'x', part)})`);
      }
    }

    const stamp = new Intl.DateTimeFormat('es-CO', {
      timeZone: 'America/Bogota',
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date());
    const header = auto
      ? `--- Retornada automáticamente el ${stamp} (programador). Motivo: ${reason}`
      : `--- ${isReturn ? 'Retornada' : 'Deshecha'} el ${stamp} por ${actorName}. Motivo: ${reason}`;
    const skippedText = summary.skipped.map((s) => `${s.title}: ${s.reason}`).join('; ');
    const logLine = [
      '',
      header,
      toReturn.length
        ? `Devuelto: ${summary.back.workflows} flujo(s), ${summary.back.tasks} tarea(s)` +
          (summary.back.templates ? `; las tareas nuevas de ${summary.back.templates} plantilla(s) vuelven a su responsable.` : '.')
        : 'No se pudo devolver nada.',
      summary.skipped.length ? `No se devolvió (${summary.skipped.length}): ${skippedText}` : 'Se devolvió todo.',
    ].join('\n');
    await tx()
      .input('id', sql.Int, id)
      .input('line', sql.NVarChar(sql.MAX), logLine)
      .query(`
        UPDATE workflow_task_reassignment
        SET returned_at = SYSUTCDATETIME(), active = 0, reason = CONCAT(reason, @line)
        WHERE id = @id AND returned_at IS NULL
      `);

    await transaction.commit();
    committed = true;

    const returnedTaskIds = toReturn.filter((i) => i.type === 'task').map((i) => i.id);
    if (returnedTaskIds.length) {
      const taskInfo = await queryByChunks(
        () => pool.request(),
        returnedTaskIds,
        (inList) => `
          SELECT trg.id, trg.id_assigned, trg.id_request_general, tpc.task, rg.subject_request
          FROM task_request_general trg
          INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
          LEFT JOIN requests_general rg ON rg.id = trg.id_request_general
          WHERE trg.id IN (${inList})`
      ).catch((e) => {
        console.error(`${TAG} Error leyendo tareas para notificar:`, e);
        return [];
      });
      for (const t of taskInfo) {
        fireAndForgetNotification(
          notifyActivityAssigned({
            taskId: t.id,
            userId: String(t.id_assigned),
            requestId: t.id_request_general,
            subject: t.subject_request,
            taskName: t.task,
          })
        );
      }
    }

    console.log(
      `${TAG} ${actorId} ${auto ? 'retornó automáticamente' : isReturn ? 'retornó' : 'deshizo'} la reasignación #${id}:`,
      summary.back,
      'omitidos:',
      summary.skipped.length
    );
    return {
      ok: true,
      isReturn,
      reverted: summary.back,
      skipped: summary.skipped,
      closedEmpty: toReturn.length === 0,
    };
  } catch (err) {
    if (transaction && !committed) {
      await transaction.rollback().catch((e) => console.error(`${TAG} Error en rollback:`, e));
    }
    if (err?.message === 'CONFLICT') {
      return failure(409, 'Algo cambió mientras se devolvía; no se cambió nada. Intenta de nuevo.');
    }
    throw err;
  }
}
