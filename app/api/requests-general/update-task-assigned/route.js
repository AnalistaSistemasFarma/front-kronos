import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';

export async function POST(req) {
  try {
    const body = await req.json();
    const { id, id_assigned } = body;

    if (!id || !id_assigned) {
      return new Response(
        JSON.stringify({ error: 'Faltan campos obligatorios' }),
        { status: 400 }
      );
    }

    const pool = await sql.connect(sqlConfig);

    const statusCheck = await pool
      .request()
      .input('id', sql.Int, id)
      .query(
        `SELECT sc.status
         FROM task_request_general trg
         INNER JOIN status_case sc ON sc.id_status_case = trg.id_status
         WHERE trg.id = @id`
      );

    if (statusCheck.recordset.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Tarea no encontrada' }),
        { status: 404 }
      );
    }

    const currentStatus = (statusCheck.recordset[0].status || '').toLowerCase();
    if (currentStatus === 'resuelto') {
      return new Response(
        JSON.stringify({ error: 'No se puede modificar el asignado de una tarea resuelta' }),
        { status: 409 }
      );
    }

    await pool
      .request()
      .input('id', sql.Int, id)
      .input('id_assigned', sql.NVarChar(255), String(id_assigned))
      .query(`UPDATE task_request_general SET id_assigned = @id_assigned WHERE id = @id`);

    return new Response(
      JSON.stringify({ success: true, message: 'Asignado actualizado correctamente' }),
      { status: 200 }
    );
  } catch (err) {
    console.error('Server Error:', err);
    return new Response(
      JSON.stringify({ error: 'Error del servidor', details: err.message }),
      { status: 500 }
    );
  }
}
