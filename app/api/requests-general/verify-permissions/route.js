import sql from 'mssql';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getPool } from '../../../../lib/mssqlPool';

/**
 * Verify if user has permission to edit a specific request
 * Users can edit if they are:
 * 1. Admin (role 'admin' or 'super_user')
 * 2. Assigned to the request through process_category
 */
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json(
        {
          success: false,
          error: 'No autorizado',
          code: 'UNAUTHORIZED',
        },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { requestId, userEmail } = body;

    if (!requestId || !userEmail) {
      return NextResponse.json(
        {
          success: false,
          error: 'ID de solicitud y correo electrónico son requeridos',
          code: 'MISSING_PARAMETERS',
        },
        { status: 400 }
      );
    }

    const pool = await getPool();

    // First check if user has admin role
    const userQuery = `
      SELECT role 
      FROM [user] 
      WHERE email = @userEmail
    `;

    const userRequest = pool.request();
    userRequest.input('userEmail', sql.NVarChar(255), userEmail);
    const userResult = await userRequest.query(userQuery);

    if (userResult.recordset.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Usuario no encontrado',
          code: 'USER_NOT_FOUND',
        },
        { status: 404 }
      );
    }

    const userRole = userResult.recordset[0].role;
    const isAdmin = userRole === 'admin' || userRole === 'super_user';

    // If admin, grant permission
    if (isAdmin) {
      return NextResponse.json({
        success: true,
        canEdit: true,
        isAdmin: true,
        reason: 'Admin privileges',
      });
    }

    // For non-admin users, check if they are assigned to the request
    const assignmentQuery = `
      SELECT 
        rg.id,
        rg.subject_request as subject,
        pc.assigned as assignedUserId,
        assignedUser.name as assignedUserName,
        requesterUser.name as requesterName
      FROM requests_general rg
      LEFT JOIN process_category pc ON pc.id = rg.id_process_category
      LEFT JOIN [user] assignedUser ON assignedUser.id = pc.assigned
      LEFT JOIN [user] requesterUser ON requesterUser.id = rg.id_requester
      WHERE rg.id = @requestId
    `;

    const assignmentRequest = pool.request();
    assignmentRequest.input('requestId', sql.Int, requestId);
    const assignmentResult = await assignmentRequest.query(assignmentQuery);

    if (assignmentResult.recordset.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Solicitud no encontrada',
          code: 'REQUEST_NOT_FOUND',
        },
        { status: 404 }
      );
    }

    const requestData = assignmentResult.recordset[0];
    const assignedUserName = requestData.assignedUserName;

    // Check if current user is assigned to this request
    const isAssignedUser =
      assignedUserName &&
      assignedUserName.toLowerCase().trim() === userEmail.toLowerCase().trim();

    return NextResponse.json({
      success: true,
      canEdit: isAssignedUser,
      isAdmin: false,
      isAssignedUser,
      assignedUserName,
      requesterName: requestData.requesterName,
      reason: isAssignedUser ? 'Assigned to request' : 'Not assigned to this request',
    });
  } catch (error) {
    if (error?.message?.includes?.('Database') || error?.code) {
      console.error('Database error in permission verification:', error);
      return NextResponse.json(
        {
          success: false,
          error: 'Error del servidor al verificar permisos',
          code: 'DATABASE_ERROR',
          details: error.message,
        },
        { status: 500 }
      );
    }
    console.error('Error in permission verification endpoint:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Error interno del servidor',
        code: 'INTERNAL_ERROR',
      },
      { status: 500 }
    );
  }
}

export async function GET(req) {
  // For GET requests, we can return user role information
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json(
        {
          success: false,
          error: 'No autorizado',
          code: 'UNAUTHORIZED',
        },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const userEmail = searchParams.get('email');

    if (!userEmail) {
      return NextResponse.json(
        {
          success: false,
          error: 'Correo electrónico es requerido',
          code: 'MISSING_EMAIL',
        },
        { status: 400 }
      );
    }

    if (userEmail.toLowerCase() !== session.user.email.toLowerCase()) {
      return NextResponse.json(
        {
          success: false,
          error: 'No autorizado para consultar otro usuario',
          code: 'FORBIDDEN',
        },
        { status: 403 }
      );
    }

    const pool = await getPool();

    const userQuery = `
      SELECT 
        u.role,
        u.name,
        u.email
      FROM [user] u
      WHERE u.email = @userEmail
    `;

    const userRequest = pool.request();
    userRequest.input('userEmail', sql.NVarChar(255), userEmail);
    const userResult = await userRequest.query(userQuery);

    if (userResult.recordset.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Usuario no encontrado',
          code: 'USER_NOT_FOUND',
        },
        { status: 404 }
      );
    }

    const userData = userResult.recordset[0];
    const isAdmin = userData.role === 'admin' || userData.role === 'super_user';

    return NextResponse.json({
      success: true,
      user: {
        email: userData.email,
        name: userData.name,
        role: userData.role,
        isAdmin,
      },
    });
  } catch (error) {
    console.error('Error in user info endpoint:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Error interno del servidor',
        code: 'INTERNAL_ERROR',
      },
      { status: 500 }
    );
  }
}
