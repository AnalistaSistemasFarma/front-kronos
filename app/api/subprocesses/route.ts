import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { checkAdminPrivileges } from '../../../lib/access-control';
import { prisma } from '../../../lib/prisma';
import { authOptions } from '../auth/[...nextauth]/route';

// GET /api/subprocesses - Fetch all available subprocesses
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdmin = await checkAdminPrivileges(session.user.email);
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
