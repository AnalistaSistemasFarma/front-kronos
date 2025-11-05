import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';

export async function POST(req) {
  try {
    const body = await req.json();
    const {
      id_case,
      status,
      priority,
      case_type,
      id_category,
      place,
      id_subcategory,
      id_activity,
      id_department,
      id_technical,
      resolucion,
    } = body;

    if (
      !id_case ||
      !priority ||
      !case_type ||
      !id_category ||
      !id_subcategory ||
      !id_activity ||
      !id_department
    ) {
      return new Response(
        JSON.stringify({
          error: 'Campos obligatorios faltantes',
          details: 'Por favor complete todos los campos requeridos antes de actualizar el caso.',
        }),
        { status: 400 }
      );
    }

    const pool = await sql.connect(sqlConfig);
    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      const updateCaseQuery = `
        UPDATE [case]
        SET
          id_status_case = @status,
          priority = @priority,
          case_type = @case_type,
          id_department = @id_department,
          id_technical = @id_technical,
          place = @place,
          resolution = @resolucion
        WHERE id_case = @id_case;
      `;

      const updateCaseRequest = new sql.Request(transaction);
      updateCaseRequest.input('status', sql.Int, status || null);
      updateCaseRequest.input('priority', sql.NVarChar(1000), priority);
      updateCaseRequest.input('case_type', sql.NVarChar(50), case_type);
      updateCaseRequest.input('id_department', sql.Int, id_department);
      updateCaseRequest.input('id_technical', sql.Int, id_technical || null);
      updateCaseRequest.input('place', sql.NVarChar(1000), place);
      updateCaseRequest.input('resolucion', sql.Text, resolucion || null);
      updateCaseRequest.input('id_case', sql.Int, id_case);

      await updateCaseRequest.query(updateCaseQuery);

      const updateCategoryCaseQuery = `
        UPDATE category_case
        SET
          id_category = @id_category,
          id_subcategory = @id_subcategory,
          id_activity = @id_activity
        WHERE id_case = @id_case;
      `;

      const updateCategoryCaseRequest = new sql.Request(transaction);
      updateCategoryCaseRequest.input('id_category', sql.Int, id_category);
      updateCategoryCaseRequest.input('id_subcategory', sql.Int, id_subcategory);
      updateCategoryCaseRequest.input('id_activity', sql.Int, id_activity);
      updateCategoryCaseRequest.input('id_case', sql.Int, id_case);

      await updateCategoryCaseRequest.query(updateCategoryCaseQuery);

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
