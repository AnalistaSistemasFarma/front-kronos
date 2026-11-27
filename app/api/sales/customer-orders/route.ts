import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { salesEndpointForUser } from '../../../../lib/sales/access';
import { customerOrders, CUSTOMER_ORDERS_MONTHS } from '../../../../lib/sales/customerOrders';
import { sapLogin, sapLogout, SapError } from '../../../../lib/sap/serviceLayer';

/**
 * Customer's previous quotations, orders and invoices (last months), READ ONLY, for the PDF offer review.
 * GET ?companyId=&cardCode= -> { months, lines: CustomerOrderLine[] } (newest first).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const companyId = Number(request.nextUrl.searchParams.get('companyId'));
    const cardCode = String(request.nextUrl.searchParams.get('cardCode') ?? '').trim().slice(0, 50);
    if (!companyId || !cardCode) return NextResponse.json({ error: 'Faltan la empresa o el cliente.' }, { status: 400 });
    const access = await salesEndpointForUser(session.user.email, companyId, 'read');
    if (!access?.endpoint) return NextResponse.json({ error: 'Sin permiso para consultar ventas en esta empresa.' }, { status: 403 });
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
    const sap = await sapLogin(access.endpoint);
    try {
      const lines = await customerOrders(sap, cardCode, today);
      return NextResponse.json({ months: CUSTOMER_ORDERS_MONTHS, lines });
    } finally {
      await sapLogout(sap);
    }
  } catch (error) {
    if (error instanceof SapError) return NextResponse.json({ error: error.friendly }, { status: error.status });
    console.error('Error leyendo los pedidos anteriores del cliente:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
