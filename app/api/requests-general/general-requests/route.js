import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { sql, withMssqlPool } from '../../../../lib/mssqlPool';

const MAX_PAGE_SIZE = 500;

/**
 * Lista de solicitudes generales con filtros.
 *
 * Sin `page`: devuelve el arreglo completo (comportamiento histórico).
 * Con `page` (y `pageSize`, por defecto 100): pagina en SQL y devuelve
 *   { rows, total, counts: { open, resolved } }, con los contadores sobre el mismo conjunto filtrado.
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

    if (status && status !== '0') {
      where += ' AND rg.status_req = @status';
      inputs.push(['status', sql.Int, Number.parseInt(status, 10)]);
    } else if (!status) {
      where += ' AND sc.id_status_case = 1';
    }
    if (id) {
      where += ' AND rg.id = @id';
      inputs.push(['id', sql.Int, Number.parseInt(id, 10)]);
    }
    if (company) {
      where += ' AND rg.id_company = @company';
      inputs.push(['company', sql.Int, Number.parseInt(company, 10)]);
    }
    if (date_from) {
      where += ' AND rg.created_at >= @date_from';
      inputs.push(['date_from', sql.DateTime, new Date(date_from)]);
    }
    if (date_to) {
      where += ' AND rg.created_at <= @date_to';
      inputs.push(['date_to', sql.DateTime, new Date(date_to + 'T23:59:59')]);
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
      where += " AND pc.process LIKE '%' + @process + '%'";
      inputs.push(['process', sql.VarChar, process]);
    }
    if (category) {
      where += " AND cr.category LIKE '%' + @category + '%'";
      inputs.push(['category', sql.VarChar, category]);
    }

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
      ${where}
      ORDER BY rg.id DESC
    `;

    const result = await withMssqlPool(async (pool) => {
      const bind = () => {
        const request = pool.request();
        for (const [name, type, value] of inputs) request.input(name, type, value);
        return request;
      };

      if (!paged) {
        const rows = await bind().query(selectRows);
        return rows.recordset;
      }

      const rowsRequest = bind();
      rowsRequest.input('offset', sql.Int, (page - 1) * pageSize);
      rowsRequest.input('pageSize', sql.Int, pageSize);
      const [rows, totals] = await Promise.all([
        rowsRequest.query(`${selectRows} OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`),
        bind().query(`
          SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN LOWER(sc.status) = 'abierto' THEN 1 ELSE 0 END) AS [open],
            SUM(CASE WHEN LOWER(sc.status) = 'resuelto' THEN 1 ELSE 0 END) AS resolved
          ${from}
          ${where}
        `),
      ]);
      const t = totals.recordset[0] || {};
      return {
        rows: rows.recordset,
        total: Number(t.total) || 0,
        counts: { open: Number(t.open) || 0, resolved: Number(t.resolved) || 0 },
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
