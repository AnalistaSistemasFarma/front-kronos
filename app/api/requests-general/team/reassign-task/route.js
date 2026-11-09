import sql from 'mssql';
import { NextResponse } from 'next/server';
import sqlConfig from '../../../../../dbconfig.js';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../auth/[...nextauth]/route';

const TAG = '[reassign-task]';

export async function POST(req) {
  const session = await getServerSession(authOptions);
  const sessionUserId = session?.user?.id ? String(session.user.id) : '';
  if (!sessionUserId) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  const taskId = Number(body?.taskId);
  const toUserId = body?.toUserId ? String(body.toUserId) : '';
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';

  if (!Number.isInteger(taskId) || !toUserId || !reason) {
    return NextResponse.json(
      { error: 'Faltan campos obligatorios (taskId, toUserId, reason)' },
      { status: 400 }
    );
  }

  let transaction;
  let committed = false;

  try {
    const pool = await sql.connect(sqlConfig);
    transaction = new sql.Transaction(pool);
    await transaction.begin();

    const update = await new sql.Request(transaction)
      .input('id', sql.Int, taskId)
      .input('id_assigned', sql.NVarChar, toUserId)
      .query(`
        UPDATE task_request_general
        SET id_assigned = @id_assigned
        WHERE id = @id
      `);

    if (update.rowsAffected[0] === 0) {
      await transaction.rollback();
      return NextResponse.json({ error: 'La tarea no existe' }, { status: 404 });
    }

    const noteText = `Se reasigna la tarea a otro usuario. Motivo: ${reason}`;
    await new sql.Request(transaction)
      .input('id', sql.Int, taskId)
      .input('note', sql.NVarChar(sql.MAX), noteText)
      .input('created_by', sql.NVarChar, sessionUserId)
      .query(`
        INSERT INTO notes (note, id_request, created_by)
        SELECT @note, t.id_request_general, @created_by
        FROM task_request_general t
        WHERE t.id = @id
      `);

    await transaction.commit();
    committed = true;

    console.log(`${TAG} Tarea ${taskId} reasignada por ${sessionUserId}.`);
    return NextResponse.json(
      { success: true, message: 'Tarea reasignada correctamente' },
      { status: 200 }
    );
  } catch (err) {
    if (transaction && !committed) {
      try {
        await transaction.rollback();
      } catch (rollbackErr) {
        console.error(`${TAG} Error en rollback:`, rollbackErr);
      }
    }
    console.error(`${TAG} Error:`, err);
    return NextResponse.json({ error: 'Error al reasignar la tarea' }, { status: 500 });
  }
}