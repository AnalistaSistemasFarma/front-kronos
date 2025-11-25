import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '../../../../../app/generated/prisma';
import { authOptions } from '../../../auth/[...nextauth]/route';

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

// GET /api/users/[id]/subprocesses - Fetch assigned subprocesses for a user
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isAdmin = await checkAdminPermission(session.user.email);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { id: userId } = await params;

    // Get all company users for this user
    const companyUsers = await prisma.companyUser.findMany({
      where: {
        id_user: userId,
      },
      include: {
        company: true,
        subprocesses: {
          include: {
            subprocess: {
              include: {
                process: true,
              },
            },
          },
        },
      },
    });

    // Transform the data to group by company
    const assignedSubprocesses = companyUsers.map((cu) => ({
      companyId: cu.id_company,
      companyName: cu.company.company,
      companyUserId: cu.id_company_user,
      subprocesses: cu.subprocesses.map((suc) => ({
        id: suc.id_subprocess_user_company,
        subprocessId: suc.id_subprocess,
        subprocessName: suc.subprocess.subprocess,
        subprocessUrl: suc.subprocess.subprocess_url,
        processId: suc.subprocess.id_process,
        processName: suc.subprocess.process.process,
      })),
    }));

    return NextResponse.json({ assignedSubprocesses });
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

    const isAdmin = await checkAdminPermission(session.user.email);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { id: userId } = await params;
    const { companyId, subprocessIds } = await request.json();

    if (!companyId || !Array.isArray(subprocessIds)) {
      return NextResponse.json(
        { error: 'Company ID and subprocess IDs array are required' },
        { status: 400 }
      );
    }

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get or create CompanyUser
    let companyUser = await prisma.companyUser.findFirst({
      where: {
        id_user: userId,
        id_company: companyId,
      },
    });

    if (!companyUser) {
      companyUser = await prisma.companyUser.create({
        data: {
          id_user: userId,
          id_company: companyId,
        },
      });
    }

    // Get existing subprocess assignments for this company user
    const existingAssignments = await prisma.subprocessUserCompany.findMany({
      where: {
        id_company_user: companyUser.id_company_user,
      },
    });

    const existingSubprocessIds = existingAssignments.map((a) => a.id_subprocess);

    // Determine which subprocesses to add and remove
    const toAdd = subprocessIds.filter((id) => !existingSubprocessIds.includes(id));
    const toRemove = existingSubprocessIds.filter((id) => !subprocessIds.includes(id));

    // Remove unassigned subprocesses
    if (toRemove.length > 0) {
      await prisma.subprocessUserCompany.deleteMany({
        where: {
          id_company_user: companyUser.id_company_user,
          id_subprocess: {
            in: toRemove,
          },
        },
      });
    }

    // Add new subprocess assignments
    if (toAdd.length > 0) {
      await prisma.subprocessUserCompany.createMany({
        data: toAdd.map((subprocessId) => ({
          id_company_user: companyUser.id_company_user,
          id_subprocess: subprocessId,
        })),
      });
    }

    // Log the action
    await prisma.userAuditLog.create({
      data: {
        user_id: userId,
        action: 'UPDATE_SUBPROCESSES',
        performed_by: session.user.email,
        details: `Assigned ${toAdd.length} subprocess(es), removed ${toRemove.length} subprocess(es) for company ${companyId}`,
      },
    });

    return NextResponse.json({
      message: 'Subprocesses updated successfully',
      added: toAdd.length,
      removed: toRemove.length,
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

    const isAdmin = await checkAdminPermission(session.user.email);
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { id: userId } = await params;
    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get('companyId');

    if (!companyId) {
      return NextResponse.json({ error: 'Company ID is required' }, { status: 400 });
    }

    // Find the company user
    const companyUser = await prisma.companyUser.findFirst({
      where: {
        id_user: userId,
        id_company: parseInt(companyId),
      },
    });

    if (!companyUser) {
      return NextResponse.json({ error: 'Company user not found' }, { status: 404 });
    }

    // Delete all subprocess assignments
    const result = await prisma.subprocessUserCompany.deleteMany({
      where: {
        id_company_user: companyUser.id_company_user,
      },
    });

    // Log the action
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
