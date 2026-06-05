import { NextResponse } from 'next/server';
import { requireDashboardAdminApi } from '../../../../lib/dashboard/dashboardAccess';
import { getPool } from '../../../../lib/mssqlPool';
import {
  parseViewTasksFilters,
  validateDateRange,
} from '../../../../lib/dashboard/viewTasksQuery';
import {
  queryDashboardRequests,
} from '../../../../lib/dashboard/viewRequestsQuery';

/**
 * GET /api/requests-general/view-requests
 *
 * Solicitudes desde vw_requests_general (una fila = una solicitud).
 * Filtro de periodo: FechaCreación entre date_from y date_to.
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

    const pool = await getPool();
    const data = await queryDashboardRequests(pool, filters);

    return NextResponse.json(
      {
        success: true,
        data,
        count: data.length,
        source: 'vw_requests_general',
        filters_applied: {
          date_field: 'FechaCreación',
          date_from: filters.date_from ?? null,
          date_to: filters.date_to ?? null,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error executing vw_requests_general query:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Error al obtener las solicitudes de la vista vw_requests_general',
        message: 'No se pudieron recuperar las solicitudes. Por favor intente nuevamente.',
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
