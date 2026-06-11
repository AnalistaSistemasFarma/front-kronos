import { NextResponse } from 'next/server';
import { getPool } from '../../../../lib/mssqlPool';
import { requireDashboardAdminApi } from '../../../../lib/dashboard/dashboardAccess';

/**
 * Casos de mesa de ayuda para el dashboard (todos los estados, filtro por fecha de creación).
 * GET ?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
 */
export async function GET(req: Request) {
  try {
    const auth = await requireDashboardAdminApi();
    if (!auth.ok) return auth.response;

    const pool = await getPool();
    const { searchParams } = new URL(req.url);
    const date_from = searchParams.get('date_from');
    const date_to = searchParams.get('date_to');

    let query = `
      SELECT
        c.case_type,
        c.creation_date,
        c.description,
        c.end_date,
        COALESCE(
          c.end_date,
          CASE WHEN c.id_status_case IN (2, 3) THEN notes_agg.last_note_date END
        ) AS closed_at,
        CASE
          WHEN c.id_status_case IN (2, 3)
            AND c.creation_date IS NOT NULL
            AND COALESCE(c.end_date, notes_agg.last_note_date) IS NOT NULL
            AND COALESCE(c.end_date, notes_agg.last_note_date) >= c.creation_date
          THEN CAST(
            DATEDIFF(
              MINUTE,
              c.creation_date,
              COALESCE(c.end_date, notes_agg.last_note_date)
            ) AS FLOAT
          ) / 60.0
          ELSE NULL
        END AS resolution_hours,
        c.id_case,
        c.priority,
        c.subject_case,
        cat.category,
        cat.subcategory,
        cat.activity,
        sc.status,
        sc.id_status_case,
        u.name AS nombreTecnico,
        d.department,
        c.resolution,
        co.company
      FROM [case] c
      OUTER APPLY (
        SELECT MAX(n.creation_date) AS last_note_date
        FROM notes n
        WHERE n.id_case = c.id_case
      ) notes_agg
      OUTER APPLY (
        SELECT TOP 1
          cg.category,
          sg.subcategory,
          a.activity
        FROM category_case cc
        INNER JOIN category cg ON cg.id_category = cc.id_category
        INNER JOIN subcategory sg ON sg.id_subcategory = cc.id_subcategory
        INNER JOIN activity a ON a.id_activity = cc.id_activity
        WHERE cc.id_case = c.id_case
        ORDER BY cc.id_category_case DESC
      ) cat
      INNER JOIN status_case sc ON sc.id_status_case = c.id_status_case
      INNER JOIN department d ON d.id_department = c.id_department
      LEFT JOIN subprocess_user_company suc ON suc.id_subprocess_user_company = c.id_technical
      LEFT JOIN company_user cu ON cu.id_company_user = suc.id_company_user
      LEFT JOIN [user] u ON u.id = cu.id_user
      LEFT JOIN company co ON co.id_company = c.company
      WHERE 1=1
    `;

    if (date_from && date_to) {
      query += `
        AND CAST(c.creation_date AS DATE) >= CAST(@date_from AS DATE)
        AND CAST(c.creation_date AS DATE) <= CAST(@date_to AS DATE)`;
    }

    query += ` ORDER BY c.id_case DESC`;

    const request = pool.request();
    if (date_from && date_to) {
      request.input('date_from', date_from);
      request.input('date_to', date_to);
    }

    const result = await request.query(query);
    const raw = result.recordset as { id_case?: number }[];
    const seen = new Set<number>();
    const data = raw.filter((row) => {
      const id = row.id_case;
      if (id == null || seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    return NextResponse.json(
      {
        success: true,
        data,
        count: data.length,
        metrics_definition: {
          grain: 'case',
          unique_key: 'id_case',
          date_field: 'case.creation_date',
          resolution_start_field: 'case.creation_date',
          resolution_end_field: 'COALESCE(case.end_date, last_note_date)',
          resolution_status_ids: [2, 3],
        },
        filters_applied: date_from && date_to ? { date_from, date_to } : null,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error dashboard-cases:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Error al obtener casos para el dashboard',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
