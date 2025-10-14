import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '../../../app/generated/prisma';
import { authOptions } from '../auth/[...nextauth]/route';

const prisma = new PrismaClient();

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userEmail = session.user.email;

    // Get processes for the authenticated user
    const processes = await prisma.process.findMany({
      where: {
        subprocesses: {
          some: {
            subprocessUserCompanies: {
              some: {
                companyUser: {
                  user: {
                    email: userEmail,
                  },
                },
              },
            },
          },
        },
      },
      include: {
        subprocesses: {
          where: {
            subprocessUserCompanies: {
              some: {
                companyUser: {
                  user: {
                    email: userEmail,
                  },
                },
              },
            },
          },
          include: {
            subprocessUserCompanies: {
              where: {
                companyUser: {
                  user: {
                    email: userEmail,
                  },
                },
              },
              include: {
                companyUser: {
                  include: {
                    company: true,
                  },
                },
                subprocess: {
                  select: {
                    subprocess_url: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        process: 'asc',
      },
    });

    return NextResponse.json(processes);
  } catch (error) {
    console.error('Error fetching processes:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
