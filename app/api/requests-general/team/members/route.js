import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { sql, withMssqlPool } from '../../../../../lib/mssqlPool';
import { TEAM_TASKS_NAME, TEAM_TASKS_URL } from '../../../../../lib/request-general/teamTasksAccess';

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    const idUser = session?.user?.id ? String(session.user.id) : '';
    if (!idUser) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const departmentsParam = searchParams.get('departments') || '';
    const requestedIds = [
      ...new Set(
        departmentsParam
          .split(',')
          .map((d) => d.trim())
          .filter(Boolean)
          .map(Number)
      ),
    ];
    if (requestedIds.length === 0) {
      return NextResponse.json({ error: 'Debe enviar al menos un departamento' }, { status: 400 });
    }
    if (requestedIds.some((id) => !Number.isInteger(id))) {
      return NextResponse.json({ error: 'Departamento inválido' }, { status: 400 });
    }

    const access = await withMssqlPool(async (pool) => {
      const request = pool.request();
      request.input('idUser', sql.NVarChar, idUser);
      request.input('teamUrl', sql.NVarChar, TEAM_TASKS_URL);
      request.input('teamName', sql.NVarChar, TEAM_TASKS_NAME);
      const result = await request.query(`
        SELECT CASE WHEN EXISTS (
          SELECT 1
          FROM subprocess_user_company suc
          INNER JOIN company_user cu ON cu.id_company_user = suc.id_company_user
          INNER JOIN subprocess s    ON s.id_subprocess   = suc.id_subprocess
          WHERE cu.id_user = @idUser
            AND (s.subprocess_url = @teamUrl OR s.subprocess = @teamName)
        ) THEN 1 ELSE 0 END AS canViewTeam;

        SELECT id_department FROM department_user WHERE id_user = @idUser;
      `);
      return {
        canViewTeam: result.recordsets[0][0]?.canViewTeam === 1,
        leaderDepartments: result.recordsets[1].map((r) => Number(r.id_department)),
      };
    });

    if (!access.canViewTeam) {
      return NextResponse.json({ error: 'No tienes permiso para ver las tareas de tu equipo' }, { status: 403 });
    }
    if (requestedIds.some((id) => !access.leaderDepartments.includes(id))) {
      return NextResponse.json({ error: 'No perteneces a uno de los departamentos enviados' }, { status: 403 });
    }

    // IN (@dep0, @dep1, ...) parametrizado.
    const departmentInList = requestedIds.map((_, i) => `@dep${i}`).join(', ');

    const query = `
      SELECT
        u.id,
        u.name,
        u.email,
        departments.department AS departments,
        ISNULL(t.openTasks, 0)       AS openTasks,
        ISNULL(t.notStartedTasks, 0) AS notStartedTasks,
        DATEDIFF(DAY, p.oldestPendingAt, GETDATE()) AS oldestPendingDays,
        CASE WHEN u.id = @idUser THEN 1 ELSE 0 END  AS isSelf
      FROM [user] u
      OUTER APPLY (
        SELECT STUFF((
          SELECT ', ' + d.department
          FROM department_user du
          INNER JOIN department d ON d.id_department = du.id_department
          WHERE du.id_user = u.id
          FOR XML PATH(''), TYPE
        ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS department
      ) departments
      LEFT JOIN (
        SELECT
          id_assigned,
          SUM(CASE WHEN id_status = 1 THEN 1 ELSE 0 END) AS openTasks,
          SUM(CASE WHEN id_status = 4 THEN 1 ELSE 0 END) AS notStartedTasks
        FROM task_request_general
        WHERE id_status IN (1, 4)
        GROUP BY id_assigned
      ) t ON t.id_assigned = u.id
      OUTER APPLY (
        SELECT MIN(rg.created_at) AS oldestPendingAt
        FROM task_request_general trg
        INNER JOIN requests_general rg ON rg.id = trg.id_request_general
        WHERE trg.id_assigned = u.id
          AND trg.id_status IN (1, 4)
      ) p
      WHERE u.isActive = 1
        AND EXISTS (
          SELECT 1 FROM department_user du2
          WHERE du2.id_user = u.id AND du2.id_department IN (${departmentInList})
        )
      ORDER BY u.name ASC;
    `;

    const rows = await withMssqlPool(async (pool) => {
      const request = pool.request();
      requestedIds.forEach((id, i) => request.input(`dep${i}`, sql.Int, id));
      request.input('idUser', sql.NVarChar, idUser);
      const result = await request.query(query);
      return result.recordset;
    });

    return NextResponse.json({ members: rows }, { status: 200 });
  } catch (err) {
    console.error('Error en el procesamiento:', err);
    return NextResponse.json({ error: 'Error procesando la solicitud' }, { status: 500 });
  }
}