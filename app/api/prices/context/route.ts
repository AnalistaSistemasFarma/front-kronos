import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { salesEndpointForUser } from '../../../../lib/sales/access';
import { currentPrices, customerContext } from '../../../../lib/prices/service';
import { sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Contexto del cliente para la actualización de precios y precio actual de artículos.
 * GET  ?companyId&cardCode                      -> { context }  (lista, si es compartida y cómo se aplicará)
 * POST { companyId, cardCode, itemCodes[] }     -> { context, prices: CurrentPrice[] }
 */
async function run(email: string, companyId: number, cardCode: string, codes: string[]) {
  const a = await salesEndpointForUser(email, companyId, 'write');
  if (!a?.endpoint) return NextResponse.json({ error: 'Sin permiso de Ventas en esta empresa.' }, { status: 403 });
  const sap = await sapLogin(a.endpoint);
  try {
    const context = await customerContext(sap, cardCode);
    const prices = codes.length ? [...(await currentPrices(sap, context, codes)).values()] : [];
    return NextResponse.json({ context, prices }, { headers: { 'Cache-Control': 'no-store' } });
  } finally {
    await sapLogout(sap);
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const sp = new URL(request.url).searchParams;
    const companyId = Number(sp.get('companyId'));
    const cardCode = String(sp.get('cardCode') ?? '').trim().slice(0, 50);
    if (!companyId || !cardCode) return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });
    return await run(session.user.email, companyId, cardCode, []);
  } catch (error) {
    if (error instanceof SapError) return NextResponse.json({ error: error.friendly }, { status: error.status });
    console.error('[prices/context] GET', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const companyId = Number(body.companyId);
    const cardCode = String(body.cardCode ?? '').trim().slice(0, 50);
    const codes = [...new Set((Array.isArray(body.itemCodes) ? body.itemCodes : []).map((c: unknown) => String(c ?? '').trim().slice(0, 50)).filter(Boolean))].slice(0, 300) as string[];
    if (!companyId || !cardCode) return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });
    return await run(session.user.email, companyId, cardCode, codes);
  } catch (error) {
    if (error instanceof SapError) return NextResponse.json({ error: error.friendly }, { status: error.status });
    console.error('[prices/context] POST', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
