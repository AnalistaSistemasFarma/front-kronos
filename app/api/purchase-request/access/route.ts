import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { PrismaClient } from '../../../generated/prisma';
import { authOptions } from '../../auth/[...nextauth]/route';

const prisma = new PrismaClient();

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userEmail = session.user.email;

    // Get companies with access to purchase-request subprocess
    const companyAccess = await prisma.subprocessUserCompany.findMany({
      where: {
        companyUser: {
          user: {
            email: userEmail,
          },
        },
        subprocess: {
          subprocess_url: '/process/purchases/purchase-request',
        },
      },
      include: {
        companyUser: {
          include: {
            company: {
              include: {
                sap_endpoints: true,
              },
            },
          },
        },
      },
    });

    const companies = companyAccess.map((access) => ({
      id: access.companyUser.company.id_company,
      name: access.companyUser.company.company,
      sapEndpoint: access.companyUser.company.sap_endpoints[0] || null,
    }));

    return NextResponse.json({ companies });
  } catch (error) {
    console.error('Error fetching purchase-request access:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
