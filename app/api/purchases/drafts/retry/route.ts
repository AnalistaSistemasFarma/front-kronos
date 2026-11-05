import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../../auth/[...nextauth]/route';
import { getCompanyEndpointForUser } from '../../../../../lib/purchases/access';
import { retryPublish } from '../../../../../lib/purchases/authorization';
import { runSapExecutors } from '../../../../../lib/workflow-sap/engine';
import { prisma } from '../../../../../lib/prisma';

/**
 * Reintenta publicar la firme de una solicitud YA AUTORIZADA cuya publicacion en
 * SAP fallo (estado 'publish_error'). Es idempotente: nunca duplica la firme.
 * Body: { companyId, docEntry }. Requiere permiso de ESCRITURA en la empresa.
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
    if (!company) return NextResponse.json({ error: 'No tiene permiso de escritura en esta empresa' }, { status: 403 });

    const link = await prisma.purchaseAuthorization.findFirst({
      where: { id_company: companyId, doc_entry: docEntry, status: 'publish_error' },
    });
    if (!link) {
      return NextResponse.json({ error: 'No hay una publicacion fallida para reintentar.' }, { status: 404 });
    }

    const result = await retryPublish(link.id_request_general);
    // Si la publicación la hace una tarea «Ejecutora SAP», cerrarla y avanzar el flujo.
    await runSapExecutors(link.id_request_general, 'retry');
    if (result.skipped) return NextResponse.json({ error: 'La publicacion ya esta en curso.' }, { status: 409 });
    if (result.status !== 'approved') return NextResponse.json({ error: result.error }, { status: 502 });
    return NextResponse.json({ ok: true, status: result.status });
  } catch (error) {
    console.error('Error reintentando publicacion de compra:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
