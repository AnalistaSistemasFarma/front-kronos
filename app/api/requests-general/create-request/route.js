import { getServerSession } from 'next-auth';
import {
  fireAndForgetNotification,
  notifyNewRequest,
  resolveEmailByUserId,
} from '../../../../lib/notificationEvents.js';
import { syncRequestToSapsend } from '../../../../lib/sapsend/treasury.js';
import { createGeneralRequest } from '../../../../lib/requests-general/createGeneralRequest.js';
import { authOptions } from '../../auth/[...nextauth]/route';

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
      return new Response(JSON.stringify({ message: 'Campos obligatorios faltantes' }), {
        status: 400,
      });
    }

    const session = await getServerSession(authOptions);
    // Preferir sesión: evita que un `createdby` del body deje otro usuario como solicitante.
    const userId = session?.user?.id ? String(session.user.id) : String(createdby || '');
    const requesterId = String(userId || createdby || '');

    let result;
    try {
      result = await createGeneralRequest({
        company,
        subject,
        descripcion,
        process,
        createdby: requesterId || createdby,
        url,
        formValues,
      });
    } catch (dbError) {
      console.error('Error en transacción:', dbError);
      return new Response(
        JSON.stringify({
          error: 'Error al crear la solicitud',
          details: dbError.message,
        }),
        { status: 500 }
      );
    }

    const { id_request: newRequestId, processEmail, processEmails, taskEmails } = result;

    const creatorEmail =
      (session?.user?.email && String(session.user.email).trim()) ||
      (await resolveEmailByUserId(requesterId)) ||
      null;

    fireAndForgetNotification(
      notifyNewRequest({
        requestId: newRequestId,
        subject,
        processEmail,
        processEmails,
        taskEmails,
        creatorEmail,
        requestUrl: url,
      })
    );

    // Integración SAPSEND: si es una solicitud de pago de tesorería, crea la solicitud de
    // tesorería en SAPSEND. No bloquea ni hace fallar la creación (el gate y el registro de
    // estado/errores viven dentro de syncRequestToSapsend).
    fireAndForgetNotification(syncRequestToSapsend(newRequestId));

    return new Response(
      JSON.stringify({
        message: 'Solicitud creada correctamente',
        id_request: newRequestId,
        notifications: {
          processEmail,
          processEmails,
          taskEmails,
          creatorEmail,
        },
      }),
      { status: 201 }
    );
  } catch (err) {
    console.error('Error general:', err);

    return new Response(
      JSON.stringify({
        error: 'Error general',
        details: err.message,
      }),
      { status: 500 }
    );
  }
}
