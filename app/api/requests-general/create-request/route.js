import { getServerSession } from "next-auth";
import {
  fireAndForgetNotification,
  notifyNewRequest,
} from "../../../../lib/notificationEvents.js";
import { syncRequestToSapsend } from "../../../../lib/sapsend/treasury.js";
import { createGeneralRequest } from "../../../../lib/requests-general/createGeneralRequest.js";
import { authOptions } from "../../auth/[...nextauth]/route";
import { sql, withMssqlPool } from "../../../../lib/mssqlPool";
import { isFirmaRequestCategoryOrProcess } from "../../../../lib/orion/access";
import { userHasOrionFirmaManage } from "../../../../lib/orion/service";

export async function POST(req) {
  try {
    const body = await req.json();

    const {
      company,
      subject,
      descripcion,
      process,
      createdby,
      url,
      formValues,
    } = body;

    if (!company || !subject || !process || !descripcion) {
      return new Response(
        JSON.stringify({ message: "Campos obligatorios faltantes" }),
        { status: 400 }
      );
    }

    const session = await getServerSession(authOptions);
    const userId = session?.user?.id ? String(session.user.id) : String(createdby || "");

    const processMeta = await withMssqlPool(async (pool) => {
      const result = await pool
        .request()
        .input("process", sql.Int, Number(process))
        .query(`
          SELECT TOP 1 cr.category, pc.process
          FROM process_category pc
          INNER JOIN category_request cr ON cr.id = pc.id_category_request
          WHERE pc.id = @process
        `);
      return result.recordset[0] || null;
    });

    if (
      processMeta &&
      isFirmaRequestCategoryOrProcess(processMeta.category, processMeta.process)
    ) {
      const canCreateFirma = await withMssqlPool((pool) =>
        userHasOrionFirmaManage(pool, userId)
      );
      if (!canCreateFirma) {
        return new Response(
          JSON.stringify({
            error:
              "No tiene permiso de Firma digital para crear solicitudes de esta categoría.",
          }),
          { status: 403 }
        );
      }
    }

    let result;
    try {
      result = await createGeneralRequest({
        company,
        subject,
        descripcion,
        process,
        createdby,
        url,
        formValues,
      });
    } catch (dbError) {
      console.error("Error en transacción:", dbError);
      return new Response(
        JSON.stringify({
          error: "Error al crear la solicitud",
          details: dbError.message,
        }),
        { status: 500 }
      );
    }

    const { id_request: newRequestId, processEmail, taskEmails } = result;

    fireAndForgetNotification(
      notifyNewRequest({
        requestId: newRequestId,
        subject,
        processEmail,
        taskEmails,
        requestUrl: url,
      })
    );

    // Integración SAPSEND: si es una solicitud de pago de tesorería, crea la solicitud de
    // tesorería en SAPSEND. No bloquea ni hace fallar la creación (el gate y el registro de
    // estado/errores viven dentro de syncRequestToSapsend).
    fireAndForgetNotification(syncRequestToSapsend(newRequestId));

    return new Response(
      JSON.stringify({
        message: "Solicitud creada correctamente",
        id_request: newRequestId,
        notifications: {
          processEmail,
          taskEmails,
        },
      }),
      { status: 201 }
    );
  } catch (err) {
    console.error("Error general:", err);

    return new Response(
      JSON.stringify({
        error: "Error general",
        details: err.message,
      }),
      { status: 500 }
    );
  }
}
