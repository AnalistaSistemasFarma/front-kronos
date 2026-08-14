import {
  fireAndForgetNotification,
  notifyNewRequest,
} from "../../../../lib/notificationEvents.js";
import { syncRequestToSapsend } from "../../../../lib/sapsend/treasury.js";
import { createGeneralRequest } from "../../../../lib/requests-general/createGeneralRequest.js";

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
