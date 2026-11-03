import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { salesEndpointForUser } from '../../../../lib/sales/access';
import { sapGet, sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Precio de lista de un articulo para un cliente: precio especial del cliente o,
 * si no hay, el de la lista de precios del cliente (como el cargue masivo de SAPSEND).
 * GET ?companyId&cardCode&itemCode -> { price: number | null }
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
    const esc = (v: string) => encodeURIComponent(v.replace(/'/g, "''"));
    const sap = await sapLogin(a.endpoint);
    try {
      try {
        const spc = await sapGet<{ Price?: number }>(sap, `SpecialPrices(CardCode='${esc(cardCode)}',ItemCode='${esc(itemCode)}')?$select=Price`);
        if (spc?.Price != null) return NextResponse.json({ price: Number(spc.Price), source: 'especial' });
      } catch {
        /* sin precio especial */
      }
      const bp = await sapGet<{ PriceListNum?: number }>(sap, `BusinessPartners('${esc(cardCode)}')?$select=PriceListNum`);
      const item = await sapGet<{ ItemPrices?: { PriceList: number; Price: number }[] }>(sap, `Items('${esc(itemCode)}')?$select=ItemPrices`);
      const p = item.ItemPrices?.find((x) => Number(x.PriceList) === Number(bp.PriceListNum));
      return NextResponse.json({ price: p ? Number(p.Price) : null, source: 'lista' });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) return NextResponse.json({ error: error.friendly }, { status: error.status });
    console.error('Error consultando el precio de lista:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
