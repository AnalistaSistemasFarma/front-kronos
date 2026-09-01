import {
  fireAndForgetNotification,
  isRequestClosedStatus,
  notifyRequestClosed,
} from '../../../../lib/notificationEvents.js';
import { sql, withMssqlPool } from '../../../../lib/mssqlPool';

function getMssqlErrorMessage(err) {
  if (Array.isArray(err?.precedingErrors) && err.precedingErrors.length > 0) {
    return err.precedingErrors.map((e) => e.message).join(' | ');
  }
  const original = err?.originalError?.message;
  if (original && original !== err?.message) {
    return `${err.message}: ${original}`;
  }
  return err?.message ?? 'Error desconocido';
}

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

    const requestId = Number(id);
    const statusId = Number(status);

    if (!Number.isInteger(requestId) || requestId <= 0) {
      return new Response(
        JSON.stringify({
          error: 'Solicitud inválida',
          details: 'El identificador de la solicitud no es válido.',
        }),
        { status: 400 }
      );
    }

    if (!Number.isInteger(statusId) || statusId <= 0) {
      return new Response(
        JSON.stringify({
          error: 'Estado inválido',
          details: 'Debe seleccionar un estado válido antes de guardar.',
        }),
        { status: 400 }
      );
    }

    const processCategoryId =
      process_category != null && process_category !== ''
        ? Number(process_category)
        : null;

    if (
      processCategoryId != null &&
      (!Number.isInteger(processCategoryId) || processCategoryId <= 0)
    ) {
      return new Response(
        JSON.stringify({
          error: 'Proceso inválido',
          details: 'La categoría de proceso seleccionada no es válida.',
        }),
        { status: 400 }
      );
    }

    const { prevRow } = await withMssqlPool(async (pool) => {
      const prevResult = await pool
        .request()
        .input('id', sql.Int, requestId)
        .query(`
          SELECT rg.status_req, rg.subject_request, rg.id_requester
          FROM requests_general rg
          WHERE rg.id = @id
        `);

      const prevRow = prevResult.recordset[0];
      if (!prevRow) {
        const notFound = new Error('Solicitud no encontrada');
        notFound.statusCode = 404;
        throw notFound;
      }

      await pool
        .request()
        .input('status', sql.Int, statusId)
        .input('resolucion', sql.NVarChar(sql.MAX), resolucion || null)
        .input('id_executor_final', sql.NVarChar(1000), id_technical || null)
        .input('id', sql.Int, requestId)
        .query(`
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
        `);

      if (processCategoryId) {
        const categoryResult = await pool
          .request()
          .input('process_category', sql.Int, processCategoryId)
          .input('id', sql.Int, requestId)
          .query(`
            UPDATE process_category_request_general
            SET id_process_category = @process_category
            WHERE id_request_general = @id
          `);

        if ((categoryResult.rowsAffected[0] ?? 0) === 0) {
          await pool
            .request()
            .input('process_category', sql.Int, processCategoryId)
            .input('id', sql.Int, requestId)
            .query(`
              INSERT INTO process_category_request_general (id_request_general, id_process_category)
              VALUES (@id, @process_category)
            `);
        }
      }

      return { prevRow };
    });

    const prevStatus = prevRow?.status_req ?? null;

    if (isRequestClosedStatus(statusId) && !isRequestClosedStatus(prevStatus)) {
      fireAndForgetNotification(
        notifyRequestClosed({
          requestId,
          subject: prevRow?.subject_request,
          requesterUserId: prevRow?.id_requester,
          statusId,
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
    const technical = getMssqlErrorMessage(dbError);
    console.error('Error en el proceso de actualización:', dbError);

    if (dbError?.statusCode === 404) {
      return new Response(
        JSON.stringify({
          error: 'Solicitud no encontrada',
          details: 'No se encontró la solicitud indicada.',
          technical,
        }),
        { status: 404 }
      );
    }

    return new Response(
      JSON.stringify({
        error: 'Error al actualizar el caso en la base de datos',
        details: 'No se pudo guardar la información. Por favor intente nuevamente.',
        technical,
      }),
      { status: 500 }
    );
  }
}
