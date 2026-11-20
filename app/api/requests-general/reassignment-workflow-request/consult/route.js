import { sql, getPool } from '../../../../../lib/mssqlPool';
import { NextResponse } from 'next/server';
import { getReassignmentAccess, scopeDepartmentIds } from '../../../../../lib/requests-general/reassignmentAccess';

export async function GET(req) {
  try {
    const access = await getReassignmentAccess();
    if (access.error) return NextResponse.json({ error: access.error.message }, { status: access.error.status });

    const MAX_IDS = 500;
    const { searchParams } = new URL(req.url);
    const idAssigned = searchParams.get('idAssigned');
    // Single-department filter folds into the scoped list below.
    const id = null;
        const idsParam = searchParams.get('id') || searchParams.get('ids');
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

        // Always scoped to the caller's departments; requesting other departments is denied.
        const ids = scopeDepartmentIds(requestedIds, access.departmentIds);
        if (ids.length === 0) {
          return NextResponse.json({ error: 'Departamento fuera de tu alcance' }, { status: 403 });
        }

    const pool = await getPool();

    let queryWorkflows = `
        SELECT 
            pc.id as id_process_category, pc.process, pc.id_category_request, cr.category, pc.active, userpc.name as assigned,
            c.company, d.id_department, d.department
        FROM
            process_category pc
        INNER JOIN category_request cr ON cr.id = pc.id_category_request
        INNER JOIN user_process_category_request_general upc ON upc.id_process_category = pc.id
        INNER JOIN [user] userpc ON userpc.id = upc.id_user
        INNER JOIN company_category_request ccr ON ccr.id_category_request = cr.id
        INNER JOIN company c ON c.id_company = ccr.id_company
        INNER JOIN department_user du ON du.id_user = userpc.id
        INNER JOIN department d ON d.id_department = du.id_department
        WHERE pc.active = 1
    `;

    const workflowsAssigned = pool.request();

    if (id) {
        queryWorkflows += ` AND d.id_department = @id`;
        workflowsAssigned.input('id', sql.Int, Number.parseInt(id, 10));
      }
      if (ids) {
        const names = ids.map((value, i) => {
          workflowsAssigned.input(`id${i}`, sql.Int, value);
          return `@id${i}`;
        });
        queryWorkflows += ` AND d.id_department IN (${names.join(', ')})`;
    }

    if (idAssigned) {
        queryWorkflows += ` AND upc.id_user = @idAssigned`;
        workflowsAssigned.input('idAssigned', sql.NVarChar, idAssigned);
    }

    queryWorkflows += ` ORDER BY process`;

    let queryRequestsAssigned = `
        SELECT
            rg.id,
            cr.category,
            rg.[description],
            rg.id_company,
            c.company,
            rg.created_at,
            u.name AS requester,
            sc.status,
            rg.subject_request AS subject,
            pc.process,
            pc.id AS id_process_category,
            rg.resolution,
            rg.date_resolution,
            rg.status_req AS id_status_case,
            uex.name AS executor_final,
            u.email,
            users_proc.[user],
            users_proc.id_assigned_process_category,
            users_cat.users_category,
            u.phone,
            u.identification,
            dept_proc.departments_proc,
            dept_proc.id_departments_proc
        FROM requests_general rg
            INNER JOIN company c
                ON c.id_company = rg.id_company
            LEFT JOIN [user] u
                ON u.id = rg.id_requester
            INNER JOIN process_category_request_general pcrg
                ON pcrg.id_request_general = rg.id
            LEFT JOIN process_category pc
                ON pc.id = pcrg.id_process_category
            INNER JOIN category_request cr
                ON cr.id = pc.id_category_request
            INNER JOIN status_case sc
                ON sc.id_status_case = rg.status_req
            LEFT JOIN [user] uex
                ON uex.id = rg.id_executor_final
        OUTER APPLY (
            SELECT
                STUFF((
                    SELECT DISTINCT ', ' + u2.name
                    FROM user_process_category_request_general upcrg2
                    INNER JOIN [user] u2
                        ON u2.id = upcrg2.id_user
                    WHERE upcrg2.id_process_category = pc.id
                    FOR XML PATH(''), TYPE
                ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS [user],

                STUFF((
                    SELECT DISTINCT ', ' + CAST(upcrg2.id_user AS VARCHAR)
                    FROM user_process_category_request_general upcrg2
                    WHERE upcrg2.id_process_category = pc.id
                    FOR XML PATH(''), TYPE
                ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS id_assigned_process_category


            ) users_proc
        OUTER APPLY (
            SELECT
                STUFF((
                SELECT DISTINCT ', ' + u3.name
                FROM user_category_request_general ucrg
                INNER JOIN [user] u3
                    ON u3.id = ucrg.id_user
                WHERE ucrg.id_category = cr.id
                FOR XML PATH(''), TYPE
                ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS users_category
        ) users_cat
        OUTER APPLY (
            SELECT
                STUFF((
                    SELECT DISTINCT ', ' + d.department
                    FROM user_process_category_request_general upcrg3
                    INNER JOIN department_user du
                        ON du.id_user = upcrg3.id_user
                    INNER JOIN department d
                        ON d.id_department = du.id_department
                    WHERE upcrg3.id_process_category = pc.id
                    FOR XML PATH(''), TYPE
                ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS departments_proc,

                STUFF((
                    SELECT DISTINCT ', ' + CAST(du.id_department AS NVARCHAR(20))
                    FROM user_process_category_request_general upcrg3
                    INNER JOIN department_user du
                        ON du.id_user = upcrg3.id_user
                    WHERE upcrg3.id_process_category = pc.id
                    FOR XML PATH(''), TYPE
                ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS id_departments_proc
        ) dept_proc
        WHERE rg.status_req IN (7,6,5,4,1)
    `;

    const requestsAssigned = pool.request();

    if (id) {
        const idDepartment = Number.parseInt(id, 10);
        if (!Number.isInteger(idDepartment)) {
            return NextResponse.json({ error: 'Departamento inválido' }, { status: 400 });
        }
        requestsAssigned.input('idDepartment', sql.Int, idDepartment);
        queryRequestsAssigned += `
            AND EXISTS (
            SELECT 1
            FROM user_process_category_request_general upf
            INNER JOIN department_user duf ON duf.id_user = upf.id_user
            WHERE upf.id_process_category = pc.id
                AND duf.id_department = @idDepartment
            )`;
    }

    if (Array.isArray(ids) && ids.length > 0) {
        const params = ids.map((value, i) => {
            const n = Number.parseInt(value, 10);
            if (!Number.isInteger(n)) throw new Error(`Departamento inválido: ${value}`);
            requestsAssigned.input(`dep${i}`, sql.Int, n);
            return `@dep${i}`;
    });
    queryRequestsAssigned += `
        AND EXISTS (
        SELECT 1
        FROM user_process_category_request_general upf
        INNER JOIN department_user duf ON duf.id_user = upf.id_user
        WHERE upf.id_process_category = pc.id
            AND duf.id_department IN (${params.join(', ')})
        )`;
    }

    if (idAssigned) {
        requestsAssigned.input('idAssigned', sql.NVarChar, idAssigned);
        queryRequestsAssigned += `
            AND EXISTS (
            SELECT 1
            FROM user_process_category_request_general upf
            WHERE upf.id_process_category = pc.id
                AND upf.id_user = @idAssigned
            )`;
    }

    queryRequestsAssigned += ` ORDER BY rg.id DESC`;

    let queryTaskAssigned = `
        SELECT 
            trg.id, trg.id_task, tpc.task ,rg.id as id_request_general, rg.description, rg.subject_request, rg.id_company, c.company ,rg.created_at, 
            rg.id_requester, urq.name as name_requester ,rg.status_req, trg.id_status ,sc.status as status_task, u.name as assigned, d.department,
            pc.process, cr.category, trg.start_date, trg.resolution, trg.date_resolution, uex.name as executor_final
        FROM task_request_general trg
        INNER JOIN task_process_category tpc ON tpc.id = trg.id_task
        LEFT JOIN requests_general rg ON rg.id = trg.id_request_general
        LEFT JOIN process_category_request_general pcrg ON pcrg.id_request_general = rg.id
        LEFT JOIN process_category pc ON pc.id = pcrg.id_process_category
        LEFT JOIN category_request cr ON cr.id = pc.id_category_request
        INNER JOIN status_case sc ON sc.id_status_case = trg.id_status
        INNER JOIN [user] u ON u.id = trg.id_assigned
        INNER JOIN [user] urq ON urq.id = rg.id_requester
        INNER JOIN company c ON c.id_company = rg.id_company
        LEFT JOIN [user] uex ON uex.id = trg.id_executor_final
        INNER JOIN department_user du ON du.id_user = u.id
        INNER JOIN department d ON d.id_department = du.id_department
        WHERE trg.id_status IN (1,7,6,5,4)
    `;

    const tasksAssigned = pool.request();

    if (id) {
        queryTaskAssigned += ` AND d.id_department = @id`;
        tasksAssigned.input('id', sql.Int, Number.parseInt(id, 10));
      }
      if (ids) {
        const names = ids.map((value, i) => {
          tasksAssigned.input(`id${i}`, sql.Int, value);
          return `@id${i}`;
        });
        queryTaskAssigned += ` AND d.id_department IN (${names.join(', ')})`;
    }

    if (idAssigned) {
        queryTaskAssigned += ` AND trg.id_assigned = @idAssigned`;
        tasksAssigned.input('idAssigned', sql.NVarChar, idAssigned);
    }

    queryTaskAssigned += ` ORDER BY trg.id DESC`;

    let queryAssignedUsers = `
      SELECT DISTINCT
        u.id,
        u.name
      FROM [user] u
      WHERE u.name IS NOT NULL
        AND u.name <> ''
    `;

    const assignedUsers = pool.request();

    if (id) {
      queryAssignedUsers += ` AND EXISTS (SELECT 1 FROM department_user du WHERE du.id_user = u.id AND du.id_department = @id)`;
      assignedUsers.input('id', sql.Int, Number.parseInt(id, 10));
    }
    if (ids) {
      const names = ids.map((value, i) => {
        assignedUsers.input(`id${i}`, sql.Int, value);
        return `@id${i}`;
      });
      queryAssignedUsers += ` AND EXISTS (SELECT 1 FROM department_user du WHERE du.id_user = u.id AND du.id_department IN (${names.join(', ')}))`;
    }

    queryAssignedUsers += ` ORDER BY u.name`;

    const [workflowsRes, requestsAssignedRes, assignedUsersRes, taskAssignedRes] =
      await Promise.all([
        workflowsAssigned.query(queryWorkflows),
        requestsAssigned.query(queryRequestsAssigned),
        assignedUsers.query(queryAssignedUsers),
        tasksAssigned.query(queryTaskAssigned),
      ]);


    return NextResponse.json(
      {
        workflows: workflowsRes.recordset,
        requestsAssigned: requestsAssignedRes.recordset,
        assignedUsers: assignedUsersRes.recordset,
        taskAssigned: taskAssignedRes.recordset,
      },
      { status: 200 }
    );

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
  const idAssigned = body?.idAssigned != null ? String(body.idAssigned).trim() : '';
  if (idAssigned) url.searchParams.set('idAssigned', idAssigned);
  return GET(new Request(url, { headers: req.headers }));
}
