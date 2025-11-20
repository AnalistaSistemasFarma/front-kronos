import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';

export async function POST(req) {
  try {
    const body = await req.json();
    const {
      id,
      status,
      process_category,
      id_technical,
      resolucion,
    } = body;

    if (
      !id ||
      !id_technical
    ) {
      return new Response(
        JSON.stringify({
          error: 'Campos obligatorios faltantes',
          details: 'Por favor complete todos los campos requeridos antes de actualizar la solicitud.',
        }),
        { status: 400 }
      );
    }

    const pool = await sql.connect(sqlConfig);
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      const updateCaseQuery = `
        UPDATE requests_general
        SET
          status_req = @status,
		      id_process_category = @process_category,
          resolution = @resolucion,
          date_resolution = CASE 
            WHEN @resolucion IS NOT NULL AND LTRIM(RTRIM(@resolucion)) <> '' 
            THEN GETDATE()
            ELSE date_resolution
          END
        WHERE id = @id
      `;

      const updateCaseRequest = new sql.Request(transaction);
      updateCaseRequest.input('status', sql.Int, status || null);
      updateCaseRequest.input('process_category', sql.Int, process_category || null);
      updateCaseRequest.input('resolucion', sql.NVarChar(255), resolucion || null);
      updateCaseRequest.input('id', sql.Int, id);

      await updateCaseRequest.query(updateCaseQuery);

      await transaction.commit();

      return new Response(
        JSON.stringify({
          message: 'Caso actualizado exitosamente',
          success: true,
        }),
        { status: 200 }
      );
    } catch (dbError) {
      await transaction.rollback();
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
  } catch (err) {
    console.error('Error general en la solicitud:', err);

    return new Response(
      JSON.stringify({
        error: 'Error del servidor al procesar la solicitud',
        details: 'Ocurrió un error inesperado. Por favor intente nuevamente más tarde.',
        technical: err.message,
      }),
      { status: 500 }
    );
  }
}
