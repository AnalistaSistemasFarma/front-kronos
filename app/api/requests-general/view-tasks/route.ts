import sql from 'mssql';
import { NextResponse } from 'next/server';
import sqlConfig from '../../../../dbconfig';

/**
 * API Route for executing the vw_tareas_solicitudes view from Kronos_db database
 *
 * GET /api/requests-general/view-tasks
 *
 * Returns all tasks and requests from the vw_tareas_solicitudes database view in JSON format
 *
 * View columns:
 * - id_tarea: Unique identifier for the task
 * - tarea: Description of the task
 * - estado_tarea: Status of the task (e.g., 'Pendiente', 'En Proceso', 'Completada')
 * - asignado_tarea: Name of the user assigned to the task
 * - hora_inicio_tarea: Time when the task started
 * - fecha_fin_tarea: End date of the task
 * - resolucion_tarea: Resolution description of the task
 * - fecha_resolucion_tarea: Date when the task was resolved
 * - costo_tarea: Cost of the task
 * - centro_costo_tarea: Cost center of the task
 * - activo_tarea: Indicates if the task is active
 * - ejecutor_final_tarea: Name of the final executor of the task
 * - id_solicitud: Unique identifier for the associated request
 * - asunto_solicitud: Subject of the associated request
 * - descripcion_solicitud: Description of the associated request
 * - fecha_creacion_solicitud: Date when the request was created
 * - empresa_solicitud: Company of the associated request
 * - creador_solicitud: Name of the user who created the request
 * - estado_solicitud: Status of the associated request
 * - resolucion_solicitud: Resolution description of the request
 * - fecha_resolucion_solicitud: Date when the request was resolved
 * - ejecutor_final_solicitud: Name of the final executor of the request
 * - proceso_solicitud: Process of the associated request
 * - categoria_solicitud: Category of the associated request
 *
 * Query Parameters (optional):
 * - task_status: Filter by task status (string)
 * - request_status: Filter by request status (string)
 * - assigned_user: Filter by assigned user name (partial match, string)
 * - creator: Filter by creator user name (partial match, string)
 * - executor: Filter by executor name (partial match, string)
 * - company: Filter by company name (string)
 * - process: Filter by process name (string)
 * - category: Filter by category name (string)
 * - date_from: Filter by request creation date (start, format: YYYY-MM-DD)
 * - date_to: Filter by request creation date (end, format: YYYY-MM-DD)
 * - task_date_from: Filter by task end date (start, format: YYYY-MM-DD)
 * - task_date_to: Filter by task end date (end, format: YYYY-MM-DD)
 * - active: Filter by active tasks (boolean/string 'true'/'false')
 *
 * @returns {Array} List of tasks and requests from vw_tareas_solicitudes view
 * @returns {Object} Error object if request fails
 */
export async function GET(req: Request) {
  let pool: sql.ConnectionPool | null = null;

  try {
    // Connect to the database
    pool = await sql.connect(sqlConfig);

    // Parse query parameters
    const { searchParams } = new URL(req.url);
    const task_status = searchParams.get('task_status');
    const request_status = searchParams.get('request_status');
    const assigned_user = searchParams.get('assigned_user');
    const creator = searchParams.get('creator');
    const executor = searchParams.get('executor');
    const company = searchParams.get('company');
    const process = searchParams.get('process');
    const category = searchParams.get('category');
    const date_from = searchParams.get('date_from');
    const date_to = searchParams.get('date_to');
    const task_date_from = searchParams.get('task_date_from');
    const task_date_to = searchParams.get('task_date_to');
    const active = searchParams.get('active');

    // Build the base query to select from vw_tareas_solicitudes
    let query = `
      SELECT 
        *
      FROM [vw_tareas_solicitudes]
      WHERE 1=1
    `;

    // Add optional filters
    if (task_status) {
      query += ` AND estado_tarea = @task_status`;
    }
    if (request_status) {
      query += ` AND estado_solicitud = @request_status`;
    }
    if (assigned_user) {
      query += ` AND asignado_tarea LIKE '%' + @assigned_user + '%'`;
    }
    if (creator) {
      query += ` AND creador_solicitud LIKE '%' + @creator + '%'`;
    }
    if (executor) {
      query += ` AND ejecutor_final_tarea LIKE '%' + @executor + '%'`;
    }
    if (company) {
      query += ` AND empresa_solicitud = @company`;
    }
    if (process) {
      query += ` AND proceso_solicitud = @process`;
    }
    if (category) {
      query += ` AND categoria_solicitud = @category`;
    }
    if (date_from && date_to) {
      query += ` AND fecha_creacion_solicitud BETWEEN @date_from AND @date_to`;
    }
    if (task_date_from && task_date_to) {
      query += ` AND fecha_fin_tarea BETWEEN @task_date_from AND @task_date_to`;
    }
    if (active) {
      const isActive = active === 'true' || active === '1';
      query += ` AND activo_tarea = @active`;
    }

    // Order by most recent tasks first
    query += ` ORDER BY id_tarea DESC`;

    // Create and configure the request
    const request = pool.request();

    // Add parameters to prevent SQL injection
    if (task_status) {
      request.input('task_status', sql.NVarChar, task_status);
    }
    if (request_status) {
      request.input('request_status', sql.NVarChar, request_status);
    }
    if (assigned_user) {
      request.input('assigned_user', sql.NVarChar, assigned_user);
    }
    if (creator) {
      request.input('creator', sql.NVarChar, creator);
    }
    if (executor) {
      request.input('executor', sql.NVarChar, executor);
    }
    if (company) {
      request.input('company', sql.NVarChar, company);
    }
    if (process) {
      request.input('process', sql.NVarChar, process);
    }
    if (category) {
      request.input('category', sql.NVarChar, category);
    }
    if (date_from && date_to) {
      request.input('date_from', sql.Date, date_from);
      request.input('date_to', sql.Date, date_to);
    }
    if (task_date_from && task_date_to) {
      request.input('task_date_from', sql.Date, task_date_from);
      request.input('task_date_to', sql.Date, task_date_to);
    }
    if (active) {
      const isActive = active === 'true' || active === '1';
      request.input('active', sql.Bit, isActive);
    }

    // Execute the query
    const result = await request.query(query);

    // Return the results in JSON format
    return NextResponse.json(
      {
        success: true,
        data: result.recordset,
        count: result.recordset.length,
      },
      { status: 200 }
    );
  } catch (error) {
    // Log the error for debugging
    console.error('Error executing vw_tareas_solicitudes query:', error);

    // Return a user-friendly error response
    return NextResponse.json(
      {
        success: false,
        error: 'Error al obtener las tareas y solicitudes de la vista vw_tareas_solicitudes',
        message: 'No se pudieron recuperar las tareas y solicitudes. Por favor intente nuevamente.',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  } finally {
    // Ensure the database connection is closed
    if (pool && pool.connected) {
      try {
        await pool.close();
      } catch (closeError) {
        console.error('Error closing database connection:', closeError);
      }
    }
  }
}

/**
 * POST endpoint is not supported for this route
 * Returns a 405 Method Not Allowed response
 */
export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: 'Method not allowed',
      message: 'POST method is not supported for this endpoint. Use GET instead.',
    },
    { status: 405 }
  );
}

/**
 * PUT endpoint is not supported for this route
 * Returns a 405 Method Not Allowed response
 */
export async function PUT() {
  return NextResponse.json(
    {
      success: false,
      error: 'Method not allowed',
      message: 'PUT method is not supported for this endpoint. Use GET instead.',
    },
    { status: 405 }
  );
}

/**
 * DELETE endpoint is not supported for this route
 * Returns a 405 Method Not Allowed response
 */
export async function DELETE() {
  return NextResponse.json(
    {
      success: false,
      error: 'Method not allowed',
      message: 'DELETE method is not supported for this endpoint. Use GET instead.',
    },
    { status: 405 }
  );
}
