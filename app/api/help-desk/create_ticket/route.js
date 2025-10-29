import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';

export async function POST(req) {
  try {
    const body = await req.json();
    const {
      requestType,
      priority,
      technician,
      category,
      subcategory,
      site,
      requester,
      asunto,
      department,
      activity,
      description,
    } = body;

    if (
      !requestType ||
      !priority ||
      !category ||
      !subcategory ||
      !site ||
      !asunto ||
      !department ||
      !activity ||
      !description
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

      const insertCaseQuery = `
        INSERT INTO [case] (
          [description],
          subject_case,
          creation_date,
          id_technical,
          requester,
          place,
          id_department,
          case_type,
          [priority],
          id_status_case
        )
        OUTPUT INSERTED.id_case
        VALUES (
          @description,
          @asunto,
          @creation_date,
          @technician,
          @requester,
          @site,
          @department,
          @requestType,
          @priority,
          1
        );
      `;

      const request = new sql.Request(transaction);
      request.input('creation_date', sql.Date, creation_date);
      request.input('description', sql.Text, description);
      request.input('asunto', sql.NVarChar(1000), asunto);
      request.input('technician', sql.Int, technician || null);
      request.input('requester', sql.Int, requester);
      request.input('site', sql.NVarChar(1000), site);
      request.input('department', sql.Int, department);
      request.input('requestType', sql.NVarChar(50), requestType);
      request.input('priority', sql.NVarChar(1000), priority);

      const caseResult = await request.query(insertCaseQuery);
      const newCaseId = caseResult.recordset[0].id_case;

      const insertCategoryCaseQuery = `
        INSERT INTO category_case (id_case, id_category, id_subcategory, id_activity)
        VALUES (@id_case, @id_category, @id_subcategory, @id_activity);
      `;

      const categoryCaseRequest = new sql.Request(transaction);
      categoryCaseRequest.input('id_case', sql.Int, newCaseId);
      categoryCaseRequest.input('id_category', sql.Int, category);
      categoryCaseRequest.input('id_subcategory', sql.Int, subcategory);
      categoryCaseRequest.input('id_activity', sql.Int, activity);

      await categoryCaseRequest.query(insertCategoryCaseQuery);
      await transaction.commit();

      return new Response(
        JSON.stringify({
          message: 'Caso creado exitosamente',
          id_case: newCaseId,
          success: true,
        }),
        { status: 201 }
      );
    } catch (dbError) {
      await transaction.rollback();
      console.error('Error en el proceso de creación:', dbError);
      return new Response(
        JSON.stringify({
          error: 'Error al crear el caso en la base de datos',
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
