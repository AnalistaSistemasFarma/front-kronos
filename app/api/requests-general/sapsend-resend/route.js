import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';
import { syncRequestToSapsend } from '../../../../lib/sapsend/treasury.js';

// POST /api/requests-general/sapsend-resend  { id }
// Reintenta el envío de una solicitud de pago a SAPSEND. Seguro por la idempotencia del contrato.
export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const id = Number(body?.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'Se requiere un id de solicitud válido' }, { status: 400 });
    }

    const result = await syncRequestToSapsend(id);

    if (result?.skipped) {
      return NextResponse.json(
        { error: 'La solicitud no es de pago de tesorería; no aplica el envío a SAPSEND.' },
        { status: 400 }
      );
    }

    return NextResponse.json(result, { status: result?.ok ? 200 : 502 });
  } catch (err) {
    console.error('Error en sapsend-resend:', err);
    return NextResponse.json(
      { error: 'Error procesando el reenvío', details: err.message },
      { status: 500 }
    );
  }
}
