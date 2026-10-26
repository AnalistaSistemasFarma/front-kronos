import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { sendToQuotation } from '../../../../../lib/purchases/authorization';

/**
 * «Cotizar»: el autorizador envia a Compras una solicitud por autorizar (LA -> ENC).
 * Body: { companyId, docEntry, reason? }. No requiere permiso de Compras: decide
 * quien puede decidir la tarea de autorizacion (misma regla de la bandeja).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const companyId = Number(body.companyId);
    const docEntry = Number(body.docEntry);
    if (!companyId || !Number.isInteger(docEntry) || docEntry <= 0) {
      return NextResponse.json({ error: 'Falta companyId o docEntry' }, { status: 400 });
    }

    const result = await sendToQuotation({
      companyId,
      docEntry,
      userEmail: session.user.email,
      reason: typeof body.reason === 'string' ? body.reason.slice(0, 254) : null,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, state: 'ENC' });
  } catch (error) {
    console.error('Error enviando solicitud de compra a cotizacion:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
