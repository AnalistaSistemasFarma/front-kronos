import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { resolveUserIdByEmail } from '../../../../lib/request-general/dashboardAccess';
import { withMssqlPool } from '../../../../lib/mssqlPool';
import {
  SIGNATURE_AUTO_CLOSE_DEFAULT,
  SignatureAutoCloseUnavailableError,
  getSignatureAutoClose,
  saveSignatureAutoClose,
} from '../../../../lib/orion/autoCloseOnSigned';

/**
 * Cierre automático al terminar de firmar (interruptor en la lista de solicitudes).
 * GET → { available, enabled }   · por defecto enabled = true (activado para todos).
 * PUT { enabled: boolean } → guarda la preferencia de la persona de la sesión.
 */

async function sessionUserId() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  return resolveUserIdByEmail(email);
}

export async function GET() {
  try {
    const userId = await sessionUserId();
    if (!userId) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    let enabled = SIGNATURE_AUTO_CLOSE_DEFAULT;
    let available = true;
    try {
      enabled = await withMssqlPool((pool) => getSignatureAutoClose(pool, userId));
    } catch (err) {
      if (!(err instanceof SignatureAutoCloseUnavailableError)) throw err;
      available = false;
    }
    return NextResponse.json({ available, enabled }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Error GET /api/profile/signature-auto-close:', error);
    return NextResponse.json({ error: 'No se pudo cargar el cierre automático' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const userId = await sessionUserId();
    if (!userId) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const body = (await req.json().catch(() => null)) as { enabled?: unknown } | null;
    if (typeof body?.enabled !== 'boolean') {
      return NextResponse.json({ error: 'Valor no válido' }, { status: 400 });
    }

    await withMssqlPool((pool) => saveSignatureAutoClose(pool, userId, body.enabled as boolean));
    return NextResponse.json({ ok: true, enabled: body.enabled });
  } catch (error) {
    if (error instanceof SignatureAutoCloseUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error('Error PUT /api/profile/signature-auto-close:', error);
    return NextResponse.json({ error: 'No se pudo guardar el cierre automático' }, { status: 500 });
  }
}
