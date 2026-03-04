import sql from 'mssql';
import { NextResponse } from 'next/server';
import sqlConfig from '../../../../dbconfig';

/**
 * API Route for executing the view_cases view from Kronos_db database
 *
 * GET /api/help-desk/view-cases
 *
 * Returns all cases from the view_cases database view in JSON format
 *
 * View columns:
 * - case_type: Type of the case
 * - creation_date: Date when the case was created
 * - description: Detailed description of the case
 * - id_case: Unique identifier for the case
 * - place: Location of the case
 * - priority: Priority level of the case
 * - subject_case: Subject/title of the case
 * - category: Category of the case
 * - subcategory: Subcategory of the case
 * - activity: Activity related to the case
 * - status: Status of the case (e.g., 'Abierto', 'Cerrado')
 * - nombreTecnico: Name of the assigned technician
 * - department: Department associated with the case
 * - company: Company associated with the case
 *
 * Query Parameters (optional):
 * - priority: Filter by priority level (string)
 * - status: Filter by status (string, e.g., 'Abierto', 'Cerrado')
 * - technician: Filter by technician name (string)
 * - date_from: Filter by creation date (start, format: YYYY-MM-DD)
 * - date_to: Filter by creation date (end, format: YYYY-MM-DD)
 * - company: Filter by company name (string)
 * - assigned_user: Filter by assigned user name (partial match, string)
 *
 * @returns {Array} List of cases from view_cases view
 * @returns {Object} Error object if request fails
 */
export async function GET(req: Request) {
  let pool: sql.ConnectionPool | null = null;

  try {
    // Connect to the database
    pool = await sql.connect(sqlConfig);

    // Parse query parameters
    const { searchParams } = new URL(req.url);
    const priority = searchParams.get('priority');
    const status = searchParams.get('status');
    const assigned_user = searchParams.get('assigned_user');
    const date_from = searchParams.get('date_from');
    const date_to = searchParams.get('date_to');
    const technician = searchParams.get('technician');
    const company = searchParams.get('company');

    // Build the base query to select from view_cases
    let query = `
      SELECT 
        *
      FROM [view_cases]
      WHERE 1=1
    `;

    // Add optional filters
    if (priority) {
      query += ` AND priority = @priority`;
    }
    if (company) {
      query += ` AND company = @company`;
    }
    if (status && status !== '0') {
      query += ` AND status = @status`;
    } else if (!status) {
      // Default to active cases (status = 'Abierto') if no status provided
      query += ` AND status = 'Abierto'`;
    }
    if (assigned_user) {
      query += ` AND nombreTecnico LIKE '%' + @assigned_user + '%'`;
    }
    if (technician) {
      query += ` AND nombreTecnico = @technician`;
    }
    if (date_from && date_to) {
      query += ` AND creation_date BETWEEN @date_from AND @date_to`;
    }

    // Order by most recent cases first
    query += ` ORDER BY id_case DESC`;

    // Create and configure the request
    const request = pool.request();

    // Add parameters to prevent SQL injection
    if (priority) {
      request.input('priority', sql.NVarChar, priority);
    }
    if (status) {
      request.input('status', sql.NVarChar, status);
    }
    if (company) {
      request.input('company', sql.NVarChar, company);
    }
    if (assigned_user) {
      request.input('assigned_user', sql.NVarChar, assigned_user);
    }
    if (technician) {
      request.input('technician', sql.NVarChar, technician);
    }
    if (date_from && date_to) {
      request.input('date_from', sql.Date, date_from);
      request.input('date_to', sql.Date, date_to);
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
    console.error('Error executing view_cases query:', error);

    // Return a user-friendly error response
    return NextResponse.json(
      {
        success: false,
        error: 'Error al obtener los casos de la vista view_cases',
        message: 'No se pudieron recuperar los casos. Por favor intente nuevamente.',
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
