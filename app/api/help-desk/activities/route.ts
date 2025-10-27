import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { authOptions } from '../../auth/[...nextauth]/route';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const subcategoryId = searchParams.get('subcategory_id');

    try {
      const where = subcategoryId ? { id_subcategory: parseInt(subcategoryId) } : {};

      const activities = await prisma.activity.findMany({
        where,
        select: {
          id_activity: true,
          activity: true,
          id_subcategory: true,
        },
        orderBy: {
          activity: 'asc',
        },
      });

      return NextResponse.json(activities);
    } finally {
      await prisma.$disconnect();
    }
  } catch (error) {
    console.error('Error fetching activities:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}