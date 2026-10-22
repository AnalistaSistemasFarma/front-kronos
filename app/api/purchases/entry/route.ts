import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { prisma } from '../../../../lib/prisma';

/**
 * ¿El proceso elegido en «Mis solicitudes» es la Solicitud de compra de esa
 * empresa? (purchase_company_config.id_process_category_auth). Si lo es, el
 * formulario generico no aplica: la solicitud se captura en el de Compras, con
 * lineas y validacion contra SAP, y el envio a autorizar crea la solicitud del
 * workflow. GET ?companyId&processId -> { isPurchase }.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const companyId = Number(searchParams.get('companyId'));
    const processId = Number(searchParams.get('processId'));
    if (!companyId || !processId) return NextResponse.json({ isPurchase: false });

    const config = await prisma.purchaseCompanyConfig.findUnique({ where: { id_company: companyId } });
    return NextResponse.json({ isPurchase: config?.id_process_category_auth === processId });
  } catch (error) {
    console.error('Error resolviendo el proceso de compras:', error);
    return NextResponse.json({ isPurchase: false });
  }
}
