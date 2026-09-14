import sql from 'mssql';
import sqlConfig from '../../../../../dbconfig';

export async function POST(req) {
  try {
    const body = await req.json();
    const {
      usuario,
      cargo,
      cedula,
      correo,
      id_department,
    } = body;

    const pool = await sql.connect(sqlConfig);
    const transaction = new sql.Transaction(pool);
    const creation_date = new Date().toISOString().split('T')[0];

    try {
      await transaction.begin();

      const insertCreateUserQuery = `
        INSERT INTO user_asset (
          username_asset,
          rol,
          identification,
          email,
          id_department
        )
        OUTPUT INSERTED.id
        VALUES (
          @usuario,
          @cargo,
          @cedula,
          @correo,
          @id_department
        );
      `;

      const request = new sql.Request(transaction);
      request.input('usuario', sql.NVarChar(50), usuario);
      request.input('cargo', sql.NVarChar(50), cargo);
      request.input('cedula', sql.NVarChar(50), cedula);
      request.input('correo', sql.NVarChar(255), correo);
      request.input('id_department', sql.Int, id_department);

      const createUserResult = await request.query(insertCreateUserQuery);
      const newAssetId = createUserResult.recordset[0].id;

      await transaction.commit();

      return new Response(
        JSON.stringify({
          message: 'Usuario creado exitosamente',
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
          error: 'Error al crear el usuario en la base de datos',
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