import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { sql, withMssqlPool } from '../../../../lib/mssqlPool';
import { requestSearchWhere } from '../../../../lib/requests-general/requestSearchSql';
import { sqlDateRange } from '../../../../lib/requests-general/dateRangeSql';

const MAX_PAGE_SIZE = 500;
const MAX_TASKS = 20000;

/**
 * Grupos generales de estado (mismos que `statusGroupOf` en lib/requests-general/listFilters.ts):
 * 1 Abierto, 4 Sin empezar, 5 Por autorizar, 6 En borrador y 7 Devuelta → pending; 2 Resuelto → done;
 * 3 Cancelado → cancelled. Igual que en el navegador: lo que no está resuelto ni cancelado es pendiente
 * (antes 5 y 6 —Compras/Ventas— no caían en ninguna tarjeta y las tarjetas no sumaban el total).
 * Los ids son constantes (no vienen del usuario), por eso se pueden incrustar en el SQL.
 */
const STATUS_GROUP_SQL = {
  pending: '1, 4, 5, 6, 7',
  done: '2',
  cancelled: '3',
};

/**
 * Lista de solicitudes generales con filtros.
 *
 * Sin `page`: devuelve el arreglo completo (comportamiento histórico).
 * Con `page` (y `pageSize`, por defecto 100): pagina en SQL y devuelve
 *   { rows, total, counts: { all, pending, done, cancelled } }.
 *
 * `status` acepta un grupo (all|0 = sin filtro, pending = 1/4/5/6/7, done = 2, cancelled = 3) o un id
 * numérico (1, 2, 3, 7...). `counts` se calcula sobre el conjunto filtrado IGNORANDO el estado,
 * para que las tarjetas no cambien al tocar un estado; `total` sí respeta el estado.
 *
 * Una fila por solicitud: los usuarios asignados al proceso van juntos en `user` ("A, B");
 * antes el JOIN repetía la solicitud una vez por usuario.
 */
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const id = searchParams.get('id');
    const company = searchParams.get('company');
    const date_from = searchParams.get('date_from');
    const date_to = searchParams.get('date_to');
    const assigned_to = searchParams.get('assigned_to');
    const process = searchParams.get('process');
    const category = searchParams.get('category');
    const pageParam = searchParams.get('page');
    const paged = pageParam !== null;
    const page = Math.max(1, Number.parseInt(pageParam || '1', 10) || 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, Number.parseInt(searchParams.get('pageSize') || '100', 10) || 100)
    );

    let where = ' WHERE 1=1';
    const inputs = [];

    // Estado: se arma aparte para poder contar las tarjetas IGNORÁNDOLO (como en Mis solicitudes).
    let statusClause = '';
    const statusKey = (status ?? '').trim().toLowerCase();
    if (!statusKey) {
      // Sin parámetro: comportamiento histórico (solo abiertas).
      statusClause = ' AND sc.id_status_case = 1';
    } else if (statusKey === 'all' || statusKey === '0') {
      // Todas: sin filtro de estado.
    } else if (Object.prototype.hasOwnProperty.call(STATUS_GROUP_SQL, statusKey)) {
      // Grupo general: pending (1, 4, 5, 6, 7), done (2) o cancelled (3).
      statusClause = ` AND rg.status_req IN (${STATUS_GROUP_SQL[statusKey]})`;
    } else if (/^\d+$/.test(statusKey)) {
      // Compatibilidad con ids numéricos (1, 2, 3, 7...).
      statusClause = ' AND rg.status_req = @status';
      inputs.push(['status', sql.Int, Number.parseInt(statusKey, 10)]);
    }
    if (id) {
      where += ' AND rg.id = @id';
      inputs.push(['id', sql.Int, Number.parseInt(id, 10)]);
    }
    if (company) {
      where += ' AND rg.id_company = @company';
      inputs.push(['company', sql.Int, Number.parseInt(company, 10)]);
    }
    // Fechas como DATE: "Hasta" incluye todo ese día y nada del siguiente (sin zona horaria).
    const dates = sqlDateRange(date_from, date_to);
    if (dates.from) {
      where += ' AND rg.created_at >= @date_from';
      inputs.push(['date_from', sql.Date, dates.from]);
    }
    if (dates.to) {
      where += ' AND rg.created_at < DATEADD(day, 1, @date_to)';
      inputs.push(['date_to', sql.Date, dates.to]);
    }
    if (assigned_to) {
      where += `
        AND EXISTS (
          SELECT 1
          FROM user_process_category_request_general upf
          INNER JOIN [user] uf ON uf.id = upf.id_user
          WHERE upf.id_process_category = pc.id AND uf.name = @assigned_to
        )`;
      inputs.push(['assigned_to', sql.NVarChar, assigned_to]);
    }
    if (process) {
      // Exacto (se elige de la lista): "Compras" ya no trae "Compras importación".
      where += ' AND pc.process = @process';
      inputs.push(['process', sql.VarChar, process]);
    }
    if (category) {
      where += " AND cr.category LIKE '%' + @category + '%'";
      inputs.push(['category', sql.VarChar, category]);
    }
    // Buscador libre (id, asunto, empresa, categoría, proceso, estado, personas).
    const search = requestSearchWhere(searchParams.get('search'));
    where += search.clause;
    for (const [name, value] of search.params) inputs.push([name, sql.NVarChar, value]);

    const from = `
      FROM requests_general rg
      INNER JOIN company c ON c.id_company = rg.id_company
      LEFT JOIN [user] u ON u.id = rg.id_requester
      INNER JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
      LEFT JOIN process_category pc ON pc.id = pcrg.id_process_category
      INNER JOIN category_request cr ON cr.id = pc.id_category_request
      INNER JOIN status_case sc ON sc.id_status_case = rg.status_req
      LEFT JOIN [user] uex ON uex.id = rg.id_executor_final
    `;

    const selectRows = `
      SELECT
        rg.id, cr.category as category, users_proc.[user], rg.[description], rg.id_company, c.company,
        rg.created_at, u.name as 'requester', sc.status as [status], rg.subject_request as [subject],
        pc.process, cr.id as id_category, rg.resolution, rg.date_resolution,
        rg.status_req as id_status_case, uex.name as executor_final
      ${from}
      OUTER APPLY (
        SELECT STUFF((
          SELECT ', ' + up.name
          FROM user_process_category_request_general upcrg
          INNER JOIN [user] up ON up.id = upcrg.id_user
          WHERE upcrg.id_process_category = pc.id
          FOR XML PATH(''), TYPE
        ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS [user]
      ) users_proc
      ${where}${statusClause}
      ORDER BY rg.id DESC
    `;

    const tasksMode = searchParams.get('tasks') === '1';

    const result = await withMssqlPool(async (pool) => {
      const bind = () => {
        const request = pool.request();
        for (const [name, type, value] of inputs) request.input(name, type, value);
        return request;
      };

      if (tasksMode) {
        const tasksRequest = bind();
        tasksRequest.input('maxTasks', sql.Int, MAX_TASKS + 1);
        const tasks = await tasksRequest.query(`
          WITH filtered AS (
            SELECT DISTINCT rg.id, rg.subject_request, c.company
            ${from}
            ${where}${statusClause}
          )
          SELECT TOP (@maxTasks)
            f.id AS id_request_general,
            f.subject_request AS subject,
            f.company,
            trg.id,
            tpc.task,
            trg.id_status,
            sct.status AS status_task,
            trg.resolution,
            trg.date_resolution,
            ua.name AS assigned
          FROM filtered f
          INNER JOIN task_request_general trg ON trg.id_request_general = f.id
          INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
          INNER JOIN status_case sct ON sct.id_status_case = trg.id_status
          LEFT JOIN [user] ua ON ua.id = trg.id_assigned
          ORDER BY f.id DESC, trg.id ASC
        `);
        const rows = tasks.recordset;
        return { tasks: rows.slice(0, MAX_TASKS), truncated: rows.length > MAX_TASKS };
      }

      if (!paged) {
        const rows = await bind().query(selectRows);
        return rows.recordset;
      }

      const rowsRequest = bind();
      rowsRequest.input('offset', sql.Int, (page - 1) * pageSize);
      rowsRequest.input('pageSize', sql.Int, pageSize);
      const [rows, totals, cardCounts] = await Promise.all([
        rowsRequest.query(`${selectRows} OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`),
        // Total de la paginación: conjunto con el estado aplicado.
        bind().query(`
          SELECT COUNT(*) AS total
          ${from}
          ${where}${statusClause}
        `),
        // Tarjetas: mismo conjunto filtrado pero IGNORANDO el estado.
        bind().query(`
          SELECT
            COUNT(*) AS [all],
            SUM(CASE WHEN rg.status_req IN (${STATUS_GROUP_SQL.pending}) THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN rg.status_req IN (${STATUS_GROUP_SQL.done}) THEN 1 ELSE 0 END) AS done,
            SUM(CASE WHEN rg.status_req IN (${STATUS_GROUP_SQL.cancelled}) THEN 1 ELSE 0 END) AS cancelled
          ${from}
          ${where}
        `),
      ]);
      const t = totals.recordset[0] || {};
      const c = cardCounts.recordset[0] || {};
      return {
        rows: rows.recordset,
        total: Number(t.total) || 0,
        counts: {
          all: Number(c.all) || 0,
          pending: Number(c.pending) || 0,
          done: Number(c.done) || 0,
          cancelled: Number(c.cancelled) || 0,
        },
        page,
        pageSize,
      };
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error('Error en el procesamiento de la solicitud:', err);
    return NextResponse.json(
      { error: 'Error procesando la solicitud', details: err.message },
      { status: 500 }
    );
  }
}
