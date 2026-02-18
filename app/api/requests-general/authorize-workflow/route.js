import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';

/**
 * Authorize a workflow by changing its status from "En borrador" (id_status = 6) to "Activo" (id_status = 1)
 * Only category leaders can authorize workflows
 */
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json(
        { success: false, error: 'No autorizado', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { id_process } = body;

    if (!id_process) {
      return NextResponse.json(
        { success: false, error: 'ID del proceso es requerido', code: 'MISSING_ID' },
        { status: 400 }
      );
    }

    const pool = await sql.connect(sqlConfig);

    try {
      // Get user ID
      const userQuery = `
        SELECT id FROM [user] WHERE email = @email
      `;
      const userRequest = pool.request();
      userRequest.input('email', sql.NVarChar(255), session.user.email);
      const userResult = await userRequest.query(userQuery);

      if (userResult.recordset.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Usuario no encontrado', code: 'USER_NOT_FOUND' },
          { status: 404 }
        );
      }

      const userId = userResult.recordset[0].id;

      // Verify the workflow exists and is in "En borrador" status
      const workflowQuery = `
        SELECT 
          pc.id,
          pc.id_status,
          pc.process,
          ucrg.id_user as id_category_leader
        FROM process_category pc
        INNER JOIN category_request cr ON cr.id = pc.id_category_request
        LEFT JOIN user_category_request_general ucrg ON ucrg.id_category = cr.id
        WHERE pc.id = @id_process
      `;

      const workflowRequest = pool.request();
      workflowRequest.input('id_process', sql.Int, id_process);
      const workflowResult = await workflowRequest.query(workflowQuery);

      if (workflowResult.recordset.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Flujo de trabajo no encontrado', code: 'WORKFLOW_NOT_FOUND' },
          { status: 404 }
        );
      }

      const workflow = workflowResult.recordset[0];

      // Check if workflow is in "En borrador" status (id_status = 6)
      if (workflow.id_status !== 6) {
        return NextResponse.json(
          { 
            success: false, 
            error: 'El flujo de trabajo no está en estado "En borrador"', 
            code: 'INVALID_STATUS' 
          },
          { status: 400 }
        );
      }

      // Check if user is the category leader
      const isCategoryLeader = workflow.id_category_leader === userId;

      // Also check if user is admin
      const roleQuery = `
        SELECT role FROM [user] WHERE id = @userId
      `;
      const roleRequest = pool.request();
      roleRequest.input('userId', sql.NVarChar(1000), userId);
      const roleResult = await roleRequest.query(roleQuery);
      const isAdmin = roleResult.recordset[0]?.role === 'admin' || roleResult.recordset[0]?.role === 'super_user';

      if (!isCategoryLeader && !isAdmin) {
        return NextResponse.json(
          { 
            success: false, 
            error: 'No tiene permisos para autorizar este flujo de trabajo', 
            code: 'FORBIDDEN' 
          },
          { status: 403 }
        );
      }

      // Update status to "Activo" (id_status = 1)
      const updateQuery = `
        UPDATE process_category
        SET id_status = 1
        WHERE id = @id_process
      `;

      await pool.request()
        .input('id_process', sql.Int, id_process)
        .query(updateQuery);

      return NextResponse.json({
        success: true,
        message: 'Flujo de trabajo autorizado correctamente',
        workflowName: workflow.process
      });

    } catch (dbError) {
      console.error('Database error:', dbError);
      return NextResponse.json(
        { 
          success: false, 
          error: 'Error al autorizar el flujo de trabajo', 
          details: dbError.message 
        },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('Error in authorize-workflow endpoint:', error);
    return NextResponse.json(
      { success: false, error: 'Error interno del servidor', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
