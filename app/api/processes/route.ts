import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '../auth/[...nextauth]/route';
import { prisma } from '../../../lib/prisma';
import {
  getAssignedSubprocessIdsForUser,
} from '../../../lib/process/subprocessAssignments';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const assignedSubprocessIds = await getAssignedSubprocessIdsForUser(user.id);

    if (assignedSubprocessIds.length === 0) {
      return NextResponse.json([], {
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      });
    }

    const processes = await prisma.process.findMany({
      where: {
        subprocesses: {
          some: {
            id_subprocess: { in: assignedSubprocessIds },
          },
        },
      },
      include: {
        subprocesses: {
          where: {
            id_subprocess: { in: assignedSubprocessIds },
          },
          include: {
            subprocessUserCompanies: {
              where: {
                id_subprocess: { in: assignedSubprocessIds },
                companyUser: { id_user: user.id },
              },
              include: {
                companyUser: {
                  include: { company: true },
                },
                subprocess: {
                  select: { subprocess_url: true },
                },
              },
            },
          },
        },
      },
      orderBy: { process: 'asc' },
    });

    const normalized = processes
      .map((process) => ({
        ...process,
        subprocesses: process.subprocesses.filter(
          (sub) => sub.subprocessUserCompanies.length > 0
        ),
      }))
      .filter((process) => process.subprocesses.length > 0);

    return NextResponse.json(normalized, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    console.error('Error fetching processes:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
