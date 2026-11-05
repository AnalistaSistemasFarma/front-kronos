import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../../lib/purchases/access';
import { sendToAuthorize } from '../../../../../lib/purchases/authorization';
import { sapLogin, sapLogout, SapError } from '../../../../../lib/sap/serviceLayer';

/**
 * Envia un borrador de solicitud de compra (B o ENC) a autorizar en el modulo de
 * Autorizaciones de SynerLink y lo deja en LA. Body: { companyId, docEntry }.
 * Requiere permiso de ESCRITURA en la empresa.
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

    const company = await getCompanyEndpointForUser(session.user.email, companyId, 'write');
    if (!company?.endpoint) {
      return NextResponse.json({ error: 'No tiene permiso de escritura en esta empresa' }, { status: 403 });
    }

    const sap = await sapLogin(company.endpoint);
    try {
      const result = await sendToAuthorize({
        sap,
        companyId,
        docEntry,
        userEmail: session.user.email,
        subject: typeof body.subject === 'string' ? body.subject : null,
      });
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
      return NextResponse.json(result);
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) {
      return NextResponse.json({ error: error.friendly }, { status: error.status });
    }
    console.error('Error enviando solicitud de compra a autorizar:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
