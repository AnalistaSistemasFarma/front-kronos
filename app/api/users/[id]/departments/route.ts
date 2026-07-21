import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { checkAdminPrivileges } from '../../../../../lib/access-control';
import { prisma } from '../../../../../lib/prisma';
import { authOptions } from '../../../auth/[...nextauth]/route';

// Normalize incoming department ids: dedupe and keep only finite integers
function normalizeDepartmentIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const ids = value
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && Number.isFinite(n));
  return Array.from(new Set(ids));
}

// GET /api/users/[id]/departments - Fetch assigned departments for a user
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

    const departmentUsers = await prisma.departmentUser.findMany({
      where: { id_user: userId },
      include: { department: true },
      orderBy: { department: { department: 'asc' } },
    });

    const departments = departmentUsers.map((du) => ({
      id_department: du.id_department,
      department: du.department.department,
    }));

    return NextResponse.json(
      { departments },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    console.error('Error fetching user departments:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/users/[id]/departments - Assign departments to user (replace set)
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
    const departmentIds = normalizeDepartmentIds(body.departmentIds);

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.departmentUser.deleteMany({ where: { id_user: userId } });
      if (departmentIds.length > 0) {
        await tx.departmentUser.createMany({
          data: departmentIds.map((id_department) => ({
            id_user: userId,
            id_department,
          })),
        });
      }
    });

    await prisma.userAuditLog.create({
      data: {
        user_id: userId,
        action: 'UPDATE',
        performed_by: session.user.email,
        details: `Departments updated: ${departmentIds.length} assigned`,
      },
    });

    return NextResponse.json({ count: departmentIds.length });
  } catch (error) {
    console.error('Error assigning user departments:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
