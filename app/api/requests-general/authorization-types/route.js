import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { authOptions } from '../../auth/[...nextauth]/route';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const types = await prisma.typesAuthorization.findMany({
      orderBy: { type_authorization: 'asc' },
    });

    return NextResponse.json(types, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    console.error('Error fetching authorization types:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
