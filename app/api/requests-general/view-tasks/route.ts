import { NextResponse } from 'next/server';
import { getPool } from '../../../../lib/mssqlPool';
import {
  buildSummary,
  parseViewTasksFilters,
  queryDashboardTasks,
  validateDateRange,
} from '../../../../lib/dashboard/viewTasksQuery';

/**
 * GET /api/requests-general/view-tasks
 *
 * Actividades desde task_request_general. Filtro de periodo por fecha de creación
 * de la solicitud (rg.created_at), inclusive en date_to.
 */
export async function GET(req: Request) {
  try {
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

    return NextResponse.json(
      {
        success: true,
        data,
        count: data.length,
        summary,
        filters_applied: {
          date_field: 'requests_general.created_at',
          date_from: filters.date_from ?? null,
          date_to: filters.date_to ?? null,
          task_date_from: filters.task_date_from ?? null,
          task_date_to: filters.task_date_to ?? null,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error en view-tasks:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Error al obtener las actividades de solicitudes',
        message: 'No se pudieron recuperar las tareas. Por favor intente nuevamente.',
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
