import { createRequestGeneral } from '../../../../lib/requests-general/createRequest';

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
        JSON.stringify({ message: 'Campos obligatorios faltantes' }),
        { status: 400 }
      );
    }

    try {
      const created = await createRequestGeneral({
        company,
        subject,
        descripcion,
        process,
        createdby,
        url,
        formValues,
      });

      return new Response(
        JSON.stringify({
          message: 'Solicitud creada correctamente',
          id_request: created.id_request,
          notifications: {
            processEmail: created.processEmail,
            taskEmails: created.taskEmails,
          },
        }),
        { status: 201 }
      );
    } catch (dbError) {
      if (dbError.status === 400) {
        return new Response(JSON.stringify({ message: dbError.message }), { status: 400 });
      }

      console.error('Error en transacción:', dbError);

      return new Response(
        JSON.stringify({
          error: 'Error al crear la solicitud',
          details: dbError.message,
        }),
        { status: 500 }
      );
    }
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
