import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getSalesAccess, isReady } from '../../../../lib/sales/access';
import { salesCompanyConfig } from '../../../../lib/sales/companyConfig';

/** Empresas donde el usuario puede ver o crear ofertas de venta (sin credenciales). */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const access = await getSalesAccess(session.user.email);
  const companies = await Promise.all(
    access.map(async (a) => {
      // Parámetros de la empresa que necesita el formulario (sin datos sensibles).
      const c = await salesCompanyConfig(a.idCompany).catch(() => null);
      return {
        idCompany: a.idCompany, companyName: a.companyName, canRead: a.canRead, canWrite: a.canWrite, ready: isReady(a),
        options: c ? { pedidoDirecto: Boolean(c.processDirecta), descripcionEditable: c.descripcionEditable, exigeOc: c.exigeOc } : null,
      };
    })
  );
  return NextResponse.json({ companies });
}
