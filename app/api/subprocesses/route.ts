import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { PrismaClient } from '../../../app/generated/prisma';
import { authOptions } from '../auth/[...nextauth]/route';

const prisma = new PrismaClient();

// Helper function to check if user has admin permissions
async function checkAdminPermission(userEmail: string): Promise<boolean> {
  try {
    const adminSubprocess = await prisma.subprocessUserCompany.findFirst({
      where: {
        companyUser: {
          user: {
            email: userEmail,
          },
        },
        subprocess: {
          subprocess_url: '/process/administration/users',
        },
      },
    });
    return !!adminSubprocess;
  } catch (error) {
    console.error('Error checking admin permission:', error);
    return false;
  }
}

// GET /api/subprocesses - Fetch all available subprocesses
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdmin = await checkAdminPermission(session.user.email);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const subprocesses = await prisma.subprocess.findMany({
      include: {
        process: {
          select: {
            id_process: true,
            process: true,
          },
        },
      },
      orderBy: [
        {
          process: {
            process: 'asc',
          },
        },
        {
          subprocess: 'asc',
        },
      ],
    });

    return NextResponse.json({ subprocesses });
  } catch (error) {
    console.error('Error fetching subprocesses:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
