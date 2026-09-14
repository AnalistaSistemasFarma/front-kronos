import sql from 'mssql';
import sqlConfig from '../../../../dbconfig';

export async function POST(req) {
  try {
    const body = await req.json();
    const {
      name,
      model,
      serial,
      label,
      id_subtype_asset,
      id_user_asset,
      processor,
      ram,
      storage,
      id_status_asset,
      equipment_cost,
      os,
      site,
      purchaseDate,
      sim,
      active,
      nombretecnico,
      id_company_asset,
    } = body;

    if (
      !name ||
      !model ||
      !serial
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
    const creation_date = new Date().toISOString().split('T')[0];

    try {
      await transaction.begin();

      const insertAssetQuery = `
        INSERT INTO assets (
          [name],
          [model],
          [serial],
          [label],
          id_subtype_asset,
          id_user_asset,
          processor,
          ram,
          storage,
          id_status_asset,
          equipment_cost,
          so,
          site,
          purchaseDate,
          sim,
          active,
          id_company_asset
        )
        OUTPUT INSERTED.id
        VALUES (
          @name,
          @model,
          @serial,
          @label,
          @id_subtype_asset,
          @id_user_asset,
          @processor,
          @ram,
          @storage,
          @id_status_asset,
          @equipment_cost,
          @os,
          @site,
          @purchaseDate,
          @sim,
          @active,
          @id_company_asset
        );
      `;

      const request = new sql.Request(transaction);
      request.input('name', sql.NVarChar(1000), name);
      request.input('model', sql.NVarChar(1000), model);
      request.input('serial', sql.NVarChar(1000), serial);
      request.input('label', sql.NVarChar(1000), label || null);
      request.input('id_subtype_asset', sql.Int, id_subtype_asset);
      request.input('id_user_asset', sql.Int, id_user_asset);
      request.input('processor', sql.NVarChar(1000), processor || null);
      request.input('ram', sql.NVarChar(1000), ram || null);
      request.input('storage', sql.NVarChar(1000), storage || null);
      request.input('id_status_asset', sql.Int, id_status_asset);
      request.input('equipment_cost', sql.Decimal(18, 2), equipment_cost || 0);
      request.input('os', sql.NVarChar(1000), os || null);
      request.input('site', sql.NVarChar(1000), site || null);
      request.input('purchaseDate', sql.Date, purchaseDate || null);
      request.input('sim', sql.NVarChar(1000), sim || null);
      request.input('active', sql.TinyInt, active || 1);
      request.input('id_company_asset', sql.Int, id_company_asset);
      const assetResult = await request.query(insertAssetQuery);
      const newAssetId = assetResult.recordset[0].id;

      const autor = nombretecnico || 'Sistema';
      const insertLogQuery = `
        INSERT INTO log_asset (
          creation_date,
          log_asset,
          id_asset
        )
        VALUES (
          @log_date,
          @log_mensaje,
          @log_id_asset
        );
      `;

      const logRequest = new sql.Request(transaction);
      logRequest.input('log_date', sql.DateTime, new Date());
      logRequest.input('log_mensaje', sql.NVarChar(1000), `Equipo creado por ${autor}`);
      logRequest.input('log_id_asset', sql.Int, newAssetId);

      await logRequest.query(insertLogQuery);

      await transaction.commit();

      return new Response(
        JSON.stringify({
          message: 'Activo creado exitosamente',
          id_asset: newAssetId,
          success: true,
        }),
        { status: 201 }
      );
    } catch (dbError) {
      await transaction.rollback();
      console.error('Error en el proceso de creación:', dbError);
      return new Response(
        JSON.stringify({
          error: 'Error al crear el activo en la base de datos',
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