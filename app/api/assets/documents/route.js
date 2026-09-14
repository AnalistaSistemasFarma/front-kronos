import sql from 'mssql';
import sqlConfig from '../../../../dbconfig';

export async function POST(req) {
  try {
    const body = await req.json();
    const {
      signature,
      nombre_tecnico_entrego,
      fecha_entrega,
      id_user_asset,
      sede,
      id_assets,
      usuario,
    } = body;

    const pool = await sql.connect(sqlConfig);
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      const insertCreateUserQuery = `
        INSERT INTO document_signatures (
          signature_received,
          delivery_date,
          name_technical_delivery,
          id_assets,
          id_user,
          place
        )
        OUTPUT INSERTED.id
        VALUES (
          @signature,
          @fecha_entrega,
          @nombre_tecnico_entrego,
          @id_assets,
          @id_user_asset,
          @sede
        );
      `;

      const request = new sql.Request(transaction);
      request.input('signature', sql.Text, signature);
      request.input('fecha_entrega', sql.Date, fecha_entrega);
      request.input('nombre_tecnico_entrego', sql.NVarChar(100), nombre_tecnico_entrego);
      request.input('id_assets', sql.Int, id_assets);
      request.input('id_user_asset', sql.Int, id_user_asset);
      request.input('sede', sql.NVarChar(100), sede);

      const createUserResult = await request.query(insertCreateUserQuery);
      const newAssetId = createUserResult.recordset[0].id;

      // El activo queda asignado a quien firmó el acta. Va en la misma
      // transacción: acta firmada y activo asignado son el mismo hecho.
      const updateAssetQuery = `
        UPDATE assets
        SET id_user_asset = @asset_user
        WHERE id = @asset_id;
      `;

      const updateAssetRequest = new sql.Request(transaction);
      updateAssetRequest.input('asset_user', sql.Int, id_user_asset);
      updateAssetRequest.input('asset_id', sql.Int, id_assets);

      await updateAssetRequest.query(updateAssetQuery);

      await transaction.commit();

      return new Response(
        JSON.stringify({
          message: 'Acta creada exitosamente',
          id_log: newAssetId,
          success: true,
        }),
        { status: 201 }
      );
    } catch (dbError) {
      await transaction.rollback();
      console.error('Error en el proceso de creación:', dbError);
      return new Response(
        JSON.stringify({
          error: 'Error al crear el acta en la base de datos',
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