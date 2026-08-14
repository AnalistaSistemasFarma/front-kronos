import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getPaymentAssistantAccess, toPublicAccess } from '../../../../lib/payment-assistant/access';

/**
 * Empresas a las que el usuario tiene acceso en el Asistente de Pagos. Vista
 * PUBLICA: no expone credenciales SAP (esas solo se usan en el route `proposal`,
 * en servidor).
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const access = await getPaymentAssistantAccess(session.user.email);
    return NextResponse.json({ companies: toPublicAccess(access) });
  } catch (error) {
    console.error('Error fetching payment-assistant access:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
