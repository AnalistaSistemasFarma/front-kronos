import sql from 'mssql';
import sqlConfig from '../../../../dbconfig';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { checkHelpDeskRequesterAccess } from '../../../../lib/help-desk/access';
import {
  MY_TICKETS_EMAIL_SEARCH_SQL,
  MY_TICKETS_SCOPE_PRELUDE_SQL,
  CASE_CONTACT_EMAIL_SQL,
  MY_TICKETS_REQUESTER_EMAIL_JOIN,
  MY_TICKETS_REQUESTER_EMAIL_SQL,
  REQUESTER_JOINS,
  REQUESTER_NAME_SQL,
} from '../../../../lib/help-desk/requesterSql';

export const dynamic = 'force-dynamic';

/**
 * GET /api/help-desk/my-tickets
 * Tickets del usuario autenticado (solicitante o técnico asignado).
 * Query: status, priority, date_from, date_to, email_search
 */
export async function GET(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const userEmail = session.user.email.trim();

    const canAccess = await checkHelpDeskRequesterAccess(userEmail);
    if (!canAccess) {
      return NextResponse.json(
        { error: 'No tienes asignado el subproceso Mis tickets' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const priority = searchParams.get('priority');
    const status = searchParams.get('status');
    const date_from = searchParams.get('date_from');
    const date_to = searchParams.get('date_to');
    const email_search = searchParams.get('email_search')?.trim() ?? '';

    const pool = await sql.connect(sqlConfig);

    const userResult = await pool
      .request()
      .input('user_email', sql.NVarChar(255), userEmail)
      .query(`
        SELECT TOP 1 id, name, email
        FROM [user]
        WHERE LOWER(LTRIM(RTRIM(email))) = LOWER(LTRIM(RTRIM(@user_email)))
      `);

    const profile = userResult.recordset[0] ?? {
      id: null,
      name: session.user.name ?? null,
      email: userEmail,
    };

    // Identity + matching case ids are resolved once (see MY_TICKETS_SCOPE_PRELUDE_SQL);
    // the previous per-row scope filter took ~32 s and hit the 15 s timeout.
    let query = `
      ${MY_TICKETS_SCOPE_PRELUDE_SQL}
      SELECT
        c.case_type, c.creation_date, c.description, c.end_date,
        c.id_case, c.id_department, c.id_technical, c.place,
        c.priority, c.requester, c.subject_case, c.email,
        ${CASE_CONTACT_EMAIL_SQL} AS contact_email, cg.id_category,
        cg.category, sg.id_subcategory, sg.subcategory, a.id_activity,
        a.activity, sc.status, u.name AS nombreTecnico, d.department,
        sc.id_status_case, c.resolution, co.company, co.id_company,
        ${REQUESTER_NAME_SQL} AS requester_name,
        ${MY_TICKETS_REQUESTER_EMAIL_SQL} AS requester_email,
        CASE
          WHEN c.id_technical IN (SELECT id FROM @my_tickets_suc) THEN 1 ELSE 0
        END AS is_assigned_to_me
      FROM [case] c
      LEFT JOIN category_case cc ON cc.id_case = c.id_case
      LEFT JOIN category cg ON cg.id_category = cc.id_category
      LEFT JOIN subcategory sg ON sg.id_subcategory = cc.id_subcategory
      LEFT JOIN activity a ON a.id_activity = cc.id_activity
      INNER JOIN status_case sc ON sc.id_status_case = c.id_status_case
      INNER JOIN department d ON d.id_department = c.id_department
      LEFT JOIN subprocess_user_company suc ON suc.id_subprocess_user_company = c.id_technical
      LEFT JOIN company_user cu ON cu.id_company_user = suc.id_company_user
      LEFT JOIN [user] u ON u.id = cu.id_user
      ${REQUESTER_JOINS}
      ${MY_TICKETS_REQUESTER_EMAIL_JOIN}
      LEFT JOIN company co ON co.id_company = c.company
      WHERE c.id_case IN (SELECT id_case FROM @my_tickets_ids)
    `;

    if (email_search) {
      query += ` AND ${MY_TICKETS_EMAIL_SEARCH_SQL}`;
    }
    if (priority) query += ` AND c.priority = @priority`;
    if (status && status !== '0') query += ` AND sc.id_status_case = @status`;
    if (date_from && date_to) {
      // Por día: creation_date ya trae hora y BETWEEN dejaba por fuera el último día.
      query += ` AND CAST(c.creation_date AS DATE) BETWEEN @date_from AND @date_to`;
    }

    query += ` ORDER BY c.id_case DESC`;

    const request = pool.request();
    request.input('user_email', sql.NVarChar(255), userEmail);
    if (email_search) request.input('email_search', sql.NVarChar(255), email_search);
    if (priority) request.input('priority', sql.NVarChar, priority);
    if (status && status !== '0') request.input('status', sql.Int, status);
    if (date_from && date_to) {
      request.input('date_from', sql.Date, date_from);
      request.input('date_to', sql.Date, date_to);
    }

    const result = await request.query(query);
    const tickets = result.recordset;

    return NextResponse.json(
      {
        user: profile,
        tickets,
        counts: {
          total: tickets.length,
          open: tickets.filter((t) => t.id_status_case === 1).length,
          resolved: tickets.filter((t) => t.id_status_case === 2).length,
          assigned: tickets.filter((t) => t.is_assigned_to_me === 1).length,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('Error en GET /api/help-desk/my-tickets:', err);
    return NextResponse.json(
      {
        error: 'No se pudieron obtener tus tickets',
        technical: err.message,
      },
      { status: 500 }
    );
  }
}
