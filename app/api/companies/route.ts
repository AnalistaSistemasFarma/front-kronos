import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '../../../app/generated/prisma';
import { authOptions } from '../auth/[...nextauth]/route';

const prisma = new PrismaClient();

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id as string;

    // Fetch companies associated with the user
    const companyUsers = await prisma.companyUser.findMany({
      where: {
        id_user: userId,
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
  } catch (error) {
    console.error('Error fetching companies:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
