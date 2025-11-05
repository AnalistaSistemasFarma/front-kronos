import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';

const logAuditEvent = (event, userId, userName, ipAddress, success, details) => {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    event: 'GET_USER_ID_BY_NAME',
    userId: userId || 'anonymous',
    targetUserName: userName,
    ipAddress,
    success,
    details
  };
  
  console.log(`[AUDIT] ${JSON.stringify(logEntry)}`);
  
};

export async function GET(req) {
  const startTime = Date.now();
  let session = null;
  let ipAddress = req.headers.get('x-forwarded-for') || 
                  req.headers.get('x-real-ip') || 
                  'unknown';
  
  try {
    session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      logAuditEvent('SESSION_CHECK_FAILED', null, null, ipAddress, false, 'No session found');
      return NextResponse.json(
        { 
          success: false, 
          error: 'No autorizado', 
          code: 'UNAUTHORIZED' 
        },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const userName = searchParams.get('userName');

    if (!userName || userName.trim() === '') {
      logAuditEvent('MISSING_PARAMETER', session.user.email, null, ipAddress, false, 'Missing userName parameter');
      return NextResponse.json(
        { 
          success: false, 
          error: 'Nombre de usuario es requerido', 
          code: 'MISSING_USERNAME' 
        },
        { status: 400 }
      );
    }

    const pool = await sql.connect(sqlConfig);
    
    const query = `
      SELECT id 
      FROM [user] 
      WHERE [name] = @userName
    `;

    const request = pool.request();
    request.input('userName', sql.NVarChar(255), userName.trim());

    const result = await request.query(query);
    const duration = Date.now() - startTime;

    if (result.recordset.length === 0) {
      logAuditEvent('USER_NOT_FOUND', session.user.email, userName, ipAddress, false, `Query executed in ${duration}ms`);
      return NextResponse.json(
        { 
          success: false, 
          error: 'Usuario no encontrado', 
          code: 'USER_NOT_FOUND' 
        },
        { status: 404 }
      );
    }

    const userId = result.recordset[0].id;
    logAuditEvent('USER_FOUND', session.user.email, userName, ipAddress, true, `Query executed in ${duration}ms`);
    
    return NextResponse.json(
      { 
        success: true, 
        userId: userId,
        message: 'Usuario encontrado exitosamente'
      },
      { status: 200 }
    );

  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error.message || 'Error desconocido';
    
    logAuditEvent(
      'DATABASE_ERROR', 
      session?.user?.email || 'unknown', 
      null, 
      ipAddress, 
      false, 
      `Error after ${duration}ms: ${errorMessage}`
    );
    
    console.error('Error en get-user-id endpoint:', error);
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Error interno del servidor', 
        code: 'INTERNAL_ERROR',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
      },
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