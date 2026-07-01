import sql from 'mssql';
import sqlConfig from '../../../../dbconfig.js';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { checkHelpDeskOperatorAccess } from '../../../../lib/help-desk/access';
import {
  fireAndForgetNotification,
  isTicketClosedStatus,
  notifyTicketClosed,
  notifyTicketToTechnicians,
} from '../../../../lib/notificationEvents.js';
import { ensureCaseExecutorColumn } from '../../../../lib/help-desk/caseExecutorSql.js';

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
    }

    const hasOperatorAccess = await checkHelpDeskOperatorAccess(session.user.email);
    if (!hasOperatorAccess) {
      return new Response(
        JSON.stringify({ error: 'No tienes permiso para gestionar casos de mesa de ayuda' }),
        { status: 403 }
      );
    }

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
      email,
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
    await ensureCaseExecutorColumn(pool);

    const executorResult = await pool
      .request()
      .input('email', sql.NVarChar(255), session.user.email.trim())
      .query(`
        SELECT TOP 1 id, name
        FROM [user]
        WHERE LOWER(LTRIM(RTRIM(email))) = LOWER(LTRIM(RTRIM(@email)))
      `);
    const executorUserId = executorResult.recordset[0]?.id ?? null;
    const executorUserName = executorResult.recordset[0]?.name ?? session.user.name ?? null;

    const transaction = new sql.Transaction(pool);

    try {
      await transaction.begin();

      const prevResult = await new sql.Request(transaction)
        .input('id_case', sql.Int, id_case)
        .query(`
          SELECT c.id_technical, c.subject_case, c.id_status_case, c.requester
          FROM [case] c
          WHERE c.id_case = @id_case
        `);
      const prevRow = prevResult.recordset[0];

      const updateCaseQuery = `
        UPDATE [case]
        SET
          id_status_case = @status,
          priority = @priority,
          case_type = @case_type,
          id_department = @id_department,
          id_technical = @id_technical,
          place = @place,
          email = @email,
          resolution = @resolucion,
          end_date = CASE
            WHEN @status IN (2, 3) THEN COALESCE(end_date, SYSDATETIME())
            WHEN @status IN (1, 4) THEN NULL
            ELSE end_date
          END,
          id_executor_final = CASE
            WHEN @status IN (2, 3) AND @prev_status NOT IN (2, 3) THEN @id_executor_final
            WHEN @status IN (1, 4) THEN NULL
            ELSE id_executor_final
          END
        WHERE id_case = @id_case;
      `;

      const updateCaseRequest = new sql.Request(transaction);
      updateCaseRequest.input('status', sql.Int, status || null);
      updateCaseRequest.input('priority', sql.NVarChar(1000), priority);
      updateCaseRequest.input('case_type', sql.NVarChar(50), case_type);
      updateCaseRequest.input('id_department', sql.Int, id_department);
      updateCaseRequest.input('id_technical', sql.Int, id_technical || null);
      updateCaseRequest.input('place', sql.NVarChar(1000), place);
      updateCaseRequest.input('email', sql.NVarChar(255), email?.trim() || null);
      updateCaseRequest.input('resolucion', sql.Text, resolucion || null);
      updateCaseRequest.input('id_executor_final', sql.NVarChar(255), executorUserId);
      updateCaseRequest.input('prev_status', sql.Int, prevRow?.id_status_case ?? null);
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

      const prevTechnical = prevRow?.id_technical ?? null;
      const nextTechnical = id_technical || null;
      const prevStatus = prevRow?.id_status_case ?? null;
      const nextStatus = status ?? null;

      if (
        nextTechnical &&
        prevTechnical != null &&
        Number(nextTechnical) !== Number(prevTechnical)
      ) {
        fireAndForgetNotification(
          notifyTicketToTechnicians({
            caseId: id_case,
            subject: prevRow?.subject_case,
            technicianId: nextTechnical,
            isReassignment: true,
          })
        );
      }

      if (
        isTicketClosedStatus(nextStatus) &&
        !isTicketClosedStatus(prevStatus)
      ) {
        fireAndForgetNotification(
          notifyTicketClosed({
            caseId: id_case,
            subject: prevRow?.subject_case,
            requesterUserId: prevRow?.requester,
            statusId: nextStatus,
          })
        );
      }

      return new Response(
        JSON.stringify({
          message: 'Caso actualizado exitosamente',
          success: true,
          executor_final: executorUserName,
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
