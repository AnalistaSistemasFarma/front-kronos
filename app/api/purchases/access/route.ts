import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/route';
import { getPurchasesAccess, toPublicAccess } from '../../../../lib/purchases/access';
import { prisma } from '../../../../lib/prisma';

/**
 * Empresas a las que el usuario tiene acceso de lectura en el modulo de compras.
 * Vista PUBLICA: no expone credenciales SAP.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const access = await getPurchasesAccess(session.user.email);

    // Mapeo SAPSEND PROPIO del usuario por empresa (para las variantes «Mis
    // solicitudes» y «Mi area», como en SAPSEND). No incluye credenciales.
    const mappings = await prisma.companyUser.findMany({
      where: { user: { email: session.user.email } },
      select: { id_company: true, id_user_sapsend: true, id_department_sapsend: true },
    });
    const byCompany = new Map(mappings.map((m) => [m.id_company, m]));
    const companies = toPublicAccess(access).map((c) => ({
      ...c,
      sapsendUserId: byCompany.get(c.idCompany)?.id_user_sapsend ?? null,
      sapsendDepartmentId: byCompany.get(c.idCompany)?.id_department_sapsend ?? null,
    }));
    return NextResponse.json({ companies });
  } catch (error) {
    console.error('Error fetching purchases access:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
