import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';
import {
  fireAndForgetNotification,
  notifyTicketToTechnicians,
} from '../../../../lib/notificationEvents.js';

/**
 * [case].requester es INT (legacy: id_company_user).
 * El asistente / sesión pueden mandar el cuid de [user].id → lo resolvemos.
 */
async function resolveRequesterCompanyUserId(transaction, requester, companyId) {
  if (requester == null || requester === '') return null;

  const asNum = Number(requester);
  if (
    Number.isFinite(asNum) &&
    Number.isInteger(asNum) &&
    asNum > 0 &&
    String(requester).trim() === String(asNum)
  ) {
    return asNum;
  }

  const userKey = String(requester).trim();
  const lookup = new sql.Request(transaction);
  lookup.input('userId', sql.NVarChar(255), userKey);
  const companyNum = Number(companyId);
  const hasCompany = Number.isFinite(companyNum) && companyNum > 0;
  if (hasCompany) lookup.input('companyId', sql.Int, companyNum);

  const result = await lookup.query(`
    SELECT TOP 1 cu.id_company_user
    FROM company_user cu
    WHERE CAST(cu.id_user AS NVARCHAR(255)) = @userId
    ${hasCompany ? 'ORDER BY CASE WHEN cu.id_company = @companyId THEN 0 ELSE 1 END, cu.id_company_user' : 'ORDER BY cu.id_company_user'}
  `);

  const id = result.recordset?.[0]?.id_company_user;
  return id != null ? Number(id) : null;
}

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
      company,
    } = body;

    if (
      !requestType ||
      !category ||
      !asunto ||
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

      const requesterId = await resolveRequesterCompanyUserId(
        transaction,
        requester,
        company,
      );
      if (requesterId == null) {
        await transaction.rollback();
        return new Response(
          JSON.stringify({
            error: 'No se pudo identificar el solicitante',
            details:
              'Tu usuario no tiene company_user asociado, o el id enviado no es válido. Revisa la sesión e inténtalo de nuevo.',
          }),
          { status: 400 },
        );
      }

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
          company,
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
          @company,
          1
        );
      `;

      const request = new sql.Request(transaction);
      request.input('creation_date', sql.Date, creation_date);
      request.input('description', sql.Text, description);
      request.input('asunto', sql.NVarChar(1000), asunto);
      request.input('technician', sql.Int, technician || null);
      request.input('requester', sql.Int, requesterId);
      request.input('site', sql.NVarChar(1000), site);
      request.input('department', sql.Int, department);
      request.input('requestType', sql.NVarChar(50), requestType);
      request.input('priority', sql.NVarChar(1000), priority);
      request.input('company', sql.Int, company);

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

      // Notificar a los técnicos que se creó un caso nuevo (restaurado: el
      // PR #146 lo había eliminado y dejó sin aviso el nuevo workflow).
      fireAndForgetNotification(
        notifyTicketToTechnicians({
          caseId: newCaseId,
          subject: asunto,
          technicianId: technician || null,
        })
      );

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
