import sql from 'mssql';
import sqlConfig from '../../../../dbconfig';

export async function PATCH(req) {
  try {
    
    const body = await req.json();
    const {
      id,  
      name,
      model,
      serial,
      label,
      id_subtype_asset,
      id_user_asset,
      id_status_asset,
      processor,
      ram,
      storage,
      equipment_cost,
      active,
      site,
      os,
      invoice,
      renewal,
      renewal_date,
      exit_record,
      sim,
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

      const updateAssetQuery = `
        UPDATE assets
        SET
          name = @name,
          model = @model,
          serial = @serial,
          label = @label,
          id_subtype_asset = @id_subtype_asset,
          id_user_asset = @id_user_asset,
          id_status_asset = @id_status_asset,
          processor = @processor,
          ram = @ram,
          storage = @storage,
          equipment_cost = @equipment_cost,
          active = @active,
          site = @site,
          [so] = @os,
          invoice = @invoice,
          renovation = @renewal,
          date_renovation = @renewal_date,
          out_minute = @exit_record,
          sim = @sim
        WHERE id = @id;
      `;

      const updateAssetRequest = new sql.Request(transaction);
      updateAssetRequest.input('name', sql.NVarChar(255), name);
      updateAssetRequest.input('model', sql.NVarChar(255), model);
      updateAssetRequest.input('serial', sql.NVarChar(255), serial);
      updateAssetRequest.input('label', sql.NVarChar(255), label);
      updateAssetRequest.input('id_subtype_asset', sql.Int, id_subtype_asset);
      updateAssetRequest.input('id_user_asset', sql.Int, id_user_asset);
      updateAssetRequest.input('id_status_asset', sql.Int, id_status_asset);
      updateAssetRequest.input('processor', sql.NVarChar(255), processor);
      updateAssetRequest.input('ram', sql.NVarChar(255), ram);
      updateAssetRequest.input('storage', sql.NVarChar(255), storage);
      updateAssetRequest.input('equipment_cost', sql.Decimal(10, 2), equipment_cost);
      updateAssetRequest.input('active', sql.Bit, active);
      updateAssetRequest.input('site', sql.NVarChar(255), site);
      updateAssetRequest.input('os', sql.NVarChar(255), os);
      updateAssetRequest.input('invoice', sql.NVarChar(255), invoice);
      updateAssetRequest.input('renewal', sql.Bit, renewal);
      updateAssetRequest.input('renewal_date', sql.Date, renewal_date);
      updateAssetRequest.input('exit_record', sql.Text, exit_record);
      updateAssetRequest.input('sim', sql.NVarChar(255), sim);
      updateAssetRequest.input('id', sql.Int, id);

      await updateAssetRequest.query(updateAssetQuery);

      await transaction.commit();

      return new Response(
        JSON.stringify({
          message: 'activo actualizado exitosamente',
          success: true,
        }),
        { status: 200 }
      );
    } catch (dbError) {
      await transaction.rollback();
      console.error('Error en el proceso de actualización:', dbError);

      return new Response(
        JSON.stringify({
          error: 'Error al actualizar el activo en la base de datos',
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
