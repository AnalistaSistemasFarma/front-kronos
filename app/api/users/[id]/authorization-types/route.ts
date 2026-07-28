import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { checkAdminPrivileges } from '../../../../../lib/access-control';
import { prisma } from '../../../../../lib/prisma';
import { authOptions } from '../../../auth/[...nextauth]/route';

// Normalize incoming type ids: dedupe and keep only finite integers
function normalizeTypeIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const ids = value
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && Number.isFinite(n));
  return Array.from(new Set(ids));
}

// GET /api/users/[id]/authorization-types - Fetch assigned authorization types for a user
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

    const userTypes = await prisma.userTypesAuthorization.findMany({
      where: { id_user: userId },
    });

    const typeIds = userTypes.map((t) => t.type_authorization);

    return NextResponse.json(
      { typeIds },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    console.error('Error fetching user authorization types:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/users/[id]/authorization-types - Assign authorization types to user (replace set)
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
    const typeIds = normalizeTypeIds(body.typeIds);

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.userTypesAuthorization.deleteMany({ where: { id_user: userId } });
      if (typeIds.length > 0) {
        await tx.userTypesAuthorization.createMany({
          data: typeIds.map((type_authorization) => ({
            id_user: userId,
            type_authorization,
          })),
        });
      }
    });

    await prisma.userAuditLog.create({
      data: {
        user_id: userId,
        action: 'UPDATE',
        performed_by: session.user.email,
        details: `Authorization types updated: ${typeIds.length} assigned`,
      },
    });

    return NextResponse.json({ count: typeIds.length });
  } catch (error) {
    console.error('Error assigning user authorization types:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
