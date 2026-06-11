import { createAndSendNotifications } from '../../../../lib/notifications.js';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401 });
    }

    const body = await req.json();
    const { emails, payload } = body;

    if (!Array.isArray(emails) || emails.length === 0) {
      return new Response(JSON.stringify({ error: 'emails (array) requerido' }), { status: 400 });
    }
    if (!payload?.title || !payload?.body) {
      return new Response(JSON.stringify({ error: 'payload.title y payload.body requeridos' }), { status: 400 });
    }

    const result = await createAndSendNotifications(emails, payload);
    return new Response(JSON.stringify(result), { status: 200 });
  } catch (err) {
    console.error('[push/send POST] Error:', err);
    return new Response(JSON.stringify({ error: 'Error al enviar push', details: err.message }), { status: 500 });
  }
}
