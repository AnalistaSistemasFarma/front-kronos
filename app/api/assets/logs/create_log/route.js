import sql from 'mssql';
import sqlConfig from '../../../../../dbconfig';

export async function POST(req) {
  try {
    const body = await req.json();
    const {
      mensaje,
      idAsset,
    } = body;

    if (
      !mensaje ||
      !idAsset
    ) {
      return new Response(
        JSON.stringify({
          error: 'Campos obligatorios faltantes',
          details: 'Por favor complete todos los campos requeridos antes de enviar el formulario',
        }),
        { status: 400 }
      );
    }

    const pool = await sql.connect(sqlConfig);
    const transaction = new sql.Transaction(pool);
    // DateTime y no Date: con Date todas las entradas quedaban a las 12:00 a.m.
    const creation_date = new Date();

    try {
      await transaction.begin();

      const insertLogQuery = `
        INSERT INTO log_asset (
          creation_date,
          log_asset,
          id_asset
        )
        OUTPUT INSERTED.id
        VALUES (
          @creation_date,
          @mensaje,
          @idAsset
        );
      `;

      const request = new sql.Request(transaction);
      request.input('creation_date', sql.DateTime, creation_date);
      request.input('mensaje', sql.NVarChar(1000), mensaje);
      request.input('idAsset', sql.Int, idAsset);

      const logResult = await request.query(insertLogQuery);
      const newAssetId = logResult.recordset[0].id;

      await transaction.commit();

      return new Response(
        JSON.stringify({
          message: 'Nota agregada exitosamente',
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
          error: 'Error al crear la nota en la base de datos',
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