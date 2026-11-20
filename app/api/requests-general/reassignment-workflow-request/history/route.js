import { sql, getPool } from '../../../../../lib/mssqlPool';
import { NextResponse } from 'next/server';
import { getReassignmentAccess, scopeDepartmentIds } from '../../../../../lib/requests-general/reassignmentAccess';

export async function GET(req) {
  try {
    const access = await getReassignmentAccess();
    if (access.error) return NextResponse.json({ error: access.error.message }, { status: access.error.status });

    const MAX_IDS = 500;
    const { searchParams } = new URL(req.url);
    const idsParam = searchParams.get('ids');
    const requestedIds = idsParam
      ? [
          ...new Set(
            idsParam
              .split(',')
              .map((v) => Number.parseInt(v.trim(), 10))
              .filter((v) => Number.isInteger(v) && v > 0)
          ),
        ].slice(0, MAX_IDS)
      : null;

    // Always scoped to the caller's departments; never the whole history.
    const ids = scopeDepartmentIds(requestedIds, access.departmentIds);
    if (ids.length === 0) {
      return NextResponse.json({ error: 'Departamento fuera de tu alcance' }, { status: 403 });
    }

    const pool = await getPool();

    let queryHistory = `
        SELECT TOP (1000)
            wtr.id, wtr.reason, wtr.created_at,
            wtr.created_by, ucb.name AS created_by_name,
            wtr.user_removed, urm.name AS user_removed_name,
            wtr.user_new, unw.name AS user_new_name,
            CONVERT(varchar(10), wtr.date_to_return, 23) AS date_to_return,
            wtr.returned_at, wtr.active
        FROM workflow_task_reassignment wtr
        LEFT JOIN [user] ucb ON ucb.id = wtr.created_by
        LEFT JOIN [user] urm ON urm.id = wtr.user_removed
        LEFT JOIN [user] unw ON unw.id = wtr.user_new
        WHERE 1 = 1
    `;

    const history = pool.request();

    if (ids) {
      const names = ids.map((value, i) => {
        history.input(`id${i}`, sql.Int, value);
        return `@id${i}`;
      });
      const inDepartments = (column) =>
        `EXISTS (SELECT 1 FROM department_user du WHERE du.id_user = ${column} AND du.id_department IN (${names.join(', ')}))`;
      queryHistory += ` AND (${inDepartments('wtr.created_by')} OR ${inDepartments('wtr.user_removed')} OR ${inDepartments('wtr.user_new')})`;
    }

    queryHistory += ` ORDER BY wtr.created_at DESC, wtr.id DESC`;

    const historyRes = await history.query(queryHistory);

    return NextResponse.json({ history: historyRes.recordset }, { status: 200 });
  } catch (err) {
    console.error('Error en endpoint:', err);

    return NextResponse.json(
      {
        error: 'Error procesando la solicitud',
      },
      { status: 500 }
    );
  }
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body?.ids) ? body.ids.join(',') : '';
  const url = new URL(req.url);
  url.searchParams.set('ids', ids);
  return GET(new Request(url, { headers: req.headers }));
}
