import sql from 'mssql';
import sqlConfig from '../../../../dbconfig';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';

export async function PATCH(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { id, all } = body;

    const pool = await sql.connect(sqlConfig);

    if (all === true) {
      await pool
        .request()
        .input('email', sql.NVarChar(255), session.user.email)
        .query(
          `UPDATE notifications SET read_at = GETUTCDATE() WHERE email = @email AND read_at IS NULL`
        );
    } else if (id) {
      await pool
        .request()
        .input('id', sql.Int, id)
        .input('email', sql.NVarChar(255), session.user.email)
        .query(
          `UPDATE notifications SET read_at = GETUTCDATE() WHERE id = @id AND email = @email AND read_at IS NULL`
        );
    } else {
      return NextResponse.json({ error: 'Debe enviarse id o all=true' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[PATCH /api/notifications/read] Error:', err);
    return NextResponse.json({ error: 'Error al marcar como leída' }, { status: 500 });
  }
}
