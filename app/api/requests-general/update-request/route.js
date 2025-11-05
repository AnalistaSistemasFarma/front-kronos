import sql from "mssql";
import sqlConfig from "../../../../dbconfig.js";

export async function POST(req) {
  try {
    const body = await req.json();
    const {
      id,
      status,
      user,
      id_company,
      category,
      descripcion,
    } = body;

    if (!id) {
      return new Response(
        JSON.stringify({
          error: 'ID de solicitud es requerido',
          details: 'Debe proporcionar el ID de la solicitud a actualizar',
        }),
        { status: 400 }
      );
    }

    const pool = await sql.connect(sqlConfig);
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      const updateRequestQuery = `
        UPDATE [requests_general]
        SET 
          [status] = @status,
          [user] = @user,
          id_company = @id_company,
          category = @category,
          [description] = @descripcion
        WHERE id = @id
      `;

      const request = new sql.Request(transaction);
      request.input('id', sql.Int, id);
      request.input('status', sql.NVarChar(50), status || 'Pendiente');
      request.input('user', sql.NVarChar(255), user);
      request.input('id_company', sql.Int, id_company);
      request.input('category', sql.NVarChar(255), category);
      request.input('descripcion', sql.NVarChar(1000), descripcion);

      await request.query(updateRequestQuery);
      await transaction.commit();

      return new Response(
        JSON.stringify({
          message: 'Solicitud actualizada exitosamente',
          id: id,
          success: true,
        }),
        { status: 200 }
      );
    } catch (dbError) {
      await transaction.rollback();
      console.error('Error en el proceso de actualización:', dbError);
      return new Response(
        JSON.stringify({
          error: 'Error al actualizar la solicitud en la base de datos',
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