import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { checkAdminPrivileges } from '../../../../../lib/access-control';
import { prisma } from '../../../../../lib/prisma';
import {
  consolidateDuplicateCompanyUsers,
  getUserCompanyUsersWithSubprocesses,
  groupAssignmentsByCompany,
  normalizeSubprocessIds,
} from '../../../../../lib/process/subprocessAssignments';
import { authOptions } from '../../../auth/[...nextauth]/route';

// GET /api/users/[id]/subprocesses - Fetch assigned subprocesses for a user
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdmin = await checkAdminPrivileges(session.user.email);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { id: userId } = await params;
    const companyUsers = await getUserCompanyUsersWithSubprocesses(userId);
    const assignedSubprocesses = groupAssignmentsByCompany(companyUsers);

    return NextResponse.json(
      { assignedSubprocesses },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    console.error('Error fetching user subprocesses:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/users/[id]/subprocesses - Assign subprocesses to user
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdmin = await checkAdminPrivileges(session.user.email);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { id: userId } = await params;
    const body = await request.json();
    const companyId = Number(body.companyId);
    const desiredSubprocessIds = normalizeSubprocessIds(body.subprocessIds);

    if (!Number.isFinite(companyId)) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    await consolidateDuplicateCompanyUsers(userId);

    let companyUsers = await prisma.companyUser.findMany({
      where: {
        id_user: userId,
        id_company: companyId,
      },
      orderBy: { id_company_user: 'asc' },
    });

    if (companyUsers.length === 0) {
      const created = await prisma.companyUser.create({
        data: {
          id_user: userId,
          id_company: companyId,
        },
      });
      companyUsers = [created];
    }

    const primaryCompanyUser = companyUsers[0];
    const allCompanyUserIds = companyUsers.map((cu) => cu.id_company_user);

    const existingAssignments = await prisma.subprocessUserCompany.findMany({
      where: {
        id_company_user: { in: allCompanyUserIds },
      },
      select: { id_subprocess: true },
    });

    const existingSubprocessIds = [...new Set(existingAssignments.map((a) => a.id_subprocess))];
    const desiredSet = new Set(desiredSubprocessIds);
    const removed = existingSubprocessIds.filter((id) => !desiredSet.has(id));
    const added = desiredSubprocessIds.filter((id) => !existingSubprocessIds.includes(id));

    await prisma.$transaction(async (tx) => {
      await tx.subprocessUserCompany.deleteMany({
        where: {
          id_company_user: { in: allCompanyUserIds },
        },
      });

      if (desiredSubprocessIds.length > 0) {
        await tx.subprocessUserCompany.createMany({
          data: desiredSubprocessIds.map((subprocessId) => ({
            id_company_user: primaryCompanyUser.id_company_user,
            id_subprocess: subprocessId,
          })),
        });
      }

      if (allCompanyUserIds.length > 1) {
        await tx.companyUser.deleteMany({
          where: {
            id_company_user: { in: allCompanyUserIds.slice(1) },
          },
        });
      }
    });

    await prisma.userAuditLog.create({
      data: {
        user_id: userId,
        action: 'UPDATE_SUBPROCESSES',
        performed_by: session.user.email,
        details: `Company ${companyId}: assigned ${added.length}, removed ${removed.length}. Final: [${desiredSubprocessIds.join(', ')}]`,
      },
    });

    return NextResponse.json({
      message: 'Subprocesses updated successfully',
      added: added.length,
      removed: removed.length,
    });
  } catch (error) {
    console.error('Error assigning subprocesses:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/users/[id]/subprocesses - Remove all subprocess assignments for a user
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdmin = await checkAdminPrivileges(session.user.email);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { id: userId } = await params;
    const { searchParams } = new URL(request.url);
    const companyId = Number(searchParams.get('companyId'));

    if (!Number.isFinite(companyId)) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 });
    }

    await consolidateDuplicateCompanyUsers(userId);

    const companyUsers = await prisma.companyUser.findMany({
      where: {
        id_user: userId,
        id_company: companyId,
      },
    });

    if (companyUsers.length === 0) {
      return NextResponse.json({ error: 'Company user not found' }, { status: 404 });
    }

    const result = await prisma.subprocessUserCompany.deleteMany({
      where: {
        id_company_user: { in: companyUsers.map((cu) => cu.id_company_user) },
      },
    });

    await prisma.userAuditLog.create({
      data: {
        user_id: userId,
        action: 'REMOVE_ALL_SUBPROCESSES',
        performed_by: session.user.email,
        details: `Removed all subprocess assignments for company ${companyId}`,
      },
    });

    return NextResponse.json({
      message: 'All subprocesses removed successfully',
      count: result.count,
    });
  } catch (error) {
    console.error('Error removing subprocesses:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
