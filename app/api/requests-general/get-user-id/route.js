import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { sql, withMssqlPool } from '../../../../lib/mssqlPool';

const logAuditEvent = (event, userId, userName, ipAddress, success, details) => {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    event: 'GET_USER_ID_BY_NAME',
    userId: userId || 'anonymous',
    targetUserName: userName,
    ipAddress,
    success,
    details,
  };

  console.log(`[AUDIT] ${JSON.stringify(logEntry)}`);
};

export async function GET(req) {
  const startTime = Date.now();
  let session = null;
  const ipAddress =
    req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';

  try {
    session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      logAuditEvent('SESSION_CHECK_FAILED', null, null, ipAddress, false, 'No session found');
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
    const userName = searchParams.get('userName');
    const emailParam = searchParams.get('email');
    const sessionEmail = session.user.email?.trim() || '';
    const lookupEmail = (emailParam || sessionEmail || '').trim();

    if ((!userName || userName.trim() === '') && !lookupEmail) {
      logAuditEvent(
        'MISSING_PARAMETER',
        session.user.email,
        null,
        ipAddress,
        false,
        'Missing userName/email parameter'
      );
      return NextResponse.json(
        {
          success: false,
          error: 'Nombre de usuario o email es requerido',
          code: 'MISSING_USERNAME',
        },
        { status: 400 }
      );
    }

    const result = await withMssqlPool(async (pool) => {
      // 1) Por email (más confiable; mismo criterio que Help Desk)
      if (lookupEmail) {
        const byEmail = await pool
          .request()
          .input('email', sql.NVarChar(255), lookupEmail)
          .query(`
            SELECT TOP 1 id
            FROM [user]
            WHERE LOWER(LTRIM(RTRIM(email))) = LOWER(LTRIM(RTRIM(@email)))
          `);
        if (byEmail.recordset.length > 0) return byEmail;
      }

      // 2) Por nombre exacto
      if (userName?.trim()) {
        const byName = await pool
          .request()
          .input('userName', sql.NVarChar(255), userName.trim())
          .query(`
            SELECT TOP 1 id
            FROM [user]
            WHERE [name] = @userName
          `);
        if (byName.recordset.length > 0) return byName;

        // 3) Por nombre case-insensitive / trim
        const byNameLoose = await pool
          .request()
          .input('userName', sql.NVarChar(255), userName.trim())
          .query(`
            SELECT TOP 1 id
            FROM [user]
            WHERE LOWER(LTRIM(RTRIM([name]))) = LOWER(LTRIM(RTRIM(@userName)))
          `);
        if (byNameLoose.recordset.length > 0) return byNameLoose;
      }

      return { recordset: [] };
    });

    const duration = Date.now() - startTime;

    if (result.recordset.length === 0) {
      logAuditEvent(
        'USER_NOT_FOUND',
        session.user.email,
        userName,
        ipAddress,
        false,
        `Query executed in ${duration}ms`
      );
      return NextResponse.json(
        {
          success: false,
          error: 'Usuario no encontrado',
          code: 'USER_NOT_FOUND',
        },
        { status: 404 }
      );
    }

    const userId = result.recordset[0].id;
    logAuditEvent(
      'USER_FOUND',
      session.user.email,
      userName,
      ipAddress,
      true,
      `Query executed in ${duration}ms`
    );

    return NextResponse.json(
      {
        success: true,
        userId,
        message: 'Usuario encontrado exitosamente',
      },
      { status: 200 }
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error?.message || 'Error desconocido';
    const isAbort =
      error?.name === 'AbortError' ||
      /aborted|AbortError|ECONNRESET|ECANCELED/i.test(String(errorMessage));

    logAuditEvent(
      isAbort ? 'REQUEST_ABORTED' : 'DATABASE_ERROR',
      session?.user?.email || 'unknown',
      null,
      ipAddress,
      false,
      `Error after ${duration}ms: ${errorMessage}`
    );

    // El cliente canceló la petición (Strict Mode / remount): no es un fallo real.
    if (isAbort) {
      return NextResponse.json(
        {
          success: false,
          error: 'Solicitud cancelada',
          code: 'ABORTED',
        },
        { status: 499 }
      );
    }

    console.error('Error en get-user-id endpoint:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Error interno del servidor',
        code: 'INTERNAL_ERROR',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
      },
      { status: 500 }
    );
  }
}
