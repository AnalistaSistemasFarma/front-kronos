import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { checkAdminPrivileges } from '../../../../../lib/access-control';
import { prisma } from '../../../../../lib/prisma';
import { invalidateChatAccessCache } from '../../../../../lib/chat/access';
import {
  consolidateDuplicateCompanyUsers,
  getUserCompanyUsersWithSubprocesses,
  groupAssignmentsByCompany,
  normalizeSubprocessIds,
  syncUserCompanySubprocesses,
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
    // Varias empresas a la vez (companyIds) con el mismo conjunto de subprocesos;
    // companyId sigue aceptándose para una sola empresa.
    const rawCompanyIds: unknown[] = Array.isArray(body.companyIds)
      ? body.companyIds
      : [body.companyId];
    const parsedCompanyIds = rawCompanyIds.map(Number);
    const companyIds = [...new Set(parsedCompanyIds)];
    const desiredSubprocessIds = normalizeSubprocessIds(body.subprocessIds);

    if (
      companyIds.length === 0 ||
      !parsedCompanyIds.every((id) => Number.isInteger(id) && id > 0)
    ) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    let added = 0;
    let removed = 0;
    const details: string[] = [];
    // En serie: cada empresa consolida los company_user del mismo usuario.
    for (const companyId of companyIds) {
      const result = await syncUserCompanySubprocesses({
        userId,
        companyId,
        subprocessIds: desiredSubprocessIds,
        mode: 'replace',
      });
      added += result.added;
      removed += result.removed;
      details.push(
        `Company ${companyId}: assigned ${result.added}, removed ${result.removed}. Final: [${result.finalIds.join(', ')}]`
      );
    }

    // Los permisos del chat van en caché unos segundos (lib/chat/access.ts).
    invalidateChatAccessCache();

    await prisma.userAuditLog.create({
      data: {
        user_id: userId,
        action: 'UPDATE_SUBPROCESSES',
        performed_by: session.user.email,
        details: details.join(' | '),
      },
    });

    return NextResponse.json({
      message: 'Subprocesses updated successfully',
      added,
      removed,
      companies: companyIds.length,
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

    // Los permisos del chat van en caché unos segundos (lib/chat/access.ts).
    invalidateChatAccessCache();

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
