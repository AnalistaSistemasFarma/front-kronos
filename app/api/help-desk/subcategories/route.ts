import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { authOptions } from '../../auth/[...nextauth]/route';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const categoryId = searchParams.get('category_id');

    console.log('API Subcategories - categoryId from params:', categoryId);

    try {
      const where = categoryId ? { id_category: parseInt(categoryId) } : {};

      console.log('API Subcategories - where clause:', where);

      const subcategories = await prisma.subcategory.findMany({
        where,
        select: {
          id_subcategory: true,
          subcategory: true,
          id_category: true,
        },
        orderBy: {
          subcategory: 'asc',
        },
      });

      console.log('API Subcategories - found subcategories:', subcategories.length, 'items');

      return NextResponse.json(subcategories);
    } finally {
      await prisma.$disconnect();
    }
  } catch (error) {
    console.error('Error fetching subcategories:', error);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
