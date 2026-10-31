import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getSalesAccess, isReady } from '../../../../lib/sales/access';

/** Empresas donde el usuario puede ver o crear ofertas de venta (sin credenciales). */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const access = await getSalesAccess(session.user.email);
  return NextResponse.json({
    companies: access.map((a) => ({ idCompany: a.idCompany, companyName: a.companyName, canRead: a.canRead, canWrite: a.canWrite, ready: isReady(a) })),
  });
}
