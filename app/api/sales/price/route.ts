import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { salesEndpointForUser } from '../../../../lib/sales/access';
import { sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';
import { salesCompanyConfig } from '../../../../lib/sales/companyConfig';
import { customerPriceList, itemPriceFor } from '../../../../lib/sales/pricing';

/**
 * Precio de lista de un articulo para un cliente: precio especial del cliente o,
 * si no hay, el de la lista de precios del cliente (como el cargue masivo de SAPSEND); sin precio en esa lista,
 * la lista por defecto de la empresa (sales_company_config.id_price_list_default).
 * GET ?companyId&cardCode&itemCode -> { price: number | null, source, priceList }
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const sp = new URL(request.url).searchParams;
    const companyId = Number(sp.get('companyId'));
    const cardCode = (sp.get('cardCode') ?? '').trim().slice(0, 50);
    const itemCode = (sp.get('itemCode') ?? '').trim().slice(0, 50);
    if (!companyId || !cardCode || !itemCode) return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });
    const a = await salesEndpointForUser(session.user.email, companyId);
    if (!a?.endpoint) return NextResponse.json({ error: 'Sin acceso a ventas en esta empresa' }, { status: 403 });
    const conf = await salesCompanyConfig(companyId);
    const sap = await sapLogin(a.endpoint);
    try {
      const bpList = await customerPriceList(sap, cardCode);
      const p = await itemPriceFor(sap, cardCode, itemCode, bpList, conf?.priceListDefault ?? null);
      return NextResponse.json(p);
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) return NextResponse.json({ error: error.friendly }, { status: error.status });
    console.error('Error consultando el precio de lista:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
