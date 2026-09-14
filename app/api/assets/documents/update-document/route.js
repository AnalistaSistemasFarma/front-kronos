import sql from 'mssql';
import sqlConfig from '../../../../../dbconfig';

// Usuario al que vuelve el activo cuando se registra la devolución.
const DEFAULT_USER_ASSET_ID = 86;

export async function PATCH(req) {
  try {
    
    const body = await req.json();
    const {
      id,  
      fecha_devolucion,
      nombre_tecnico_recibio,
      firma_devolucion,
      id_assets,
    } = body;

    if (
      !id
    ) {
      return new Response(
        JSON.stringify({
          error: 'Campos obligatorios faltantes',
          details: 'Por favor complete todos los campos requeridos antes de actualizar el activo.',
        }),
        { status: 400 }
      );
    }

    const pool = await sql.connect(sqlConfig);
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      const updateDocumentQuery = `
        UPDATE document_signatures
        SET
          devolution_date = @fecha_devolucion,
          name_technical_received = @nombre_tecnico_recibio,
          signature_devolution = @firma_devolucion,
          active_minute = 0
        WHERE id = @id;
      `;

      const updateAssetRequest = new sql.Request(transaction);
      updateAssetRequest.input('fecha_devolucion', sql.Date, fecha_devolucion);
      updateAssetRequest.input('nombre_tecnico_recibio', sql.NVarChar(255), nombre_tecnico_recibio);
      updateAssetRequest.input('firma_devolucion', sql.Text, firma_devolucion);
      updateAssetRequest.input('id', sql.Int, id);

      await updateAssetRequest.query(updateDocumentQuery);

      // Al devolver, el activo vuelve al usuario por defecto (sin asignar).
      if (id_assets) {
        const releaseAssetQuery = `
          UPDATE assets
          SET id_user_asset = @default_user
          WHERE id = @asset_id;
        `;

        const releaseAssetRequest = new sql.Request(transaction);
        releaseAssetRequest.input('default_user', sql.Int, DEFAULT_USER_ASSET_ID);
        releaseAssetRequest.input('asset_id', sql.Int, id_assets);

        await releaseAssetRequest.query(releaseAssetQuery);
      }

      await transaction.commit();

      return new Response(
        JSON.stringify({
          message: 'Documento actualizado exitosamente',
          success: true,
        }),
        { status: 200 }
      );
    } catch (dbError) {
      await transaction.rollback();
      console.error('Error en el proceso de actualización:', dbError);

      return new Response(
        JSON.stringify({
          error: 'Error al actualizar el documento en la base de datos',
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
