import sql from 'mssql';
import sqlConfig from '../../../../dbconfig';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import {
  canViewHelpDeskCase,
  checkHelpDeskOperatorAccess,
} from '../../../../lib/help-desk/access';
import {
  BOARD_CASE_SEARCH_SQL,
  REQUESTER_EMAIL_FILTER_SQL,
  REQUESTER_EMAIL_SQL,
  REQUESTER_ID_FILTER_SQL,
  REQUESTER_JOINS,
  REQUESTER_NAME_SQL,
  REQUESTER_SEARCH_FILTER_SQL,
} from '../../../../lib/help-desk/requesterSql';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const userEmail = session.user.email.trim();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const priority = searchParams.get('priority');
    const status = searchParams.get('status');
    const assigned_user = searchParams.get('assigned_user');
    const date_from = searchParams.get('date_from');
    const date_to = searchParams.get('date_to');
    const technician = searchParams.get('technician');
    const company = searchParams.get('company');
    const requester_id = searchParams.get('requester_id');
    const requester_email = searchParams.get('requester_email');
    const requester_search = searchParams.get('requester_search');
    const search = searchParams.get('search')?.trim() ?? '';

    const isOperator = await checkHelpDeskOperatorAccess(userEmail);

    if (id) {
      const caseId = Number(id);
      if (!Number.isFinite(caseId)) {
        return NextResponse.json({ error: 'ID de caso inválido' }, { status: 400 });
      }
      const allowed = await canViewHelpDeskCase(userEmail, caseId);
      if (!allowed) {
        return NextResponse.json({ error: 'Sin permiso para ver este caso' }, { status: 403 });
      }
    } else if (!isOperator) {
      return NextResponse.json(
        { error: 'Solo el equipo de mesa de ayuda puede listar todos los casos' },
        { status: 403 }
      );
    }

    const pool = await sql.connect(sqlConfig);

    const hasBoardSearch = search.length > 0;
    const hasRequesterFilter = Boolean(
      requester_id || requester_email || requester_search || hasBoardSearch
    );

    let query = `
      SELECT 
        c.case_type, c.creation_date, c.description, c.end_date, 
        c.id_case, c.id_department, c.id_technical, c.place, 
        c.priority, c.requester, c.subject_case, c.email, cg.id_category,
        cg.category, sg.id_subcategory, sg.subcategory, a.id_activity,
        a.activity, sc.status, u.name AS nombreTecnico, d.department,
        sc.id_status_case, c.resolution, co.company, co.id_company,
        ${REQUESTER_NAME_SQL} AS requester_name,
        ${REQUESTER_EMAIL_SQL} AS requester_email
      FROM [case] c
      LEFT JOIN category_case cc ON cc.id_case = c.id_case
      LEFT JOIN category cg ON cg.id_category = cc.id_category
      LEFT JOIN subcategory sg ON sg.id_subcategory = cc.id_subcategory
      LEFT JOIN activity a ON a.id_activity = cc.id_activity
      INNER JOIN status_case sc ON sc.id_status_case = c.id_status_case
      INNER JOIN department d ON d.id_department = c.id_department
      LEFT JOIN subprocess_user_company suc ON suc.id_subprocess_user_company = c.id_technical
      LEFT JOIN company_user cu ON cu.id_company_user = suc.id_company_user
      LEFT JOIN [user] u ON CAST(u.id AS NVARCHAR(255)) = CAST(cu.id_user AS NVARCHAR(255))
      ${REQUESTER_JOINS}
	    LEFT JOIN company co ON co.id_company = c.company
      WHERE 1=1
    `;

    if (id) query += ` AND c.id_case = @id`;
    if (requester_id) {
      query += ` AND ${REQUESTER_ID_FILTER_SQL}`;
    } else if (requester_email) {
      query += ` AND ${REQUESTER_EMAIL_FILTER_SQL}`;
    } else if (requester_search) {
      query += ` AND ${REQUESTER_SEARCH_FILTER_SQL}`;
    } else if (hasBoardSearch) {
      query += ` AND ${BOARD_CASE_SEARCH_SQL}`;
    }
    if (priority) query += ` AND c.priority = @priority`;
    if (company) query += ` AND co.id_company = @company`;
    if (status && status !== '0') query += ` AND sc.id_status_case = @status`;
    else if (!status && !id && !hasRequesterFilter) query += ` AND sc.id_status_case = 1`;
    if (assigned_user) query += ` AND u.name LIKE '%' + @assigned_user + '%'`;
    if (technician === 'unassigned') {
      query += ` AND (c.id_technical IS NULL OR c.id_technical = 0)`;
    } else if (technician) {
      query += ` AND c.id_technical = @technician`;
    }
    if (date_from && date_to) query += ` AND c.creation_date BETWEEN @date_from AND @date_to`;

    query += ` ORDER BY c.id_case DESC`;

    const request = pool.request();
    if (id) request.input('id', sql.Int, Number(id));
    if (requester_id) request.input('requester_id', sql.NVarChar(255), requester_id);
    if (requester_email) request.input('requester_email', sql.NVarChar(255), requester_email.trim());
    if (requester_search) request.input('requester_search', sql.NVarChar(255), requester_search.trim());
    if (hasBoardSearch) request.input('search', sql.NVarChar(255), search);
    if (priority) request.input('priority', sql.NVarChar, priority);
    if (status) request.input('status', sql.Int, status);
    if (company) request.input('company', sql.Int, company);
    if (assigned_user) request.input('assigned_user', sql.NVarChar, assigned_user);
    if (technician && technician !== 'unassigned') {
      request.input('technician', sql.Int, Number(technician));
    }
    if (date_from && date_to) {
      request.input('date_from', sql.Date, date_from);
      request.input('date_to', sql.Date, date_to);
    }

    const result = await request.query(query);

    if (id) {
      const ticket = result.recordset[0] ?? null;
      if (!ticket) {
        return NextResponse.json({ error: 'Caso no encontrado' }, { status: 404 });
      }
      return NextResponse.json(ticket, { status: 200 });
    }

    return NextResponse.json(result.recordset, { status: 200 });
  } catch (err) {
    console.error('Error en el procesamiento de la solicitud:', err);
    return NextResponse.json(
      {
        error: 'Error al procesar la solicitud de casos',
        details: 'No se pudieron obtener los casos. Por favor intente nuevamente.',
        technical: err.message,
      },
      { status: 500 }
    );
  }
}
