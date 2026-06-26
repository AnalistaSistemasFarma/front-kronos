import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';

/**
 * Proxy server-side para el servicio de correo (API_EMAIL).
 * El cliente llama a /api/email/send (mismo origen); el servidor reenvía a sapsend.
 */
function buildEmailTargetUrl(apiEmailBase) {
  const base = String(apiEmailBase).trim().replace(/\/+$/, '');
  return `${base}/sapsend/sendMessage`;
}

async function postToEmailService(targetUrl, payload) {
  const res = await fetch(targetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });

  const body = await res.text();
  return { status: res.status, body };
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
    }

    const apiEmail = process.env.API_EMAIL;
    if (!apiEmail) {
      console.error('[email/send] API_EMAIL no está configurada');
      return new Response(
        JSON.stringify({ error: 'Servicio de correo no configurado' }),
        { status: 500 }
      );
    }

    const { userEmail, title, table, outro, logoUrl } = await req.json();

    if (!userEmail || !String(userEmail).trim()) {
      return new Response(
        JSON.stringify({ error: 'Destinatario (userEmail) requerido' }),
        { status: 400 }
      );
    }

    const targetUrl = buildEmailTargetUrl(apiEmail);
    const payload = {
      userEmail,
      title,
      table,
      outro,
      logoUrl: logoUrl || 'https://farmalogica.com.co/imagenes/logos/logo20.png',
    };

    const { status, body } = await postToEmailService(targetUrl, payload);

    if (status < 200 || status >= 300) {
      console.error(`[email/send] ${targetUrl} respondió ${status}: ${body}`);
      return new Response(
        JSON.stringify({ error: 'El servicio de correo rechazó el envío', status, details: body }),
        { status: 502 }
      );
    }

    let parsed = null;
    try {
      parsed = body ? JSON.parse(body) : null;
    } catch {
      parsed = { raw: body };
    }

    return new Response(JSON.stringify({ success: true, result: parsed }), { status: 200 });
  } catch (err) {
    console.error('[email/send] Error reenviando al servicio de correo:', err);
    return new Response(
      JSON.stringify({ error: 'Error al enviar el correo', details: err?.message }),
      { status: 500 }
    );
  }
}
