import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { checkAdminPrivileges } from '../../../lib/access-control';
import { prisma } from '../../../lib/prisma';
import { authOptions } from '../auth/[...nextauth]/route';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userEmail = session.user.email;
    const isAdmin = await checkAdminPrivileges(userEmail);

    // If admin, return all companies; otherwise return only user's companies
    if (isAdmin) {
      const allCompanies = await prisma.company.findMany({
        orderBy: {
          company: 'asc',
        },
      });

      const companies = allCompanies.map((c) => ({
        id: c.id_company,
        name: c.company,
      }));

      return NextResponse.json(companies);
    } else {
      // Fetch companies associated with the user
      const companyUsers = await prisma.companyUser.findMany({
        where: {
          user: {
            email: userEmail,
          },
        },
        include: {
          company: true,
        },
      });

      const companies = companyUsers.map((cu) => ({
        id: cu.company.id_company,
        name: cu.company.company,
      }));

      return NextResponse.json(companies);
    }
  } catch (error) {
    console.error('Error fetching companies:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
