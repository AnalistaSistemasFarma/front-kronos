import { NextResponse } from 'next/server';
import { requireDashboardAdminApi } from '../../../../lib/dashboard/dashboardAccess';
import { getPool } from '../../../../lib/mssqlPool';
import {
  buildSummary,
  parseViewTasksFilters,
  queryCategoryMembersByNames,
  queryDashboardTasks,
  queryTasksBySolicitudIds,
  resolveSolicitudId,
  validateDateRange,
} from '../../../../lib/dashboard/viewTasksQuery';

/**
 * GET /api/requests-general/view-tasks
 *
 * Misma lógica que main: datos desde la vista vw_tareas_solicitudes.
 * Filtro de periodo: fecha_creacion_solicitud BETWEEN date_from AND date_to.
 */
export async function GET(req: Request) {
  try {
    const auth = await requireDashboardAdminApi();
    if (!auth.ok) return auth.response;

    const filters = parseViewTasksFilters(new URL(req.url).searchParams);

    const dateError = validateDateRange(filters.date_from, filters.date_to);
    if (dateError) {
      return NextResponse.json(
        { success: false, error: dateError, code: 'INVALID_DATE_RANGE' },
        { status: 400 }
      );
    }

    const taskDateError = validateDateRange(filters.task_date_from, filters.task_date_to);
    if (taskDateError) {
      return NextResponse.json(
        { success: false, error: taskDateError, code: 'INVALID_TASK_DATE_RANGE' },
        { status: 400 }
      );
    }

    const pool = await getPool();
    const data = await queryDashboardTasks(pool, filters);
    const summary = buildSummary(data);

    const solicitudIds = [
      ...new Set(
        data
          .map((row) => resolveSolicitudId(row))
          .filter((id): id is number => id != null && id > 0)
      ),
    ];

    const [teamRoster, categoryMembers] = await Promise.all([
      solicitudIds.length > 0 ? queryTasksBySolicitudIds(pool, solicitudIds) : Promise.resolve([]),
      queryCategoryMembersByNames(
        pool,
        data.map((row) => row.categoria_solicitud).filter(Boolean) as string[]
      ),
    ]);

    return NextResponse.json(
      {
        success: true,
        data,
        team_roster: teamRoster,
        category_members: categoryMembers,
        count: data.length,
        team_roster_count: teamRoster.length,
        summary,
        source: 'vw_tareas_solicitudes',
        filters_applied: {
          date_field: 'fecha_creacion_solicitud',
          date_from: filters.date_from ?? null,
          date_to: filters.date_to ?? null,
          task_date_from: filters.task_date_from ?? null,
          task_date_to: filters.task_date_to ?? null,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error executing vw_tareas_solicitudes query:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Error al obtener las tareas y solicitudes de la vista vw_tareas_solicitudes',
        message: 'No se pudieron recuperar las tareas y solicitudes. Por favor intente nuevamente.',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function POST() {
  return NextResponse.json(
    { success: false, error: 'Method not allowed', message: 'Use GET instead.' },
    { status: 405 }
  );
}

export async function PUT() {
  return NextResponse.json(
    { success: false, error: 'Method not allowed', message: 'Use GET instead.' },
    { status: 405 }
  );
}

export async function DELETE() {
  return NextResponse.json(
    { success: false, error: 'Method not allowed', message: 'Use GET instead.' },
    { status: 405 }
  );
}
