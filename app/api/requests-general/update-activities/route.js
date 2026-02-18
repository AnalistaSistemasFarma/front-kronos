import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';

export async function POST(req) {
  try {
    const body = await req.json();

    const {
      id,
      id_status,
      id_assigned,
      start_date,
      end_date,
      resolution,
    } = body;

    if (!id || !id_assigned) {
      return new Response(
        JSON.stringify({
          error: 'Faltan campos obligatorios',
        }),
        { status: 400 }
      );
    }

    const pool = await sql.connect(sqlConfig);
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      const updateQuery = `
        UPDATE task_request_general
        SET
          id_status = @id_status,
          start_date = @start_date,
          end_date = @end_date,
          resolution = @resolution,
          id_executor_final = @id_executor_final,
          date_resolution = CASE
            WHEN @resolution IS NOT NULL
                 AND LTRIM(RTRIM(@resolution)) <> ''
            THEN GETDATE()
            ELSE date_resolution
          END
        WHERE id = @id
      `;

      const request = new sql.Request(transaction);

      request.input('id', sql.Int, id);
      request.input('id_status', sql.Int, id_status);

      request.input(
        'start_date',
        sql.DateTime,
        start_date ? new Date(start_date) : null
      );

      request.input(
        'end_date',
        sql.DateTime,
        end_date ? new Date(end_date) : null
      );

      request.input(
        'resolution',
        sql.NVarChar(sql.MAX),
        resolution
      );

      request.input(
        'id_executor_final',
        sql.NVarChar(1000),
        id_assigned
      );

      await request.query(updateQuery);

      await transaction.commit();

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Tarea actualizada correctamente',
        }),
        { status: 200 }
      );

    } catch (err) {
      await transaction.rollback();

      console.error('DB Error:', err);

      return new Response(
        JSON.stringify({
          error: 'Error al actualizar en BD',
          details: err.message,
        }),
        { status: 500 }
      );
    }

  } catch (err) {
    console.error('Server Error:', err);

    return new Response(
      JSON.stringify({
        error: 'Error del servidor',
        details: err.message,
      }),
      { status: 500 }
    );
  }
}
