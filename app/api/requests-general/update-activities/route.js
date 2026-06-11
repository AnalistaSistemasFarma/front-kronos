import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';
import {
  fireAndForgetNotification,
  isActivityResolvedStatus,
  notifyActivityResolved,
} from '../../../../lib/notificationEvents.js';

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

      const prevResult = await new sql.Request(transaction)
        .input('id', sql.Int, id)
        .query(`
          SELECT trg.id_status, trg.id_request_general, rg.subject_request, tpc.task
          FROM task_request_general trg
          INNER JOIN requests_general rg ON rg.id = trg.id_request_general
          LEFT JOIN task_process_category tpc ON tpc.id = trg.id_task
          WHERE trg.id = @id
        `);
      const prevRow = prevResult.recordset[0];

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

      const prevStatus = prevRow?.id_status ?? null;
      const nextStatus = id_status ?? null;

      if (isActivityResolvedStatus(nextStatus) && !isActivityResolvedStatus(prevStatus)) {
        fireAndForgetNotification(
          notifyActivityResolved({
            taskId: id,
            requestId: prevRow?.id_request_general,
            subject: prevRow?.subject_request,
            taskName: prevRow?.task,
            executorUserId: id_assigned,
          })
        );
      }

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
