import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';

export async function POST(req) {
  try {
    const body = await req.json();

    const {
      id_process,
      process,
      description,
      active,
      id_status,
      cost_center,
      id_user_assigned
    } = body;

    if (!id_process) {
      return new Response(
        JSON.stringify({ error: 'ID del proceso es requerido' }),
        { status: 400 }
      );
    }

    if (!process || !process.trim()) {
      return new Response(
        JSON.stringify({ error: 'El nombre del proceso es requerido' }),
        { status: 400 }
      );
    }

    if (!id_user_assigned) {
      return new Response(
        JSON.stringify({ error: 'El usuario asignado es requerido' }),
        { status: 400 }
      );
    }

    const pool = await sql.connect(sqlConfig);
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      const updateProcessQuery = `
        UPDATE process_category
        SET
          process = @process,
          description = @description,
          active = @active,
          id_status = @id_status,
          cost_center = @cost_center
        WHERE id = @id_process
      `;

      const processRequest = new sql.Request(transaction);
      processRequest.input('id_process', sql.Int, id_process);
      processRequest.input('process', sql.NVarChar(1000), process);
      processRequest.input('description', sql.NVarChar(sql.MAX), description || null);
      processRequest.input('active', sql.Int, active !== undefined ? active : 1);
      processRequest.input('id_status', sql.Int, id_status || 6);
      processRequest.input('cost_center', sql.NVarChar(1000), cost_center || null);

      await processRequest.query(updateProcessQuery);

      const deleteAssignedQuery = `
        DELETE FROM user_process_category_request_general
        WHERE id_process_category = @id_process
      `;

      await new sql.Request(transaction)
        .input('id_process', sql.Int, id_process)
        .query(deleteAssignedQuery);

      const insertAssignedQuery = `
        INSERT INTO user_process_category_request_general
        (id_process_category, id_user)
        VALUES (@id_process, @id_user)
      `;

      await new sql.Request(transaction)
        .input('id_process', sql.Int, id_process)
        .input('id_user', sql.NVarChar(1000), id_user_assigned)
        .query(insertAssignedQuery);

      await transaction.commit();

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Proceso actualizado correctamente',
        }),
        { status: 200 }
      );

    } catch (dbError) {
      await transaction.rollback();
      console.error('Error en transacción:', dbError);
      return new Response(
        JSON.stringify({
          error: 'Error al actualizar el proceso',
          details: dbError.message,
        }),
        { status: 500 }
      );
    }

  } catch (err) {
    console.error('Error general:', err);
    return new Response(
      JSON.stringify({
        error: 'Error del servidor',
        details: err.message,
      }),
      { status: 500 }
    );
  }
}
