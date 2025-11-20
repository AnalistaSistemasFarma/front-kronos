import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';

/**
 * Verify if user has permission to edit this request
 */
async function verifyEditPermission(pool, requestId, userEmail) {
  try {
    // Check if user has admin role
    const userQuery = `
      SELECT role 
        FROM [user] 
        WHERE email = @userEmail
    `;

    const userRequest = pool.request();
    userRequest.input('userEmail', sql.NVarChar(255), userEmail);
    const userResult = await userRequest.query(userQuery);

    if (userResult.recordset.length === 0) {
      return { hasPermission: false, reason: 'User not found' };
    }

    const userRole = userResult.recordset[0].role;
    const isAdmin = userRole === 'admin' || userRole === 'super_user';

    // If admin, grant permission
    if (isAdmin) {
      return { hasPermission: true, isAdmin: true, reason: 'Admin privileges' };
    }

    // For non-admin users, check if they are assigned to this request
    const assignmentQuery = `
      SELECT 
        pc.assigned as assignedUserId,
        assignedUser.name as assignedUserName
      FROM requests_general rg
      LEFT JOIN process_category pc ON pc.id = rg.id_process_category
      LEFT JOIN [user] assignedUser ON assignedUser.id = pc.assigned
      WHERE rg.id = @requestId
    `;

    const assignmentRequest = pool.request();
    assignmentRequest.input('requestId', sql.Int, requestId);
    const assignmentResult = await assignmentRequest.query(assignmentQuery);

    if (assignmentResult.recordset.length === 0) {
      return { hasPermission: false, reason: 'Request not found' };
    }

    const requestData = assignmentResult.recordset[0];
    const assignedUserName = requestData.assignedUserName;

    // Check if current user is assigned to this request
    const isAssignedUser =
      assignedUserName && assignedUserName.toLowerCase().trim() === userEmail.toLowerCase().trim();

    return {
      hasPermission: isAssignedUser,
      isAdmin: false,
      isAssignedUser,
      assignedUserName,
      reason: isAssignedUser ? 'Assigned to request' : 'Not assigned to this request',
    };
  } catch (error) {
    console.error('Error verifying edit permission:', error);
    return { hasPermission: false, reason: 'Error verifying permission' };
  }
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return new Response(
        JSON.stringify({
          error: 'No autorizado',
          details: 'Se requiere sesión activa para esta operación',
        }),
        { status: 401 }
      );
    }

    const body = await req.json();
    const { id, status, user, id_company, category, descripcion } = body;

    if (!id) {
      return new Response(
        JSON.stringify({
          error: 'ID de solicitud es requerido',
          details: 'Debe proporcionar el ID de la solicitud a actualizar',
        }),
        { status: 400 }
      );
    }

    const pool = await sql.connect(sqlConfig);
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      // Verify user has permission to edit this request
      const permissionCheck = await verifyEditPermission(pool, id, session.user.email);

      if (!permissionCheck.hasPermission) {
        await transaction.rollback();
        return new Response(
          JSON.stringify({
            error: 'Acceso denegado',
            details: `No tiene permisos para editar esta solicitud. ${permissionCheck.reason}`,
            code: 'ACCESS_DENIED',
          }),
          { status: 403 }
        );
      }

      console.log('Permission verified:', permissionCheck);

      const updateRequestQuery = `
        UPDATE [requests_general]
        SET 
          [status] = @status,
          [user] = @user,
          id_company = @id_company,
          category = @category,
          [description] = @descripcion
        WHERE id = @id
      `;

      const request = new sql.Request(transaction);
      request.input('id', sql.Int, id);
      request.input('status', sql.NVarChar(50), status || 'Pendiente');
      request.input('user', sql.NVarChar(255), user);
      request.input('id_company', sql.Int, id_company);
      request.input('category', sql.NVarChar(255), category);
      request.input('descripcion', sql.NVarChar(1000), descripcion);

      await request.query(updateRequestQuery);
      await transaction.commit();

      return new Response(
        JSON.stringify({
          message: 'Solicitud actualizada exitosamente',
          id: id,
          success: true,
        }),
        { status: 200 }
      );
    } catch (dbError) {
      await transaction.rollback();
      console.error('Error en el proceso de actualización:', dbError);
      return new Response(
        JSON.stringify({
          error: 'Error al actualizar la solicitud en la base de datos',
          details: 'No se pudo guardar la información. Por favor intente nuevamente.',
          technical: dbError.message,
        }),
        { status: 500 }
      );
    }
  } catch (err) {
    console.error('Error general en la solicitud:', err);
    return new Response(
      JSON.stringify({
        error: 'Error del servidor al procesar la solicitud',
        details: 'Ocurrió un error inesperado. Por favor intente nuevamente más tarde.',
        technical: err.message,
      }),
      { status: 500 }
    );
  } finally {
    try {
      if (sql && sql.pool) {
        await sql.close();
      }
    } catch (closeError) {
      console.error('Error closing database connection:', closeError);
    }
  }
}
