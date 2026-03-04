import sql from 'mssql';
import { NextResponse } from 'next/server';
import sqlConfig from '../../../../dbconfig';

/**
 * API Route for executing the vw_requests_general view from Kronos_db database
 *
 * GET /api/requests-general/view-requests
 *
 * Returns all requests from the vw_requests_general database view in JSON format
 *
 * View columns:
 * - id: Unique identifier for the request
 * - description: Detailed description of the request
 * - company: Company associated with the request
 * - process: Process associated with the request
 * - category: Category of the request
 * - created_at: Date when the request was created
 * - requesterUser: Name of the user who created the request
 * - statusCase: Status of the request (e.g., 'Abierto', 'En Proceso', 'Cerrado')
 * - assignedUserName: Name of the assigned user
 * - subject: Subject/title of the request
 * - resolutioncase: Resolution description of the case
 * - date_resolution: Date when the request was resolved
 *
 * Query Parameters (optional):
 * - company: Filter by company name (string)
 * - process: Filter by process name (string)
 * - category: Filter by category (string)
 * - status: Filter by status (string, e.g., 'Abierto', 'En Proceso', 'Cerrado')
 * - assigned_user: Filter by assigned user name (partial match, string)
 * - requester: Filter by requester user name (partial match, string)
 * - date_from: Filter by creation date (start, format: YYYY-MM-DD)
 * - date_to: Filter by creation date (end, format: YYYY-MM-DD)
 * - date_resolution_from: Filter by resolution date (start, format: YYYY-MM-DD)
 * - date_resolution_to: Filter by resolution date (end, format: YYYY-MM-DD)
 *
 * @returns {Array} List of requests from vw_requests_general view
 * @returns {Object} Error object if request fails
 */
export async function GET(req: Request) {
  let pool: sql.ConnectionPool | null = null;

  try {
    // Connect to the database
    pool = await sql.connect(sqlConfig);

    // Parse query parameters
    const { searchParams } = new URL(req.url);
    const company = searchParams.get('company');
    const process = searchParams.get('process');
    const category = searchParams.get('category');
    const status = searchParams.get('status');
    const assigned_user = searchParams.get('assigned_user');
    const requester = searchParams.get('requester');
    const date_from = searchParams.get('date_from');
    const date_to = searchParams.get('date_to');
    const date_resolution_from = searchParams.get('date_resolution_from');
    const date_resolution_to = searchParams.get('date_resolution_to');

    // Build the base query to select from vw_requests_general
    let query = `
      SELECT 
        *
      FROM [vw_requests_general]
      WHERE 1=1
    `;

    // Add optional filters
    if (company) {
      query += ` AND company = @company`;
    }
    if (process) {
      query += ` AND process = @process`;
    }
    if (category) {
      query += ` AND category = @category`;
    }
    if (status && status !== '0') {
      query += ` AND statusCase = @status`;
    } else if (!status) {
      // Default to active requests (status = 'Abierto') if no status provided
      query += ` AND statusCase = 'Abierto'`;
    }
    if (assigned_user) {
      query += ` AND assignedUserName LIKE '%' + @assigned_user + '%'`;
    }
    if (requester) {
      query += ` AND requesterUser LIKE '%' + @requester + '%'`;
    }
    if (date_from && date_to) {
      query += ` AND created_at BETWEEN @date_from AND @date_to`;
    }
    if (date_resolution_from && date_resolution_to) {
      query += ` AND date_resolution BETWEEN @date_resolution_from AND @date_resolution_to`;
    }

    // Order by most recent requests first
    query += ` ORDER BY id DESC`;

    // Create and configure the request
    const request = pool.request();

    // Add parameters to prevent SQL injection
    if (company) {
      request.input('company', sql.NVarChar, company);
    }
    if (process) {
      request.input('process', sql.NVarChar, process);
    }
    if (category) {
      request.input('category', sql.NVarChar, category);
    }
    if (status) {
      request.input('status', sql.NVarChar, status);
    }
    if (assigned_user) {
      request.input('assigned_user', sql.NVarChar, assigned_user);
    }
    if (requester) {
      request.input('requester', sql.NVarChar, requester);
    }
    if (date_from && date_to) {
      request.input('date_from', sql.Date, date_from);
      request.input('date_to', sql.Date, date_to);
    }
    if (date_resolution_from && date_resolution_to) {
      request.input('date_resolution_from', sql.Date, date_resolution_from);
      request.input('date_resolution_to', sql.Date, date_resolution_to);
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
    console.error('Error executing vw_requests_general query:', error);

    // Return a user-friendly error response
    return NextResponse.json(
      {
        success: false,
        error: 'Error al obtener las solicitudes de la vista vw_requests_general',
        message: 'No se pudieron recuperar las solicitudes. Por favor intente nuevamente.',
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
