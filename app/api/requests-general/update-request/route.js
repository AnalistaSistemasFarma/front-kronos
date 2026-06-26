import {
  fireAndForgetNotification,
  isRequestClosedStatus,
  notifyRequestClosed,
} from '../../../../lib/notificationEvents.js';
import { sql, withMssqlPool } from '../../../../lib/mssqlPool';

export async function POST(req) {
  try {
    const body = await req.json();
    const { id, status, process_category, id_technical, resolucion } = body;

    if (!id || !id_technical) {
      return new Response(
        JSON.stringify({
          error: 'Campos obligatorios faltantes',
          details:
            'Por favor complete todos los campos requeridos antes de actualizar la solicitud.',
        }),
        { status: 400 }
      );
    }

    const { prevRow } = await withMssqlPool(async (pool) => {
      const transaction = new sql.Transaction(pool);
      await transaction.begin();

      try {
        const prevResult = await new sql.Request(transaction)
          .input('id', sql.Int, id)
          .query(`
          SELECT rg.status_req, rg.subject_request, rg.id_requester
          FROM requests_general rg
          WHERE rg.id = @id
        `);
        const prevRow = prevResult.recordset[0];

        const updateCaseQuery = `
        UPDATE requests_general
        SET
          status_req = @status,
          resolution = @resolucion,
          id_executor_final = @id_executor_final,
          date_resolution = CASE 
            WHEN @resolucion IS NOT NULL AND LTRIM(RTRIM(@resolucion)) <> '' 
            THEN GETDATE()
            ELSE date_resolution
          END
        WHERE id = @id
      `;

        const updateCaseRequest = new sql.Request(transaction);
        updateCaseRequest.input('status', sql.Int, status);
        updateCaseRequest.input('resolucion', sql.NVarChar(255), resolucion || null);
        updateCaseRequest.input('id_executor_final', sql.NVarChar(1000), id_technical || null);
        updateCaseRequest.input('id', sql.Int, id);

        await updateCaseRequest.query(updateCaseQuery);

        if (process_category) {
          const updateCategoryQuery = `
          UPDATE process_category_request_general
          SET id_process_category = @process_category
          WHERE id_request_general = @id
        `;

          const updateCategoryRequest = new sql.Request(transaction);
          updateCategoryRequest.input('process_category', sql.Int, process_category);
          updateCategoryRequest.input('id', sql.Int, id);

          await updateCategoryRequest.query(updateCategoryQuery);
        }

        await transaction.commit();
        return { prevRow };
      } catch (dbError) {
        await transaction.rollback();
        throw dbError;
      }
    });

    const prevStatus = prevRow?.status_req ?? null;
    const nextStatus = status ?? null;

    if (isRequestClosedStatus(nextStatus) && !isRequestClosedStatus(prevStatus)) {
      fireAndForgetNotification(
        notifyRequestClosed({
          requestId: id,
          subject: prevRow?.subject_request,
          requesterUserId: prevRow?.id_requester,
          statusId: nextStatus,
        })
      );
    }

    return new Response(
      JSON.stringify({
        message: 'Caso actualizado exitosamente',
        success: true,
      }),
      { status: 200 }
    );
  } catch (dbError) {
    console.error('Error en el proceso de actualización:', dbError);

    return new Response(
      JSON.stringify({
        error: 'Error al actualizar el caso en la base de datos',
        details: 'No se pudo guardar la información. Por favor intente nuevamente.',
        technical: dbError.message,
      }),
      { status: 500 }
    );
  }
}
